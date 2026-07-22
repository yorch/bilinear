import crypto from 'node:crypto';
import zlib from 'node:zlib';
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

/**
 * Extract an XML element with the given ID attribute using balanced-tag scanning.
 * Returns the full element string including open/close tags, or null if not found.
 */
function extractElementById(xml: string, id: string): string | null {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openTagMatch = xml.match(new RegExp(`<([\\w:]+)[^>]*\\bID="${escapedId}"[^>]*>`));
  if (!openTagMatch) {
    return null;
  }

  const tagName = openTagMatch[1];
  const startPos = xml.indexOf(openTagMatch[0]);
  if (startPos < 0) {
    return null;
  }

  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let depth = 0;
  let pos = startPos;

  while (pos < xml.length) {
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose < 0) {
      break;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return xml.slice(startPos, nextClose + closeTag.length);
      }
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

/**
 * Validate the <ds:DigestValue> of a signed reference element to detect
 * content substitution (signature wrapping attacks).
 */
function validateReferenceDigest(signedInfoXml: string, content: string): void {
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
  const expectedDigest = digestValueMatch[1].replace(/\s+/g, '');

  let hashAlg: string;
  if (digestAlgUri.includes('sha256')) {
    hashAlg = 'sha256';
  } else if (digestAlgUri.includes('sha1')) {
    hashAlg = 'sha1';
    log.warn('SAML reference digest uses deprecated SHA-1; migrate the IdP to SHA-256');
  } else {
    throw new SamlParseError(`Unsupported SAML digest algorithm: ${digestAlgUri}`);
  }

  const normalized = content.replace(/>\s+</g, '><').trim();
  const actualDigest = crypto.createHash(hashAlg).update(normalized, 'utf8').digest('base64');

  if (actualDigest !== expectedDigest) {
    throw new SamlParseError('SAML response reference digest mismatch');
  }
}

/**
 * Verify the XML-DSig signature on a SAML Response using the IdP certificate.
 * Returns the signed XML fragment so callers can restrict attribute extraction
 * to the verified content, preventing XML signature-wrapping attacks.
 *
 * Also validates the <ds:DigestValue> of the referenced element to detect
 * content substitution, and requires the signed content to contain exactly
 * one Assertion (defense against signature-wrapping attacks where a decoy
 * Assertion is injected alongside the legitimately-signed one).
 *
 * Limitation: uses whitespace-only normalisation instead of full Exclusive
 * C14N. This whole function remains a hand-rolled XML-DSig verifier; the
 * recommended long-term fix is to replace it with a vetted library (e.g.
 * `xml-crypto` or `@node-saml/node-saml`) rather than continuing to harden
 * this by hand.
 */
function verifyXmlSignature(xml: string, certPem: string): string {
  const sigInfoMatch = xml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/i);
  if (!sigInfoMatch) {
    throw new SamlParseError('SAML response is not signed');
  }

  const sigValMatch = xml.match(/<ds:SignatureValue[^>]*>\s*([\s\S]*?)\s*<\/ds:SignatureValue>/i);
  if (!sigValMatch) {
    throw new SamlParseError('SAML response signature value is missing');
  }

  const signedInfoXml = sigInfoMatch[0];
  const signatureB64 = sigValMatch[1].replace(/\s+/g, '');

  const algMatch = signedInfoXml.match(/<ds:SignatureMethod[^>]+Algorithm="([^"]+)"/i);
  const algorithm = algMatch?.[1] ?? '';

  let nodeAlg: string;
  if (algorithm.includes('rsa-sha256')) {
    nodeAlg = 'RSA-SHA256';
  } else if (algorithm.includes('rsa-sha1')) {
    nodeAlg = 'RSA-SHA1';
    log.warn('SAML signature uses deprecated SHA-1 (rsa-sha1); migrate the IdP to rsa-sha256');
  } else {
    throw new SamlParseError(`Unsupported SAML signature algorithm: ${algorithm}`);
  }

  // Whitespace-only normalization (not true Exclusive C14N).
  const normalizedSignedInfo = signedInfoXml.replace(/>\s+</g, '><').trim();

  let valid: boolean;
  try {
    const verifier = crypto.createVerify(nodeAlg);
    verifier.update(normalizedSignedInfo, 'utf8');
    valid = verifier.verify(certPem, signatureB64, 'base64');
  } catch {
    throw new SamlParseError('SAML signature verification error');
  }

  if (!valid) {
    throw new SamlParseError('SAML response signature is invalid');
  }

  // Locate the signed element via the Reference URI to prevent wrapping attacks.
  // Fail closed: a signature with no identifiable Reference target must never
  // be treated as covering the whole (otherwise-unsigned) document.
  const refMatch = signedInfoXml.match(/<ds:Reference\s+URI="#([^"]+)"/i);
  if (!refMatch?.[1]) {
    throw new SamlParseError(
      'SAML signature has no Reference URI — refusing to trust the entire document',
    );
  }
  const signedElement = extractElementById(xml, refMatch[1]);
  if (!signedElement) {
    throw new SamlParseError('SAML signed reference element not found');
  }

  validateReferenceDigest(signedInfoXml, signedElement);

  // Guard against signature-wrapping: the signed content must cover exactly
  // one Assertion. If claim extraction could see a second, unsigned
  // Assertion alongside the signed one, an attacker could rely on the
  // legitimate signature while injecting forged claims elsewhere.
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
