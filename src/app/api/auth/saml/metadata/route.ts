import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import { SamlService } from '@/server/services/saml.service';

const samlService = new SamlService(prisma);

/**
 * GET /api/auth/saml/metadata?org=<urlKey>
 *
 * Returns the SP (Service Provider) SAML metadata XML for the given org.
 * The IdP administrator needs this to configure the trust relationship.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgKey = searchParams.get('org');

  if (!orgKey) {
    return NextResponse.json({ error: 'Missing org parameter' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { urlKey: orgKey },
  });

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const config = await samlService.getConfig(org.id);
  if (!config) {
    return NextResponse.json(
      { error: 'SAML not configured for this organization' },
      { status: 404 },
    );
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const spEntityId = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;
  const acsUrl = `${appUrl}/api/auth/saml/callback`;

  const xml = samlService.generateSpMetadata(org.id, spEntityId, acsUrl);

  return new NextResponse(xml, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
