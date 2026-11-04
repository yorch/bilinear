import { AuthCanvas } from '@/components/auth/auth-canvas';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Split canvas: product framing on the left, the form on the right.
 *
 * Below `lg` the canvas drops out entirely and the form gets the whole
 * viewport — on a phone the decoration would push the actual task below the
 * fold, which is the opposite of what a sign-in screen is for.
 *
 * Language and theme controls sit in the form column's corner: a visitor who
 * isn't signed in has no settings page yet, and the language otherwise falls
 * back to whatever Accept-Language said.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <AuthCanvas />
      <div className="relative flex flex-col items-center justify-center px-4 py-16 sm:px-6">
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <LanguageToggle compact />
          <ThemeToggle compact />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
