import type { Metadata } from 'next';

/**
 * `/design` is an internal reference, reachable without a session. Keep it out
 * of search indexes; the page itself is a client component and can't export
 * metadata.
 */
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Design reference',
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
