import { notFound } from 'next/navigation';

/**
 * Catch-all so an unknown path under a workspace resolves *inside* the
 * workspace layout (and so renders `[workspace]/not-found.tsx` within the app
 * shell) instead of falling through to the root, shell-less 404.
 */
export default function MissingWorkspacePage() {
  notFound();
}
