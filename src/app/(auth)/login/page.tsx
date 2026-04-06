import { LoginForm } from '@/components/auth/login-form';

export const metadata = { title: 'Sign in — Issue Tracker' };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sign in to Issue Tracker
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter your email to receive a sign-in link
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
