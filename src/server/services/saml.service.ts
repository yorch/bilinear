import crypto from 'node:crypto';
import zlib from 'node:zlib';
// `@xmldom/xmldom` is not a direct dependency of this package — it's a
// runtime dependency of `xml-crypto` itself (same parser xml-crypto uses
// internally), so it's guaranteed present. We use its `DOMParser` to build a
// real DOM (with correct ancestor-scoped XML namespace resolution) so the
// `<ds:Signature>` node we hand to `xml-crypto` carries proper namespace
// context regardless of whether the IdP declares `xmlns:ds` on the Signature
// element itself or up on a document ancestor — required for Exclusive C14N
// to canonicalize identically to what the IdP signed.
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import type { PrismaClient, SamlConfiguration } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import { isFirstUser } from './user.service';

const log = childLogger({ module: 'saml', service: 'SamlService' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SamlConfig {
  emailAttribute: string;
  idpCert: string;
  idpEntityId: string;
  idpSsoUrl: string;
  jitProvisioning: boolean;
  nameAttribute: string;
  /**
   * Expected SP entity id / audience for this deployment's ACS endpoint.
   * Used to validate an assertion's `<AudienceRestriction><Audience>` so an
   * assertion minted for a *different* SP can't be replayed against this one.
   * Optional and not persisted in `SamlConfiguration` — callers (the SAML
   * callback route) compute it per-request the same way the metadata/initiate
   * routes do (`${appUrl}/api/auth/saml/metadata?org=${orgKey}`) and pass it
   * through. If omitted, audience validation is skipped defensively rather
   * than failing closed — see `validateAudience`.
   */
  spEntityId?: string;
}

export interface SamlUserClaims {
  email: string;
  name: string;
  nameId: string;
}

export interface SamlConfigInput {
  emailAttribute?: string;
  enabled?: boolean;
  idpCert?: string;
  idpEntityId: string;
  idpMetadataUrl?: string;
  idpMetadataXml?: string;
  idpSsoUrl: string;
  jitProvisioning?: boolean;
  nameAttribute?: string;
  ssoEnforced?: boolean;
}

// ---------------------------------------------------------------------------
// Minimal XML helpers (no external library)
// ---------------------------------------------------------------------------

/**
 * Extract the text value of a named SAML Attribute element.
 *
 * SAML responses may use `saml:`, `saml2:`, or no prefix, and attribute names
 * may include the full URI or a short name. We match both.
 */
function extractAttribute(xml: string, name: string): string | null {
  // Match <saml*:Attribute Name="…"> … <saml*:AttributeValue>value</…>
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrPattern = new RegExp(
    `<(?:saml2?:)?Attribute[^>]+Name="${escapedName}"[^>]*>[\\s\\S]*?` +
      `<(?:saml2?:)?AttributeValue[^>]*>([^<]+)<\\/(?:saml2?:)?AttributeValue>`,
    'i',
  );
  return xml.match(attrPattern)?.[1]?.trim() ?? null;
}

/** Extract the NameID from a SAML Response/Assertion. */
function extractNameId(xml: string): string | null {
  const m = xml.match(/<(?:saml2?:)?NameID[^>]*>([^<]+)<\/(?:saml2?:)?NameID>/i);
  return m?.[1]?.trim() ?? null;
}

/** Extract the top-level Issuer element value from a SAML Response. */
function extractIssuer(xml: string): string | null {
  const m = xml.match(/<(?:saml2?:)?Issuer[^>]*>([^<]+)<\/(?:saml2?:)?Issuer>/i);
  return m?.[1]?.trim() ?? null;
}

/** XML-DSig namespace URI for locating the `<ds:Signature>` element by identity, not string prefix. */
const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

/**
 * Verify the XML-DSig signature on a SAML Response using the IdP certificate,
 * via the vetted `xml-crypto` library (real Exclusive C14N + digest +
 * signature verification, rather than the whitespace-normalization shortcut
 * this function used to hand-roll).
 *
 * Returns the signed content — the canonicalized, cryptographically-verified
 * XML of the *referenced* element only — so callers restrict all claim
 * extraction to it, preventing XML signature-wrapping attacks. Two layers of
 * wrapping defense are applied on top of xml-crypto's own verification:
 *   1. Exactly one `<ds:Signature>` and exactly one signed `Reference` are
 *      required (no ambiguity about which element is "the" signed content).
 *   2. The signed content itself must contain exactly one Assertion element
 *      (defends against a Reference whose target is a *wrapper* containing
 *      both a legitimately-signed Assertion and an injected, unsigned decoy).
 * xml-crypto also independently refuses to validate a document containing
 * multiple elements sharing the same ID attribute value — a classic
 * signature-wrapping vector — before this function is ever reached.
 *
 * The IdP certificate is always the one pinned in the org's SamlConfig
 * (`certPem`); `getCertFromKeyInfo` is forced to return null so a certificate
 * embedded in the document's own `<ds:KeyInfo>` is never trusted, even if
 * present.
 */
function verifyXmlSignature(xml: string, certPem: string): string {
  // --- Structural + algorithm-posture pre-checks (fail closed) --------------
  // These mirror the checks this function has always made; only the actual
  // C14N/digest/signature cryptography below is now delegated to xml-crypto.
  const sigInfoMatch = xml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/i);
  if (!sigInfoMatch) {
    throw new SamlParseError('SAML response is not signed');
  }
  const signedInfoXml = sigInfoMatch[0];

  const algMatch = signedInfoXml.match(/<ds:SignatureMethod[^>]+Algorithm="([^"]+)"/i);
  const algorithm = algMatch?.[1] ?? '';
  if (algorithm.includes('rsa-sha256')) {
    // preferred algorithm — no action needed
  } else if (algorithm.includes('rsa-sha1')) {
    log.warn('SAML signature uses deprecated SHA-1 (rsa-sha1); migrate the IdP to rsa-sha256');
  } else {
    throw new SamlParseError(`Unsupported SAML signature algorithm: ${algorithm}`);
  }

  // Fail closed: a signature with no identifiable Reference target must never
  // be treated as covering the whole (otherwise-unsigned) document. xml-crypto
  // itself would treat an empty/absent URI as "the whole document" (a
  // same-document same-URI reference), so this must be rejected before we
  // ever hand the document to it.
  const refMatch = signedInfoXml.match(/<ds:Reference\s+URI="#([^"]+)"/i);
  if (!refMatch?.[1]) {
    throw new SamlParseError(
      'SAML signature has no Reference URI — refusing to trust the entire document',
    );
  }
  const referencedId = refMatch[1];

  const digestMethodMatch = signedInfoXml.match(/<ds:DigestMethod[^>]+Algorithm="([^"]+)"/i);
  const digestValueMatch = signedInfoXml.match(
    /<ds:DigestValue[^>]*>\s*([\s\S]*?)\s*<\/ds:DigestValue>/i,
  );
  if (!digestMethodMatch || !digestValueMatch) {
    // Fail closed: a Reference with no digest can't be checked for content
    // substitution, so it must be rejected rather than silently trusted.
    throw new SamlParseError('SAML signature reference is missing a DigestMethod/DigestValue');
  }
  const digestAlgUri = digestMethodMatch[1];
  if (digestAlgUri.includes('sha256')) {
    // preferred algorithm — no action needed
  } else if (digestAlgUri.includes('sha1')) {
    log.warn('SAML reference digest uses deprecated SHA-1; migrate the IdP to SHA-256');
  } else {
    throw new SamlParseError(`Unsupported SAML digest algorithm: ${digestAlgUri}`);
  }

  // --- Parse the document and locate the Signature node ---------------------
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    throw new SamlParseError('Failed to parse SAML response XML');
  }

  // Located by (localName, namespace) identity, not string prefix — this also
  // correctly resolves a `ds` namespace declared on an ancestor rather than
  // repeated on the Signature element itself (a real-IdP pattern the old
  // regex/whitespace-normalization approach could not have handled safely).
  const signatureNodes = doc.getElementsByTagNameNS(DSIG_NS, 'Signature');
  if (signatureNodes.length === 0) {
    throw new SamlParseError('SAML response is not signed');
  }
  if (signatureNodes.length > 1) {
    // Ambiguous: refuse to guess which Signature covers the assertion we're
    // about to trust.
    throw new SamlParseError(
      'SAML response contains more than one Signature element — refusing to trust ambiguous content',
    );
  }

  // --- Verify via xml-crypto, pinned to the configured IdP certificate -------
  const verifier = new SignedXml({
    // Never trust a certificate embedded in the document's own KeyInfo — the
    // only certificate that may verify this signature is the one configured
    // for this org's IdP.
    getCertFromKeyInfo: () => null,
    publicCert: certPem,
  });

  try {
    verifier.loadSignature(signatureNodes[0]);
  } catch (err) {
    throw new SamlParseError(
      `SAML signature could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let valid: boolean;
  try {
    valid = verifier.checkSignature(xml);
  } catch (err) {
    // xml-crypto itself refuses to validate a document containing multiple
    // elements that share the same ID attribute value — a classic
    // signature-wrapping vector (the Reference resolves ambiguously between
    // the legitimately-signed element and an attacker-injected one with the
    // same ID). Surface that distinctly; anything else (e.g. the
    // SignatureValue itself doesn't verify against the SignedInfo) collapses
    // to the generic invalid-signature error.
    if (err instanceof Error && err.message.includes('multiple elements with the same value')) {
      throw new SamlParseError(
        'SAML response contains multiple elements with the same ID (possible signature-wrapping attempt)',
      );
    }
    throw new SamlParseError('SAML response signature is invalid');
  }

  if (!valid) {
    // checkSignature() returns false (rather than throwing) when a
    // Reference's digest doesn't match its element — surface that
    // distinctly, matching this function's historical wrapping-detection
    // message, since it usually indicates post-signing content substitution.
    const failedReference = verifier.getReferences().find(ref => ref.validationError);
    if (failedReference?.validationError?.message.includes('calculated digest')) {
      throw new SamlParseError('SAML response reference digest mismatch');
    }
    throw new SamlParseError('SAML response signature is invalid');
  }

  // --- Signature-wrapping defense: trust ONLY the verified reference --------
  // Never fall back to the raw `xml` for claim extraction. Require exactly
  // one Reference so there's no ambiguity, and confirm it's the same element
  // named by the SignedInfo's Reference URI checked above.
  const references = verifier.getReferences();
  if (references.length !== 1) {
    throw new SamlParseError(
      'SAML signature must cover exactly one Reference (possible signature-wrapping attempt)',
    );
  }
  const [reference] = references;
  const referenceUri = reference.uri?.startsWith('#') ? reference.uri.slice(1) : reference.uri;
  if (referenceUri !== referencedId) {
    throw new SamlParseError('SAML signature Reference URI mismatch');
  }
  const signedElement = reference.signedReference;
  if (!signedElement) {
    // Should be unreachable given `valid === true` above, but fail closed
    // rather than trust anything if xml-crypto ever changes this invariant.
    throw new SamlParseError('SAML signed reference content is unavailable after verification');
  }

  // Guard against signature-wrapping: the signed content must cover exactly
  // one Assertion. Even though `signedElement` is now cryptographically
  // verified, it may be a *wrapper* whose signed subtree contains both a
  // legitimate Assertion and an injected, unsigned decoy — if claim
  // extraction could see a second Assertion here, an attacker could rely on
  // the legitimate signature while smuggling in forged claims.
  const assertionMatches = signedElement.match(/<(?:saml2?:)?Assertion(?=[\s>])/gi) ?? [];
  if (assertionMatches.length !== 1) {
    throw new SamlParseError(
      'SAML signed content must contain exactly one Assertion (possible signature-wrapping attempt)',
    );
  }

  return signedElement;
}

/** Generate a random ID suitable for SAML request identifiers. */
function generateSamlId(): string {
  return `_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Extract the ID attribute of the (single, verified) Assertion element. */
function extractAssertionId(xml: string): string | null {
  const m = xml.match(/<(?:saml2?:)?Assertion\b[^>]*\bID="([^"]+)"/i);
  return m?.[1] ?? null;
}

// Tolerate small clock drift between the IdP and this server when checking
// Conditions/SubjectConfirmationData time bounds.
const CLOCK_SKEW_MS = 60_000;

/**
 * Validate <Conditions NotBefore/NotOnOrAfter> on the signed assertion.
 *
 * A previous version of this service never checked Conditions at all, which
 * meant a captured SAMLResponse had no expiry and could be replayed
 * indefinitely. Conditions is required here (fail closed) rather than
 * treated as optional — an assertion with no time bound at all provides no
 * real defense against replay even before the one-time-use check below.
 */
function validateConditions(signedContent: string, now: Date): { notOnOrAfterMs: number } {
  const conditionsMatch = signedContent.match(/<(?:saml2?:)?Conditions\b([^>]*)>/i);
  if (!conditionsMatch) {
    throw new SamlParseError('SAML assertion is missing a Conditions element');
  }

  const attrs = conditionsMatch[1] ?? '';
  const notBefore = attrs.match(/\bNotBefore="([^"]+)"/i)?.[1];
  const notOnOrAfter = attrs.match(/\bNotOnOrAfter="([^"]+)"/i)?.[1];
  // NotOnOrAfter is required here (fail closed): without it there is no
  // expiry bound and nothing to key the replay-prune cache on. NotBefore,
  // however, is individually optional per SAML 2.0 §2.5.1 — a conformant IdP
  // may omit it, and rejecting that assertion would be a false-positive SSO
  // failure, not a real security check (omitting NotBefore only means the
  // assertion has no "not yet valid" bound, which is a strictly narrower
  // relaxation than omitting NotOnOrAfter's expiry bound).
  if (!notOnOrAfter) {
    throw new SamlParseError('SAML assertion Conditions is missing NotOnOrAfter');
  }

  let notBeforeMs: number | undefined;
  if (notBefore) {
    notBeforeMs = Date.parse(notBefore);
    if (Number.isNaN(notBeforeMs)) {
      throw new SamlParseError('SAML assertion Conditions has an unparseable NotBefore timestamp');
    }
  }

  const notOnOrAfterMs = Date.parse(notOnOrAfter);
  if (Number.isNaN(notOnOrAfterMs)) {
    throw new SamlParseError('SAML assertion Conditions has an unparseable NotOnOrAfter timestamp');
  }

  const nowMs = now.getTime();
  if (notBeforeMs !== undefined && nowMs < notBeforeMs - CLOCK_SKEW_MS) {
    throw new SamlParseError('SAML assertion is not yet valid (Conditions NotBefore)');
  }
  if (nowMs >= notOnOrAfterMs + CLOCK_SKEW_MS) {
    throw new SamlParseError('SAML assertion has expired (Conditions NotOnOrAfter)');
  }

  return { notOnOrAfterMs };
}

/**
 * Validate <AudienceRestriction><Audience> against the configured SP entity
 * id, when both are present. Guards against an assertion legitimately signed
 * by the IdP but minted for a *different* SP being replayed against this one.
 */
function validateAudience(signedContent: string, expectedAudience: string | undefined): void {
  const audiences = [
    ...signedContent.matchAll(/<(?:saml2?:)?Audience>\s*([^<]+?)\s*<\/(?:saml2?:)?Audience>/gi),
  ].map(m => m[1]);

  if (audiences.length === 0) {
    // SAML core does not mandate AudienceRestriction — nothing to validate.
    return;
  }

  if (!expectedAudience) {
    // Documented limitation: SamlConfig.spEntityId is optional and not every
    // caller supplies it. Tolerate absence of configuration here rather than
    // failing closed, since we can't invent an expected audience — but this
    // means audience scoping is not enforced unless callers pass it through.
    log.warn(
      'SAML assertion has an AudienceRestriction but no expected SP audience is configured to validate it against',
    );
    return;
  }

  if (!audiences.includes(expectedAudience)) {
    throw new SamlParseError(`SAML audience restriction mismatch: expected "${expectedAudience}"`);
  }
}

/**
 * Reject an expired <SubjectConfirmationData NotOnOrAfter>, when present.
 * Optional per SAML core, so absence is not itself an error.
 */
function validateSubjectConfirmation(signedContent: string, now: Date): void {
  const match = signedContent.match(/<(?:saml2?:)?SubjectConfirmationData\b([^>]*)>/i);
  if (!match) {
    return;
  }

  const notOnOrAfter = match[1]?.match(/\bNotOnOrAfter="([^"]+)"/i)?.[1];
  if (!notOnOrAfter) {
    return;
  }

  const notOnOrAfterMs = Date.parse(notOnOrAfter);
  if (Number.isNaN(notOnOrAfterMs)) {
    throw new SamlParseError(
      'SAML SubjectConfirmationData has an unparseable NotOnOrAfter timestamp',
    );
  }

  if (now.getTime() >= notOnOrAfterMs + CLOCK_SKEW_MS) {
    throw new SamlParseError('SAML SubjectConfirmationData has expired (NotOnOrAfter)');
  }
}

// ---------------------------------------------------------------------------
// Replay guard (one-time-use enforcement)
//
// Best-effort, in-process cache of consumed assertion IDs. This is per-server-
// instance and in-memory only:
//   - it does NOT prevent replay across multiple app instances/processes in a
//     horizontally-scaled deployment (an attacker could replay a captured
//     SAMLResponse against a different instance than the one that already
//     consumed it);
//   - it resets on process restart/deploy.
//
// TODO(security): back this with a durable, shared store (e.g. Redis, which
// is already used elsewhere in this app for pub/sub) keyed by assertion ID
// with a TTL derived from Conditions/@NotOnOrAfter before relying on this in
// a multi-instance production deployment.
// ---------------------------------------------------------------------------

const MAX_REPLAY_CACHE_SIZE = 10_000;
// assertionId -> acceptance-horizon expiry (epoch ms). This is NOT the raw
// Conditions/@NotOnOrAfter instant — validateConditions() still ACCEPTS an
// assertion for an extra CLOCK_SKEW_MS past NotOnOrAfter, so pruning a cache
// entry at the bare NotOnOrAfter instant would evict it right before a
// replay attempt inside that skew tail could still be accepted, letting the
// replay through. The stored expiry must be the actual last instant at which
// the assertion could still pass validateConditions.
const seenAssertionIds = new Map<string, number>();

function recordAssertionUseOrThrow(assertionId: string, notOnOrAfterMs: number): void {
  const now = Date.now();
  const acceptanceHorizonMs = notOnOrAfterMs + CLOCK_SKEW_MS;

  for (const [id, expiry] of seenAssertionIds) {
    if (expiry <= now) {
      seenAssertionIds.delete(id);
    }
  }

  if (seenAssertionIds.has(assertionId)) {
    throw new SamlParseError('SAML assertion has already been used (replay detected)');
  }

  if (seenAssertionIds.size >= MAX_REPLAY_CACHE_SIZE) {
    // Defensive bound so a flood of distinct assertion IDs can't grow this
    // map unboundedly; drop the oldest (insertion-ordered) entry.
    const oldestId = seenAssertionIds.keys().next().value;
    if (oldestId !== undefined) {
      seenAssertionIds.delete(oldestId);
    }
  }

  seenAssertionIds.set(assertionId, acceptanceHorizonMs);
}

/** Test-only: clear the in-memory replay cache between test cases. */
export function resetSamlReplayCacheForTests(): void {
  seenAssertionIds.clear();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SamlService {
  constructor(private prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Config CRUD
  // -------------------------------------------------------------------------

  async getConfig(orgId: string): Promise<SamlConfiguration | null> {
    return this.prisma.samlConfiguration.findUnique({
      where: { organizationId: orgId },
    });
  }

  async saveConfig(
    orgId: string,
    userId: string,
    input: SamlConfigInput,
  ): Promise<SamlConfiguration> {
    log.info({ orgId }, 'Saving SAML configuration');

    // Preserve the existing cert when not re-supplied (e.g. edit without re-entering the PEM).
    let idpCert = input.idpCert;
    if (!idpCert) {
      const existing = await this.prisma.samlConfiguration.findUnique({
        select: { idpCert: true },
        where: { organizationId: orgId },
      });
      idpCert = existing?.idpCert ?? '';
    }

    return this.prisma.samlConfiguration.upsert({
      create: {
        createdById: userId,
        emailAttribute: input.emailAttribute ?? 'email',
        enabled: input.enabled ?? false,
        idpCert,
        idpEntityId: input.idpEntityId,
        idpMetadataUrl: input.idpMetadataUrl ?? null,
        idpMetadataXml: input.idpMetadataXml ?? null,
        idpSsoUrl: input.idpSsoUrl,
        jitProvisioning: input.jitProvisioning ?? true,
        nameAttribute: input.nameAttribute ?? 'name',
        organizationId: orgId,
        ssoEnforced: input.ssoEnforced ?? false,
      },
      update: {
        emailAttribute: input.emailAttribute ?? 'email',
        enabled: input.enabled ?? false,
        idpCert,
        idpEntityId: input.idpEntityId,
        idpMetadataUrl: input.idpMetadataUrl ?? null,
        idpMetadataXml: input.idpMetadataXml ?? null,
        idpSsoUrl: input.idpSsoUrl,
        jitProvisioning: input.jitProvisioning ?? true,
        nameAttribute: input.nameAttribute ?? 'name',
        ssoEnforced: input.ssoEnforced ?? false,
      },
      where: { organizationId: orgId },
    });
  }

  async deleteConfig(orgId: string): Promise<void> {
    log.info({ orgId }, 'Deleting SAML configuration');
    await this.prisma.samlConfiguration.deleteMany({
      where: { organizationId: orgId },
    });
  }

  // -------------------------------------------------------------------------
  // SP Metadata
  // -------------------------------------------------------------------------

  generateSpMetadata(_orgId: string, spEntityId: string, acsUrl: string): string {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"`,
      `  entityID="${escapeXml(spEntityId)}">`,
      `  <md:SPSSODescriptor`,
      `    AuthnRequestsSigned="false"`,
      `    WantAssertionsSigned="true"`,
      `    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
      `    <md:AssertionConsumerService`,
      `      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
      `      Location="${escapeXml(acsUrl)}"`,
      `      index="1"/>`,
      `  </md:SPSSODescriptor>`,
      `</md:EntityDescriptor>`,
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // AuthnRequest (SP-initiated SSO, HTTP-Redirect binding)
  // -------------------------------------------------------------------------

  buildAuthnRequest(
    config: SamlConfig,
    spEntityId: string,
    acsUrl: string,
    relayState: string,
  ): string {
    const id = generateSamlId();
    const issueInstant = new Date().toISOString();

    const authnRequest = [
      `<samlp:AuthnRequest`,
      `  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
      `  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
      `  ID="${id}"`,
      `  Version="2.0"`,
      `  IssueInstant="${issueInstant}"`,
      `  Destination="${escapeXml(config.idpSsoUrl)}"`,
      `  AssertionConsumerServiceURL="${escapeXml(acsUrl)}"`,
      `  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
      `  <saml:Issuer>${escapeXml(spEntityId)}</saml:Issuer>`,
      `</samlp:AuthnRequest>`,
    ].join('\n');

    // HTTP-Redirect binding: deflate (raw, no zlib wrapper), then base64-encode
    const deflated = zlib.deflateRawSync(Buffer.from(authnRequest, 'utf8'));
    const encoded = deflated.toString('base64');

    const params = new URLSearchParams({
      RelayState: relayState,
      SAMLRequest: encoded,
    });

    return `${config.idpSsoUrl}?${params.toString()}`;
  }

  // -------------------------------------------------------------------------
  // Response parsing
  // -------------------------------------------------------------------------

  /** Parse a base64-encoded SAML Response, verify the issuer and signature, and extract user claims. */
  async parseAndValidateResponse(
    config: SamlConfig,
    samlResponse: string,
  ): Promise<SamlUserClaims> {
    let xml: string;
    try {
      xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    } catch {
      throw new SamlParseError('Failed to decode SAML response');
    }

    log.debug({ idpEntityId: config.idpEntityId }, 'Parsing SAML response');

    // Verify the response came from the expected IdP.
    const issuer = extractIssuer(xml);
    if (!issuer) {
      throw new SamlParseError('SAML response missing Issuer');
    }
    if (issuer !== config.idpEntityId) {
      throw new SamlParseError(
        `SAML Issuer mismatch: expected "${config.idpEntityId}", got "${issuer}"`,
      );
    }

    // Verify XML signature and get the signed fragment to restrict all claim
    // extraction AND all condition/audience/replay validation to content that
    // is actually covered by the signature (prevents signature-wrapping
    // attacks from smuggling unsigned Conditions/Audience/claims in).
    const signedContent = verifyXmlSignature(xml, config.idpCert);

    // Assertion condition/replay validation. A previous version of this
    // service validated only Issuer + XML signature, which meant a captured
    // SAMLResponse could be replayed indefinitely and an assertion minted for
    // a different SP could be accepted here.
    const now = new Date();
    const { notOnOrAfterMs } = validateConditions(signedContent, now);
    validateAudience(signedContent, config.spEntityId);
    validateSubjectConfirmation(signedContent, now);

    const assertionId = extractAssertionId(signedContent);
    if (!assertionId) {
      throw new SamlParseError('SAML assertion is missing an ID');
    }
    recordAssertionUseOrThrow(assertionId, notOnOrAfterMs);

    const nameId = extractNameId(signedContent);
    if (!nameId) {
      throw new SamlParseError('SAML response missing NameID');
    }

    // Prefer the configured attribute names; fall back to common alternatives
    let email =
      extractAttribute(signedContent, config.emailAttribute) ??
      extractAttribute(signedContent, 'email') ??
      extractAttribute(signedContent, 'mail') ??
      extractAttribute(
        signedContent,
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      );

    if (!email) {
      // Some IdPs put the email in the NameID directly when format is email
      if (nameId.includes('@')) {
        email = nameId;
      } else {
        throw new SamlParseError('SAML response missing email attribute');
      }
    }

    const name =
      extractAttribute(signedContent, config.nameAttribute) ??
      extractAttribute(signedContent, 'name') ??
      extractAttribute(signedContent, 'displayName') ??
      extractAttribute(
        signedContent,
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
      ) ??
      email.split('@')[0];

    return { email: email.toLowerCase(), name, nameId };
  }

  // -------------------------------------------------------------------------
  // JIT provisioning
  // -------------------------------------------------------------------------

  async jitProvisionUser(
    prisma: PrismaClient,
    orgId: string,
    claims: SamlUserClaims,
  ): Promise<{ isNew: boolean; userId: string }> {
    const existing = await prisma.user.findUnique({ where: { email: claims.email } });

    if (existing) {
      // Ensure org membership exists
      await ensureOrgMembership(prisma, orgId, existing.id);
      // Log by userId/orgId only — the email is PII and the user id is enough
      // to correlate an SSO login without persisting an address in log storage.
      log.info({ orgId, userId: existing.id }, 'SSO login — existing user');
      return { isNew: false, userId: existing.id };
    }

    // Create new user. Bootstrap the platform admin if this is the very first
    // account in the deployment (an enterprise install whose first login is
    // SSO must still end up with an operator — see UserService.isFirstUser).
    const initials = deriveInitials(claims.name);
    const platformAdmin = await isFirstUser(prisma);
    const user = await prisma.user.create({
      data: {
        displayName: claims.name,
        email: claims.email,
        initials,
        isPlatformAdmin: platformAdmin,
        name: claims.name,
      },
    });

    await ensureOrgMembership(prisma, orgId, user.id);
    log.info({ orgId, userId: user.id }, 'SSO login — new user provisioned');
    return { isNew: true, userId: user.id };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureOrgMembership(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
): Promise<void> {
  await prisma.organizationMember.upsert({
    create: { organizationId: orgId, role: 'member', userId },
    update: {},
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return (parts[0] ?? '').slice(0, 2).toUpperCase();
  }
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SamlNotConfiguredError extends Error {
  constructor() {
    super('SAML SSO is not configured for this organization');
    this.name = 'SamlNotConfiguredError';
  }
}

export class SamlNotEnabledError extends Error {
  constructor() {
    super('SAML SSO is not enabled for this organization');
    this.name = 'SamlNotEnabledError';
  }
}

export class SamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamlParseError';
  }
}
