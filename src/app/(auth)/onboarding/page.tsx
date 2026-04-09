import { OnboardingForm } from '@/components/auth/onboarding-form';

export const metadata = { title: 'Create your workspace — Issue Tracker' };

export default function OnboardingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create your workspace
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Set up your organization to get started
        </p>
      </div>
      <OnboardingForm />
    </div>
  );
}
