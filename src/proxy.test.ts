import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { REQUEST_PATH_HEADER } from '@/lib/deep-link';
import { config, proxy } from './proxy';

function forwarded(url: string, headers: Record<string, string> = {}) {
  const res = proxy(new NextRequest(url, { headers }));
  // NextResponse.next({request:{headers}}) advertises overrides this way.
  return res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`);
}

describe('proxy', () => {
  it('forwards pathname and search', () => {
    expect(forwarded('http://localhost:3000/acme/team/ENG?view=board')).toBe(
      '/acme/team/ENG?view=board',
    );
  });

  it('overwrites a client-supplied header', () => {
    expect(
      forwarded('http://localhost:3000/acme', { [REQUEST_PATH_HEADER]: '//evil.example' }),
    ).toBe('/acme');
  });

  const re = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    '/acme/team/ENG',
    '/admin',
    '/',
    '/apiary/team/ENG',
    '/api-docs',
    '/apiary',
    '/demo/project/v1.2',
    '/demo/docs/release-2.0.1',
    '/demo/issue/abc.def',
  ])('matcher covers the page %s', path => {
    expect(re.test(path)).toBe(true);
  });

  // A page whose path merely ends in a static-looking extension is still a
  // document request; skipping it let a forged x-bilinear-path reach the layout.
  it.each([
    '/demo/issue/ABC-1.png',
    '/demo/settings/x.json',
    '/demo/project/report.pdf',
    '/demo/team/ENG/view.css',
  ])('matcher covers extension-suffixed page %s', path => {
    expect(re.test(path)).toBe(true);
  });

  it.each(['/api', '/api/', '/api/graphql', '/_next/static/x.js', '/_next/image'])(
    'matcher skips %s',
    path => {
      expect(re.test(path)).toBe(false);
    },
  );
});
