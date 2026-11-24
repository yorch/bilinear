'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthField } from '@/components/auth/auth-field';
import { AuthHeader } from '@/components/auth/auth-header';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import {
  deriveTeamKey,
  onboardingResumeUrl,
  parseInviteEmails,
  type ResumeStep,
  sanitizeTeamKey,
} from '@/components/auth/onboarding-steps';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { ORGANIZATION_INVITE_CREATE_MUTATION, TEAM_CREATE_MUTATION } from '@/lib/graphql-queries';

type Step = 'invite' | 'team' | 'workspace';

interface Created {
  name: string;
  urlKey: string;
}

/**
 * Three small steps — workspace, first team, invite teammates — so a new
 * workspace does not land on an empty "No teams" screen. The second and third
 * are skippable; the first is the only one that is required.
 */
export function OnboardingFlow({
  backTo,
  defaultName,
  host,
  resume = null,
}: {
  /** Set when the visitor already has a workspace to return to. */
  backTo: { name: string; urlKey: string } | null;
  defaultName: string;
  host: string;
  /** A validated step 2/3 position restored from the URL after a reload. */
  resume?: { name: string; step: ResumeStep; urlKey: string } | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<Step>(resume?.step ?? 'workspace');
  const [created, setCreated] = useState<Created | null>(
    resume ? { name: resume.name, urlKey: resume.urlKey } : null,
  );

  function goTo(next: ResumeStep, urlKey: string) {
    setStep(next);
    // Not router.replace: nothing server-side needs to re-render now, and a
    // history entry per step would make Back re-open a finished step.
    window.history.replaceState(null, '', onboardingResumeUrl(next, urlKey));
  }

  function finish(urlKey: string) {
    router.push(`/${urlKey}`);
  }

  const titles: Record<Step, { subtitle: string; title: string }> = {
    invite: { subtitle: t('auth.setup.inviteSubtitle'), title: t('auth.setup.inviteTitle') },
    team: { subtitle: t('auth.setup.teamSubtitle'), title: t('auth.setup.teamTitle') },
    workspace: {
      subtitle: t('auth.createWorkspaceSubtitle'),
      title: t('auth.createWorkspace'),
    },
  };
  const stepNumber = step === 'workspace' ? 1 : step === 'team' ? 2 : 3;

  return (
    <div className="flex flex-col gap-6">
      {backTo && step === 'workspace' && (
        <Link
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
          href={`/${backTo.urlKey}`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('auth.backToWorkspace', { workspace: backTo.name })}
        </Link>
      )}
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {t('auth.setup.stepOf', { current: stepNumber, total: 3 })}
        </p>
        <AuthHeader subtitle={titles[step].subtitle} title={titles[step].title} />
      </div>
      {step === 'workspace' && (
        <OnboardingForm
          defaultName={defaultName}
          host={host}
          onCreated={org => {
            setCreated(org);
            goTo('team', org.urlKey);
          }}
        />
      )}
      {step === 'team' && created && (
        <TeamStep onDone={() => goTo('invite', created.urlKey)} workspaceName={created.name} />
      )}
      {step === 'invite' && created && <InviteStep onDone={() => finish(created.urlKey)} />}
    </div>
  );
}

function TeamStep({ onDone, workspaceName }: { onDone: () => void; workspaceName: string }) {
  const t = useTranslations();
  const [name, setName] = useState(workspaceName);
  const [key, setKey] = useState(deriveTeamKey(workspaceName));
  const [keyEdited, setKeyEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await gql(TEAM_CREATE_MUTATION, {
        input: { key, name: name.trim(), private: false },
      });
      if (res.errors?.length) {
        setError((res.errors[0] as { message: string }).message);
        return;
      }
      onDone();
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <AuthField
        autoFocus
        id="team-name"
        label={t('auth.setup.teamName')}
        onChange={e => {
          setName(e.target.value);
          if (!keyEdited) {
            setKey(deriveTeamKey(e.target.value));
          }
        }}
        placeholder={t('auth.setup.teamNamePlaceholder')}
        required
        value={name}
      />
      <AuthField
        autoCapitalize="characters"
        autoComplete="off"
        className="font-mono"
        hint={t('auth.setup.teamKeyHint')}
        id="team-key"
        label={t('auth.setup.teamKey')}
        onChange={e => {
          setKeyEdited(true);
          setKey(sanitizeTeamKey(e.target.value));
        }}
        required
        spellCheck={false}
        value={key}
      />
      {error && (
        <p className="text-sm text-danger-subtle-foreground" role="alert">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={loading || !name.trim() || !key} type="submit">
        {loading ? t('auth.setup.creatingTeam') : t('auth.setup.createTeam')}
      </Button>
      <Button disabled={loading} onClick={onDone} type="button" variant="ghost">
        {t('auth.setup.skip')}
      </Button>
    </form>
  );
}

function InviteStep({ onDone }: { onDone: () => void }) {
  const t = useTranslations();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { invalid, valid } = parseInviteEmails(text);
    if (invalid.length > 0) {
      setError(t('auth.setup.inviteInvalid', { emails: invalid.join(', ') }));
      return;
    }
    if (valid.length === 0) {
      onDone();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        valid.map(email => gql(ORGANIZATION_INVITE_CREATE_MUTATION, { email, role: 'member' })),
      );
      const failed = valid.filter((_, i) => results[i].errors?.length);
      if (failed.length > 0) {
        // Keep only the ones that did not go out so a retry doesn't re-send.
        setText(failed.join(', '));
        setError(t('auth.setup.inviteFailed', { emails: failed.join(', ') }));
        return;
      }
      onDone();
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <AuthField
        autoCapitalize="none"
        autoFocus
        error={error}
        hint={t('auth.setup.inviteHint')}
        id="invite-emails"
        inputMode="email"
        label={t('auth.setup.inviteLabel')}
        onChange={e => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder={t('auth.setup.invitePlaceholder')}
        spellCheck={false}
        value={text}
      />
      <Button className="w-full" disabled={loading} type="submit">
        {loading
          ? t('auth.setup.sendingInvites')
          : text.trim()
            ? t('auth.setup.sendInvites')
            : t('auth.setup.finish')}
      </Button>
      <Button disabled={loading} onClick={onDone} type="button" variant="ghost">
        {t('auth.setup.skip')}
      </Button>
    </form>
  );
}
