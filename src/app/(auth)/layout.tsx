import { AuthCanvas } from '@/components/auth/auth-canvas';

/**
 * Split canvas: product framing on the left, the form on the right.
 *
 * Below `lg` the canvas drops out entirely and the form gets the whole
 * viewport — on a phone the decoration would push the actual task below the
 * fold, which is the opposite of what a sign-in screen is for.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <AuthCanvas />
      <div className="flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
