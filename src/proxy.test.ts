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

  it('matcher skips api, _next and static files but covers pages', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/acme/team/ENG')).toBe(true);
    expect(re.test('/admin')).toBe(true);
    expect(re.test('/api/graphql')).toBe(false);
    expect(re.test('/_next/static/x.js')).toBe(false);
    expect(re.test('/sw.js')).toBe(false);
    expect(re.test('/offline.html')).toBe(false);
  });
});
