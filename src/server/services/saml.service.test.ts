import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { mockSyncActionInserts, readSyncActionInserts } from '../../test/sync-action-mock';
import {
  resetSamlReplayCacheForTests,
  type SamlConfig,
  type SamlConfigInput,
  SamlParseError,
  SamlService,
} from './saml.service';

// JIT provisioning announces the new membership over a real SyncService bound
// to the redis singleton, so the roster reaches clients already connected to
// the workspace. Mock the module so that publish is a no-op here.
// The replay guard claims each assertion ID in Redis with SET NX; the fake
// honours NX so a second claim on the same key answers `null` like the real
// thing. `redisClaims` is cleared with the in-memory cache in beforeEach.
const redisClaims = new Set<string>();
vi.mock('../lib/redis', () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(1),
    set: vi.fn(async (key: string) => {
      if (redisClaims.has(key)) {
        return null;
      }
      redisClaims.add(key);
      return 'OK';
    }),
  },
}));

// ---------------------------------------------------------------------------
// Signed-XML test helpers
//
// We generate a real RSA keypair and sign fixtures with xml-crypto's own
// `SignedXml` (real Exclusive C14N + digest + signature computation) so the
// service's xml-crypto-based verification path runs for real end-to-end,
// rather than the old whitespace-normalization shortcut (which xml-crypto
// would — correctly — reject as an invalid signature).
// ---------------------------------------------------------------------------

const { privateKey, certPem } = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  // The service passes the PEM straight to xml-crypto, which accepts a raw
  // public key PEM, so we can use the SPKI public key in place of a certificate.
  return {
    certPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKey,
  };
})();

const SIGNATURE_ALGORITHM_URI: Record<'rsa-sha1' | 'rsa-sha256', string> = {
  'rsa-sha1': 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  'rsa-sha256': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
};
const DIGEST_ALGORITHM_URI: Record<'sha1' | 'sha256', string> = {
  sha1: 'http://www.w3.org/2000/09/xmldsig#sha1',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
};
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';

/**
 * Sign `xml` (which must contain exactly one element matching `referenceXpath`,
 * carrying its own ID attribute) using xml-crypto, inserting the resulting
 * `<ds:Signature>` immediately after the element matched by `insertAfterXpath`.
 * Mirrors how a real IdP places a Response-level signature referencing the
 * Assertion by ID (Signature as a sibling of Issuer/Assertion, not enveloping
 * them).
 */
function signXml(
  xml: string,
  opts: {
    digestAlg: 'sha1' | 'sha256';
    insertAfterXpath: string;
    referenceXpath: string;
    sigAlg: 'rsa-sha1' | 'rsa-sha256';
    signKey: crypto.KeyObject;
  },
): string {
  const signer = new SignedXml({
    canonicalizationAlgorithm: EXC_C14N,
    privateKey: opts.signKey,
    signatureAlgorithm: SIGNATURE_ALGORITHM_URI[opts.sigAlg],
  });
  signer.addReference({
    digestAlgorithm: DIGEST_ALGORITHM_URI[opts.digestAlg],
    transforms: [EXC_C14N],
    xpath: opts.referenceXpath,
  });
  signer.computeSignature(xml, {
    location: { action: 'after', reference: opts.insertAfterXpath },
    prefix: 'ds',
  });
  return signer.getSignedXml();
}

const IDP_ENTITY_ID = 'https://idp.example.com/metadata';
const SP_ENTITY_ID = 'https://sp.example.com/api/auth/saml/metadata?org=acme';

function normalize(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

interface SignedResponseOptions {
  assertionId?: string;
  /** Pass null to omit AudienceRestriction/Audience entirely. */
  audience?: string | null;
  digestAlg?: 'sha1' | 'sha256';
  email?: string | null;
  emailAttribute?: string;
  issuer?: string;
  name?: string | null;
  nameAttribute?: string;
  nameId?: string;
  /** Pass null to omit the Conditions element entirely (fails closed). */
  notBefore?: string | null;
  notOnOrAfter?: string | null;
  sigAlg?: 'rsa-sha1' | 'rsa-sha256';
  signKey?: crypto.KeyObject;
  /** Pass null to omit SubjectConfirmationData entirely. */
  subjectConfirmationNotOnOrAfter?: string | null;
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

  // Default to a comfortably valid 10-minute window around "now" so the
  // happy-path tests (which don't mock time) pass without extra setup.
  const nowMs = Date.now();
  const notBefore =
    opts.notBefore === null ? null : (opts.notBefore ?? new Date(nowMs - 5 * 60_000).toISOString());
  const notOnOrAfter =
    opts.notOnOrAfter === null
      ? null
      : (opts.notOnOrAfter ?? new Date(nowMs + 5 * 60_000).toISOString());

  const audienceXml =
    opts.audience === null
      ? ''
      : `<saml:AudienceRestriction><saml:Audience>${opts.audience ?? SP_ENTITY_ID}</saml:Audience></saml:AudienceRestriction>`;

  // Build NotBefore/NotOnOrAfter as genuinely-optional attributes (omitted
  // entirely, not just present-empty) so a test can exercise a conformant
  // IdP that leaves one of them out per SAML 2.0 §2.5.1.
  const notBeforeAttr = notBefore === null ? '' : ` NotBefore="${notBefore}"`;
  const notOnOrAfterAttr = notOnOrAfter === null ? '' : ` NotOnOrAfter="${notOnOrAfter}"`;
  const conditionsXml =
    notBefore === null && notOnOrAfter === null
      ? ''
      : `<saml:Conditions${notBeforeAttr}${notOnOrAfterAttr}>${audienceXml}</saml:Conditions>`;

  const subjectConfirmationXml =
    opts.subjectConfirmationNotOnOrAfter === null
      ? ''
      : `<saml:SubjectConfirmation><saml:SubjectConfirmationData NotOnOrAfter="${
          opts.subjectConfirmationNotOnOrAfter ??
          notOnOrAfter ??
          new Date(nowMs + 5 * 60_000).toISOString()
        }"/></saml:SubjectConfirmation>`;

  // SAML 2.0 core §2.3.3 makes Issuer REQUIRED on the Assertion itself, and
  // that is the copy the service reads — the Response-level one sits outside
  // an assertion-only signature. Real IdPs emit both.
  const assertionIssuerXml = issuer === '' ? '' : `<saml:Issuer>${issuer}</saml:Issuer>`;
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}">` +
    assertionIssuerXml +
    `<saml:Subject><saml:NameID>${nameId}</saml:NameID>${subjectConfirmationXml}</saml:Subject>` +
    conditionsXml +
    `<saml:AttributeStatement>${attrLines.join('')}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const unsignedResponse =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    assertion +
    `</samlp:Response>`;

  let xml = signXml(unsignedResponse, {
    digestAlg,
    insertAfterXpath: "//*[local-name(.)='Issuer']",
    referenceXpath: "//*[local-name(.)='Assertion']",
    sigAlg,
    signKey,
  });

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
    spEntityId: SP_ENTITY_ID,
    ...overrides,
  };
}

describe('SamlService', () => {
  let prisma: MockPrismaClient;
  let service: SamlService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SamlService(prisma as never);
    // The replay guard is a module-level cache keyed by assertion ID; many
    // tests reuse the same default assertion ID, so it must be reset between
    // tests to avoid cross-test contamination.
    resetSamlReplayCacheForTests();
    redisClaims.clear();
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

    it('throws when the signed assertion has no Issuer', async () => {
      // Validly signed, so the check under test is the one that fires — an
      // unsigned document is refused by signature verification first.
      const samlResponse = buildSignedResponse({ issuer: '' });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /missing Issuer/,
      );
    });

    it('reads the Issuer from the signed fragment, not from unsigned surrounding XML', async () => {
      // The Response-level Issuer is outside an assertion-only signature. Swap
      // it for the configured IdP after signing: the unsigned copy must not
      // be what satisfies the check.
      const forged = Buffer.from(
        buildSignedResponse({ issuer: 'https://rogue.example.com' }),
        'base64',
      )
        .toString('utf8')
        .replace(
          '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"><saml:Issuer>https://rogue.example.com</saml:Issuer>',
          `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"><saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>`,
        );
      expect(forged).toContain(`<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>`);
      await expect(
        service.parseAndValidateResponse(
          makeConfig(),
          Buffer.from(forged, 'utf8').toString('base64'),
        ),
      ).rejects.toThrow(/Issuer mismatch/);
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

    it('rejects a signature-wrapping attempt where the signed Reference wraps two assertions', async () => {
      // The Reference targets a wrapper element (not the Assertion itself)
      // that legitimately contains BOTH a real Assertion and an attacker's
      // injected decoy — the digest over the whole wrapper still validates
      // (nothing was tampered with post-signing), but claim extraction must
      // never be ambiguous about which Assertion is trustworthy.
      const notOnOrAfter = new Date(Date.now() + 5 * 60_000).toISOString();
      const realAssertion =
        '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_real">' +
        '<saml:Subject><saml:NameID>user@example.com</saml:NameID></saml:Subject>' +
        `<saml:Conditions NotOnOrAfter="${notOnOrAfter}"/>` +
        '<saml:AttributeStatement/></saml:Assertion>';
      const decoyAssertion =
        '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_decoy">' +
        '<saml:Subject><saml:NameID>attacker@evil.example.com</saml:NameID></saml:Subject>' +
        `<saml:Conditions NotOnOrAfter="${notOnOrAfter}"/>` +
        '<saml:AttributeStatement><saml:Attribute Name="email">' +
        '<saml:AttributeValue>attacker@evil.example.com</saml:AttributeValue>' +
        '</saml:Attribute></saml:AttributeStatement></saml:Assertion>';
      const wrapper =
        '<saml:Extensions xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_wrap1">' +
        `${realAssertion}${decoyAssertion}</saml:Extensions>`;

      const unsignedResponse =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
        `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        wrapper +
        `</samlp:Response>`;

      const xml = signXml(unsignedResponse, {
        digestAlg: 'sha256',
        insertAfterXpath: "//*[local-name(.)='Issuer']",
        referenceXpath: "//*[local-name(.)='Extensions']",
        sigAlg: 'rsa-sha256',
        signKey: privateKey,
      });
      const samlResponse = Buffer.from(xml, 'utf8').toString('base64');

      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /exactly one Assertion/,
      );
    });

    it('rejects a signature-wrapping attempt via a duplicate-ID decoy assertion', async () => {
      // A second, unsigned Assertion is injected as a sibling of the
      // legitimately-signed one, reusing its exact ID attribute value — the
      // classic XML signature-wrapping vector. xml-crypto refuses to
      // validate any document containing duplicate ID values outright,
      // regardless of what our own Reference/Assertion-count guards do.
      const assertionId = '_dup-id';
      const notOnOrAfter = new Date(Date.now() + 5 * 60_000).toISOString();
      const legitAssertion =
        `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}">` +
        '<saml:Subject><saml:NameID>user@example.com</saml:NameID></saml:Subject>' +
        `<saml:Conditions NotOnOrAfter="${notOnOrAfter}"/>` +
        '<saml:AttributeStatement/></saml:Assertion>';

      const unsignedResponse =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
        `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        legitAssertion +
        `</samlp:Response>`;

      const signedXml = signXml(unsignedResponse, {
        digestAlg: 'sha256',
        insertAfterXpath: "//*[local-name(.)='Issuer']",
        referenceXpath: "//*[local-name(.)='Assertion']",
        sigAlg: 'rsa-sha256',
        signKey: privateKey,
      });

      const decoyAssertion =
        `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}">` +
        '<saml:Subject><saml:NameID>attacker@evil.example.com</saml:NameID></saml:Subject>' +
        `<saml:Conditions NotOnOrAfter="${notOnOrAfter}"/>` +
        '<saml:AttributeStatement><saml:Attribute Name="email">' +
        '<saml:AttributeValue>attacker@evil.example.com</saml:AttributeValue>' +
        '</saml:Attribute></saml:AttributeStatement></saml:Assertion>';
      const xml = signedXml.replace('</samlp:Response>', `${decoyAssertion}</samlp:Response>`);
      const samlResponse = Buffer.from(xml, 'utf8').toString('base64');

      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /signature-wrapping/,
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

    // -----------------------------------------------------------------------
    // Hardening: Conditions / audience / replay / signature fail-closed
    // -----------------------------------------------------------------------

    it('rejects an assertion with no Conditions element (no expiry to enforce)', async () => {
      const samlResponse = buildSignedResponse({ notBefore: null, notOnOrAfter: null });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /Conditions/,
      );
    });

    it('rejects an assertion that is not yet valid (NotBefore in the future)', async () => {
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      const samlResponse = buildSignedResponse({ notBefore: future });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /not yet valid/,
      );
    });

    it('rejects an expired assertion (NotOnOrAfter in the past)', async () => {
      const past = new Date(Date.now() - 10 * 60_000).toISOString();
      const samlResponse = buildSignedResponse({
        notBefore: new Date(Date.now() - 20 * 60_000).toISOString(),
        notOnOrAfter: past,
      });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /expired/,
      );
    });

    it('rejects an assertion whose SubjectConfirmationData has expired', async () => {
      const past = new Date(Date.now() - 10 * 60_000).toISOString();
      const samlResponse = buildSignedResponse({ subjectConfirmationNotOnOrAfter: past });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /SubjectConfirmationData has expired/,
      );
    });

    it('rejects an assertion whose Audience does not match the configured SP entity id', async () => {
      const samlResponse = buildSignedResponse({ audience: 'https://evil.example.com/sp' });
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /audience restriction mismatch/,
      );
    });

    it('accepts an AudienceRestriction match and does not fail closed when no spEntityId is configured', async () => {
      // No spEntityId configured: audience validation is skipped defensively
      // rather than failing closed (documented limitation).
      const samlResponse = buildSignedResponse({ audience: 'https://anything.example.com/sp' });
      const configWithoutAudience = makeConfig({ spEntityId: undefined });
      const claims = await service.parseAndValidateResponse(configWithoutAudience, samlResponse);
      expect(claims.email).toBe('user@example.com');
    });

    it('rejects a replayed assertion (same ID used twice)', async () => {
      const samlResponse = buildSignedResponse({ assertionId: '_replay-once' });
      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);
      expect(claims.email).toBe('user@example.com');

      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /replay/,
      );
    });

    it('refuses an assertion another instance already consumed (Redis claim lost)', async () => {
      // Simulates a horizontally-scaled deployment: this process has never
      // seen the ID (its in-memory cache is empty) but Redis has.
      const samlResponse = buildSignedResponse({ assertionId: '_seen-elsewhere' });
      redisClaims.add('saml:assertion:_seen-elsewhere');

      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /replay/,
      );
    });

    it('still catches a same-process replay when Redis is unavailable', async () => {
      const { redis } = await import('../lib/redis');
      const set = redis.set as unknown as ReturnType<typeof vi.fn>;
      set
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const samlResponse = buildSignedResponse({ assertionId: '_redis-down' });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);
      expect(claims.email).toBe('user@example.com');
      await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
        /replay/,
      );
    });

    it('rejects a replay in the clock-skew tail just after NotOnOrAfter (prune-window bug)', async () => {
      // validateConditions() still ACCEPTS an assertion for an extra
      // CLOCK_SKEW_MS (60s) past Conditions/@NotOnOrAfter. The replay cache
      // must key its eviction on that same acceptance horizon — otherwise
      // the cached assertion id gets pruned right before this replay check
      // runs, and the replay slips through.
      vi.useFakeTimers();
      try {
        const start = new Date('2026-06-24T12:00:00.000Z');
        vi.setSystemTime(start);

        const notOnOrAfter = new Date(start.getTime() + 60_000).toISOString();
        const samlResponse = buildSignedResponse({
          assertionId: '_replay-tail',
          notBefore: new Date(start.getTime() - 5 * 60_000).toISOString(),
          notOnOrAfter,
        });

        const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);
        expect(claims.email).toBe('user@example.com');

        // Advance 30s past NotOnOrAfter — still inside the 60s clock-skew
        // tolerance, so validateConditions would still accept a *fresh*
        // assertion at this instant. The replay check must still fire.
        vi.setSystemTime(new Date(notOnOrAfter).getTime() + 30_000);

        await expect(service.parseAndValidateResponse(makeConfig(), samlResponse)).rejects.toThrow(
          /replay/,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('accepts an assertion with NotOnOrAfter but no NotBefore (NotBefore is optional per SAML core)', async () => {
      const samlResponse = buildSignedResponse({
        assertionId: '_no-notbefore',
        notBefore: null,
        notOnOrAfter: new Date(Date.now() + 5 * 60_000).toISOString(),
      });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);
      expect(claims.email).toBe('user@example.com');
    });

    it('throws when the SignedInfo Reference has no URI (fails closed instead of trusting the whole document)', async () => {
      const assertion =
        '<saml:Assertion ID="_a"><saml:Subject><saml:NameID>x@example.com</saml:NameID></saml:Subject></saml:Assertion>';
      const signedInfo =
        '<ds:SignedInfo>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        '<ds:Reference>' +
        '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
        '<ds:DigestValue>AAAA</ds:DigestValue>' +
        '</ds:Reference>' +
        '</ds:SignedInfo>';
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(normalize(signedInfo), 'utf8');
      const signatureValue = signer.sign(privateKey, 'base64');
      const xml =
        `<samlp:Response><saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        `<ds:Signature>${signedInfo}<ds:SignatureValue>${signatureValue}</ds:SignatureValue></ds:Signature>` +
        assertion +
        `</samlp:Response>`;
      const encoded = Buffer.from(xml, 'utf8').toString('base64');

      await expect(service.parseAndValidateResponse(makeConfig(), encoded)).rejects.toThrow(
        /no Reference URI/,
      );
    });

    it('throws when the Reference has no DigestMethod/DigestValue (fails closed instead of skipping)', async () => {
      const assertionId = '_a';
      const assertion = `<saml:Assertion ID="${assertionId}"><saml:Subject><saml:NameID>x@example.com</saml:NameID></saml:Subject></saml:Assertion>`;
      const signedInfo =
        '<ds:SignedInfo>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        `<ds:Reference URI="#${assertionId}"></ds:Reference>` +
        '</ds:SignedInfo>';
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(normalize(signedInfo), 'utf8');
      const signatureValue = signer.sign(privateKey, 'base64');
      const xml =
        `<samlp:Response><saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
        `<ds:Signature>${signedInfo}<ds:SignatureValue>${signatureValue}</ds:SignatureValue></ds:Signature>` +
        assertion +
        `</samlp:Response>`;
      const encoded = Buffer.from(xml, 'utf8').toString('base64');

      await expect(service.parseAndValidateResponse(makeConfig(), encoded)).rejects.toThrow(
        /missing a DigestMethod\/DigestValue/,
      );
    });

    it('still accepts a fully valid assertion after all hardening checks', async () => {
      const samlResponse = buildSignedResponse({
        assertionId: '_valid-assertion',
        email: 'Valid.User@Example.com',
        name: 'Valid User',
        nameId: 'valid-nameid',
      });

      const claims = await service.parseAndValidateResponse(makeConfig(), samlResponse);

      expect(claims).toEqual({
        email: 'valid.user@example.com',
        name: 'Valid User',
        nameId: 'valid-nameid',
      });
    });
  });

  // -------------------------------------------------------------------------
  // jitProvisionUser
  // -------------------------------------------------------------------------

  describe('jitProvisionUser', () => {
    const claims = { email: 'new@example.com', name: 'New Person', nameId: 'nid' };

    function membershipRow(userId: string) {
      return { id: `mem-${userId}`, organizationId: TEST_ORG.id, role: 'member', userId };
    }

    beforeEach(() => {
      mockSyncActionInserts(prisma);
    });

    it('returns the existing user and ensures org membership without creating', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...TEST_USER, email: claims.email });
      prisma.organizationMember.findUnique.mockResolvedValue(membershipRow(TEST_USER.id));

      const result = await service.jitProvisionUser(prisma as never, TEST_ORG.id, claims);

      expect(result).toEqual({ isNew: false, userId: TEST_USER.id });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_userId: { organizationId: TEST_ORG.id, userId: TEST_USER.id },
        },
      });
      // Already a member: nothing changed, so nothing is broadcast.
      expect(prisma.organizationMember.create).not.toHaveBeenCalled();
      expect(readSyncActionInserts(prisma)).toEqual([]);
    });

    it('creates a new user with derived initials and ensures membership', async () => {
      // Two lookups: the JIT "do we know this email" (null → create), then
      // `announceJoin` fetching the row it ships alongside the membership.
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...TEST_USER, email: claims.email, id: 'new-id' });
      // Non-empty users table → this JIT user is not the bootstrap admin.
      prisma.user.count.mockResolvedValue(3);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, email: claims.email, id: 'new-id' });
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue(membershipRow('new-id'));

      const result = await service.jitProvisionUser(prisma as never, TEST_ORG.id, claims);

      expect(result).toEqual({ isNew: true, userId: 'new-id' });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          displayName: 'New Person',
          email: claims.email,
          initials: 'NP',
          isPlatformAdmin: false,
          name: 'New Person',
        },
      });
      expect(prisma.organizationMember.create).toHaveBeenCalledWith({
        data: { organizationId: TEST_ORG.id, role: 'member', userId: 'new-id' },
      });
      // A JIT join is a roster change, and the roster is synced. Both halves
      // have to go out: the membership alone is inert on a client that has
      // never heard of this person, because bootstrap only ships `users` for
      // people who were already members.
      expect(readSyncActionInserts(prisma).map(a => [a.action, a.modelName])).toEqual([
        ['I', 'User'],
        ['I', 'OrganizationMember'],
      ]);
    });

    it('bootstraps the first-ever user as platform admin', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      // Empty users table → this SSO login is the deployment's first account.
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, email: claims.email, id: 'first-id' });
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue(membershipRow('first-id'));

      await service.jitProvisionUser(prisma as never, TEST_ORG.id, claims);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPlatformAdmin: true }) }),
      );
    });

    it('derives two-letter initials from a single-word name', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, id: 'solo-id' });
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue(membershipRow('solo-id'));

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
