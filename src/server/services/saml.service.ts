import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { PrismaClient, SamlConfiguration } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

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
}

export interface SamlUserClaims {
  email: string;
  name: string;
  nameId: string;
}

export interface SamlConfigInput {
  emailAttribute?: string;
  enabled?: boolean;
  idpCert: string;
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
 * Verify the XML-DSig signature on a SAML Response using the IdP certificate.
 *
 * Applies whitespace-only normalization rather than full Exclusive XML C14N.
 * This works with most conformant IdPs (Okta, Azure AD, Google Workspace) but
 * a deployment handling non-standard IdPs should use a full XML-DSig library.
 *
 * Throws SamlParseError if the signature is absent, uses an unsupported
 * algorithm, or does not verify against certPem.
 */
function verifyXmlSignature(xml: string, certPem: string): void {
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
}

/** Generate a random ID suitable for SAML request identifiers. */
function generateSamlId(): string {
  return `_${crypto.randomUUID().replace(/-/g, '')}`;
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

    return this.prisma.samlConfiguration.upsert({
      create: {
        createdById: userId,
        emailAttribute: input.emailAttribute ?? 'email',
        enabled: input.enabled ?? false,
        idpCert: input.idpCert,
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
        idpCert: input.idpCert,
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

    // Verify XML signature against the stored IdP certificate.
    verifyXmlSignature(xml, config.idpCert);

    const nameId = extractNameId(xml);
    if (!nameId) {
      throw new SamlParseError('SAML response missing NameID');
    }

    // Prefer the configured attribute names; fall back to common alternatives
    let email =
      extractAttribute(xml, config.emailAttribute) ??
      extractAttribute(xml, 'email') ??
      extractAttribute(xml, 'mail') ??
      extractAttribute(xml, 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress');

    if (!email) {
      // Some IdPs put the email in the NameID directly when format is email
      if (nameId.includes('@')) {
        email = nameId;
      } else {
        throw new SamlParseError('SAML response missing email attribute');
      }
    }

    const name =
      extractAttribute(xml, config.nameAttribute) ??
      extractAttribute(xml, 'name') ??
      extractAttribute(xml, 'displayName') ??
      extractAttribute(xml, 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name') ??
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
      log.info({ email: claims.email, orgId, userId: existing.id }, 'SSO login — existing user');
      return { isNew: false, userId: existing.id };
    }

    // Create new user
    const initials = deriveInitials(claims.name);
    const user = await prisma.user.create({
      data: {
        displayName: claims.name,
        email: claims.email,
        initials,
        name: claims.name,
      },
    });

    await ensureOrgMembership(prisma, orgId, user.id);
    log.info({ email: claims.email, orgId, userId: user.id }, 'SSO login — new user provisioned');
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
