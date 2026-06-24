import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { type SamlConfig, type SamlConfigInput, SamlParseError, SamlService } from './saml.service';

// ---------------------------------------------------------------------------
// Signed-XML test helpers
//
// We generate a real RSA keypair so the service's crypto.verify path runs for
// real. The signature is computed over the whitespace-normalized <ds:SignedInfo>
// exactly the way the service normalizes it before verifying, and the
// <ds:DigestValue> is computed over the whitespace-normalized referenced
// element — matching validateReferenceDigest's normalization.
// ---------------------------------------------------------------------------

const { privateKey, certPem } = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  // The service passes the PEM straight to crypto.verify, which accepts a raw
  // public key PEM, so we can use the SPKI public key in place of a certificate.
  return {
    certPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKey,
  };
})();

const IDP_ENTITY_ID = 'https://idp.example.com/metadata';

function normalize(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

interface SignedResponseOptions {
  assertionId?: string;
  digestAlg?: 'sha1' | 'sha256';
  email?: string | null;
  emailAttribute?: string;
  issuer?: string;
  name?: string | null;
  nameAttribute?: string;
  nameId?: string;
  sigAlg?: 'rsa-sha1' | 'rsa-sha256';
  signKey?: crypto.KeyObject;
  tamperAssertionAfterSign?: boolean;
}

/** Build a SAML Response with a valid enveloped signature over the assertion. */
function buildSignedResponse(opts: SignedResponseOptions = {}): string {
  const assertionId = opts.assertionId ?? '_assert123';
  const issuer = opts.issuer ?? IDP_ENTITY_ID;
  const nameId = opts.nameId ?? 'user@example.com';
  const emailAttr = opts.emailAttribute ?? 'email';
  const nameAttr = opts.nameAttribute ?? 'name';
  const sigAlg = opts.sigAlg ?? 'rsa-sha256';
  const digestAlg = opts.digestAlg ?? 'sha256';
  const signKey = opts.signKey ?? privateKey;

  const attrLines: string[] = [];
  if (opts.email !== null) {
    attrLines.push(
      `<saml:Attribute Name="${emailAttr}"><saml:AttributeValue>${opts.email ?? 'User@Example.com'}</saml:AttributeValue></saml:Attribute>`,
    );
  }
  if (opts.name !== null) {
    attrLines.push(
      `<saml:Attribute Name="${nameAttr}"><saml:AttributeValue>${opts.name ?? 'Jane Doe'}</saml:AttributeValue></saml:Attribute>`,
    );
  }

  const assertion =
    `<saml:Assertion ID="${assertionId}">` +
    `<saml:Subject><saml:NameID>${nameId}</saml:NameID></saml:Subject>` +
    `<saml:AttributeStatement>${attrLines.join('')}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const digestUri =
    digestAlg === 'sha256'
      ? 'http://www.w3.org/2001/04/xmlenc#sha256'
      : 'http://www.w3.org/2000/09/xmldsig#sha1';
  const sigUri =
    sigAlg === 'rsa-sha256'
      ? 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
      : 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

  const digestValue = crypto
    .createHash(digestAlg)
    .update(normalize(assertion), 'utf8')
    .digest('base64');

  const signedInfo =
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>` +
    `<ds:SignatureMethod Algorithm="${sigUri}"/>` +
    `<ds:Reference URI="#${assertionId}">` +
    `<ds:DigestMethod Algorithm="${digestUri}"/>` +
    `<ds:DigestValue>${digestValue}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const nodeAlg = sigAlg === 'rsa-sha256' ? 'RSA-SHA256' : 'RSA-SHA1';
  const signer = crypto.createSign(nodeAlg);
  signer.update(normalize(signedInfo), 'utf8');
  const signatureValue = signer.sign(signKey, 'base64');

  const signature =
    `<ds:Signature>${signedInfo}` +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `</ds:Signature>`;

  let xml =
    `<samlp:Response>` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    signature +
    assertion +
    `</samlp:Response>`;

  if (opts.tamperAssertionAfterSign) {
    xml = xml.replace('Jane Doe', 'Evil Hacker');
  }

  return Buffer.from(xml, 'utf8').toString('base64');
}

function makeConfig(overrides: Partial<SamlConfig> = {}): SamlConfig {
  return {
    emailAttribute: 'email',
    idpCert: certPem,
    idpEntityId: IDP_ENTITY_ID,
    idpSsoUrl: 'https://idp.example.com/sso',
    jitProvisioning: true,
    nameAttribute: 'name',
    ...overrides,
  };
}

describe('SamlService', () => {
  let prisma: MockPrismaClient;
  let service: SamlService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SamlService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // Config CRUD
  // -------------------------------------------------------------------------

  describe('getConfig', () => {
    it('looks up config by organizationId', async () => {
      const config = { idpEntityId: IDP_ENTITY_ID, organizationId: TEST_ORG.id };
      prisma.samlConfiguration.findUnique.mockResolvedValue(config);

      const result = await service.getConfig(TEST_ORG.id);

      expect(result).toEqual(config);
      expect(prisma.samlConfiguration.findUnique).toHaveBeenCalledWith({
        where: { organizationId: TEST_ORG.id },
      });
    });

    it('returns null when no config exists', async () => {
      prisma.samlConfiguration.findUnique.mockResolvedValue(null);
      expect(await service.getConfig(TEST_ORG.id)).toBeNull();
    });
  });

  describe('saveConfig', () => {
    const baseInput: SamlConfigInput = {
      idpCert: 'CERT-PEM',
      idpEntityId: IDP_ENTITY_ID,
      idpSsoUrl: 'https://idp.example.com/sso',
    };

    it('upserts with defaults applied for omitted optional fields', async () => {
      prisma.samlConfiguration.upsert.mockResolvedValue({ id: 'cfg-1' });

      await service.saveConfig(TEST_ORG.id, TEST_USER.id, baseInput);

      expect(prisma.samlConfiguration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            createdById: TEST_USER.id,
            emailAttribute: 'email',
            enabled: false,
            idpCert: 'CERT-PEM',
            jitProvisioning: true,
            nameAttribute: 'name',
            organizationId: TEST_ORG.id,
            ssoEnforced: false,
          }),
          update: expect.objectContaining({
            emailAttribute: 'email',
            enabled: false,
            jitProvisioning: true,
          }),
          where: { organizationId: TEST_ORG.id },
        }),
      );
      // No cert lookup needed when cert is supplied.
      expect(prisma.samlConfiguration.findUnique).not.toHaveBeenCalled();
    });

    it('preserves the existing cert when the input omits it', async () => {
      prisma.samlConfiguration.findUnique.mockResolvedValue({ idpCert: 'EXISTING-CERT' });
      prisma.samlConfiguration.upsert.mockResolvedValue({ id: 'cfg-1' });

      await service.saveConfig(TEST_ORG.id, TEST_USER.id, {
        idpEntityId: IDP_ENTITY_ID,
        idpSsoUrl: 'https://idp.example.com/sso',
      });

      expect(prisma.samlConfiguration.findUnique).toHaveBeenCalledWith({
        select: { idpCert: true },
        where: { organizationId: TEST_ORG.id },
      });
      expect(prisma.samlConfiguration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ idpCert: 'EXISTING-CERT' }),
          update: expect.objectContaining({ idpCert: 'EXISTING-CERT' }),
        }),
      );
    });

    it('falls back to empty cert when none supplied and none stored', async () => {
      prisma.samlConfiguration.findUnique.mockResolvedValue(null);
      prisma.samlConfiguration.upsert.mockResolvedValue({ id: 'cfg-1' });

      await service.saveConfig(TEST_ORG.id, TEST_USER.id, {
        idpEntityId: IDP_ENTITY_ID,
        idpSsoUrl: 'https://idp.example.com/sso',
      });

      expect(prisma.samlConfiguration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ idpCert: '' }),
        }),
      );
    });

    it('honors explicit override flags', async () => {
      prisma.samlConfiguration.upsert.mockResolvedValue({ id: 'cfg-1' });

      await service.saveConfig(TEST_ORG.id, TEST_USER.id, {
        ...baseInput,
        emailAttribute: 'mail',
        enabled: true,
        jitProvisioning: false,
        nameAttribute: 'displayName',
        ssoEnforced: true,
      });

      expect(prisma.samlConfiguration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            emailAttribute: 'mail',
            enabled: true,
            jitProvisioning: false,
            nameAttribute: 'displayName',
            ssoEnforced: true,
          }),
        }),
      );
    });
  });

  describe('deleteConfig', () => {
    it('deletes config rows scoped to the org', async () => {
      prisma.samlConfiguration.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteConfig(TEST_ORG.id);

      expect(prisma.samlConfiguration.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: TEST_ORG.id },
      });
    });
  });

  // -------------------------------------------------------------------------
  // SP Metadata
  // -------------------------------------------------------------------------

  describe('generateSpMetadata', () => {
    it('emits valid SP metadata with escaped entityID and ACS URL', () => {
      const xml = service.generateSpMetadata(
        TEST_ORG.id,
        'https://sp.example.com/meta?a=1&b=2',
        'https://sp.example.com/acs',
      );

      expect(xml).toContain('<md:EntityDescriptor');
      expect(xml).toContain('WantAssertionsSigned="true"');
      expect(xml).toContain('Location="https://sp.example.com/acs"');
      // Ampersand in the entityID must be XML-escaped.
      expect(xml).toContain('entityID="https://sp.example.com/meta?a=1&amp;b=2"');
    });
  });

  // -------------------------------------------------------------------------
  // AuthnRequest
  // -------------------------------------------------------------------------

  describe('buildAuthnRequest', () => {
    it('builds a redirect URL whose SAMLRequest deflates back to a valid AuthnRequest', () => {
      const config = makeConfig();
      const url = service.buildAuthnRequest(
        config,
        'https://sp.example.com/meta',
        'https://sp.example.com/acs',
        'relay-xyz',
      );

      expect(url.startsWith(`${config.idpSsoUrl}?`)).toBe(true);

      const params = new URL(url).searchParams;
      expect(params.get('RelayState')).toBe('relay-xyz');

      const encoded = params.get('SAMLRequest');
      expect(encoded).toBeTruthy();
      const inflated = zlib
        .inflateRawSync(Buffer.from(encoded as string, 'base64'))
        .toString('utf8');

      expect(inflated).toContain('<samlp:AuthnRequest');
      expect(inflated).toContain(
        'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
      );
      expect(inflated).toContain('<saml:Issuer>https://sp.example.com/meta</saml:Issuer>');
      expect(inflated).toContain('AssertionConsumerServiceURL="https://sp.example.com/acs"');
    });

    it('uses the current time for IssueInstant', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
      try {
        const url = service.buildAuthnRequest(
          makeConfig(),
          'https://sp.example.com/meta',
          'https://sp.example.com/acs',
          'r',
        );
        const encoded = new URL(url).searchParams.get('SAMLRequest') as string;
        const inflated = zlib.inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
        expect(inflated).toContain('IssueInstant="2026-06-24T12:00:00.000Z"');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // parseAndValidateResponse — happy path + claim extraction
  // -------------------------------------------------------------------------

  describe('parseAndValidateResponse', () => {
    it('extracts claims from a validly signed response and lowercases email', async () => {
      const samlResponse = buildSignedResponse({
        email: 'Jane.Doe@Example.com',
        name: 'Jane Doe',
        nameId: 'jane-nameid',
      });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);

      expect(claims).toEqual({
        email: 'jane.doe@example.com',
        name: 'Jane Doe',
        nameId: 'jane-nameid',
      });
    });

    it('falls back to the NameID as email when no email attribute is present', async () => {
      const samlResponse = buildSignedResponse({
        email: null,
        name: 'Jane Doe',
        nameId: 'jane@corp.example.com',
      });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);

      expect(claims.email).toBe('jane@corp.example.com');
    });

    it('derives the name from the email local-part when no name attribute is present', async () => {
      const samlResponse = buildSignedResponse({
        email: 'someone@example.com',
        name: null,
        nameId: 'someone-nameid',
      });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);

      expect(claims.name).toBe('someone');
    });

    it('verifies signatures using the rsa-sha1 algorithm', async () => {
      const samlResponse = buildSignedResponse({ digestAlg: 'sha1', sigAlg: 'rsa-sha1' });
      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);
      expect(claims.email).toBe('user@example.com');
    });

    it('throws when the Issuer does not match the configured IdP entity ID', async () => {
      const samlResponse = buildSignedResponse({ issuer: 'https://evil.example.com' });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        SamlParseError,
      );
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /Issuer mismatch/,
      );
    });

    it('throws when the response has no Issuer', async () => {
      const xml = '<samlp:Response><saml:Assertion ID="_a"/></samlp:Response>';
      const encoded = Buffer.from(xml, 'utf8').toString('base64');
      await expect(service.parseAndValidateResponse(makeConfig(), encoded)).rejects.toThrow(
        /missing Issuer/,
      );
    });

    it('throws when the response is unsigned', async () => {
      const xml =
        `<samlp:Response><saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        `<saml:Assertion ID="_a"><saml:Subject><saml:NameID>x</saml:NameID></saml:Subject></saml:Assertion>` +
        `</samlp:Response>`;
      const encoded = Buffer.from(xml, 'utf8').toString('base64');
      await expect(service.parseAndValidateResponse(makeConfig(), encoded)).rejects.toThrow(
        /not signed/,
      );
    });

    it('rejects a response signed by a different (untrusted) key', async () => {
      const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const samlResponse = buildSignedResponse({ signKey: otherKey });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /signature is invalid/,
      );
    });

    it('rejects an unsupported signature algorithm', async () => {
      // Construct a SignedInfo with a bogus algorithm; signature value present.
      const assertion =
        '<saml:Assertion ID="_a"><saml:Subject><saml:NameID>x@example.com</saml:NameID></saml:Subject></saml:Assertion>';
      const xml =
        `<samlp:Response><saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        `<ds:Signature><ds:SignedInfo>` +
        `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#hmac-md5"/>` +
        `<ds:Reference URI="#_a"/></ds:SignedInfo>` +
        `<ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature>` +
        assertion +
        `</samlp:Response>`;
      const encoded = Buffer.from(xml, 'utf8').toString('base64');
      await expect(service.parseAndValidateResponse(makeConfig(), encoded)).rejects.toThrow(
        /Unsupported SAML signature algorithm/,
      );
    });

    it('detects content substitution via digest mismatch (signature wrapping)', async () => {
      // Tamper the signed assertion content after computing the signature so the
      // SignedInfo verifies but the referenced element no longer matches its digest.
      const samlResponse = buildSignedResponse({
        name: 'Jane Doe',
        tamperAssertionAfterSign: true,
      });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /digest mismatch/,
      );
    });

    it('throws when the email attribute and NameID cannot yield an email', async () => {
      const samlResponse = buildSignedResponse({
        email: null,
        name: 'No Email',
        nameId: 'no-email-here',
      });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /missing email attribute/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // jitProvisionUser
  // -------------------------------------------------------------------------

  describe('jitProvisionUser', () => {
    const claims = { email: 'new@example.com', name: 'New Person', nameId: 'nid' };

    it('returns the existing user and ensures org membership without creating', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...TEST_USER, email: claims.email });
      prisma.organizationMember.upsert.mockResolvedValue({});

      const result = await service.jitProvisionUser(prisma as never, TEST_ORG.id, claims);

      expect(result).toEqual({ isNew: false, userId: TEST_USER.id });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.organizationMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_userId: { organizationId: TEST_ORG.id, userId: TEST_USER.id },
          },
        }),
      );
    });

    it('creates a new user with derived initials and ensures membership', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, email: claims.email, id: 'new-id' });
      prisma.organizationMember.upsert.mockResolvedValue({});

      const result = await service.jitProvisionUser(prisma as never, TEST_ORG.id, claims);

      expect(result).toEqual({ isNew: true, userId: 'new-id' });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          displayName: 'New Person',
          email: claims.email,
          initials: 'NP',
          name: 'New Person',
        },
      });
      expect(prisma.organizationMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { organizationId: TEST_ORG.id, role: 'member', userId: 'new-id' },
        }),
      );
    });

    it('derives two-letter initials from a single-word name', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, id: 'solo-id' });
      prisma.organizationMember.upsert.mockResolvedValue({});

      await service.jitProvisionUser(prisma as never, TEST_ORG.id, {
        email: 'solo@example.com',
        name: 'Cher',
        nameId: 'nid',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ initials: 'CH' }),
      });
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});
