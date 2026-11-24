'use client';

import { ImagePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
import { USER_UPDATE_PROFILE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const MAX_NAME_LENGTH = 255;

interface ProfileResult {
  userUpdateProfile: {
    user: { avatarUrl: string | null; displayName: string; initials: string; name: string };
  };
}

/**
 * The viewer's own name and avatar — the one place an email sign-up (whose
 * name is just the address's local part) can fix it. The server announces a
 * User SyncAction, but the store is also patched here so the card does not
 * wait on the socket.
 */
export const ProfileCard = observer(function ProfileCard() {
  const { userStore } = useStore();
  const t = useTranslations();
  const user = userStore.currentUser;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) {
    return null;
  }

  const name = draft ?? user.name;
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_NAME_LENGTH;

  async function save(input: { avatarUrl?: string | null; name?: string }) {
    const data = (await gqlMutate(USER_UPDATE_PROFILE_MUTATION, {
      input,
    })) as unknown as ProfileResult;
    const updated = data.userUpdateProfile.user;
    if (user) {
      userStore.upsertMany([{ ...user, ...updated }]);
    }
    toast.success(t('settings.profile.saved'));
  }

  async function saveName() {
    if (!valid || trimmed === user?.name) {
      return;
    }
    setSaving(true);
    try {
      await save({ name: trimmed });
      setDraft(null);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.profile.saveError')));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { body: form, method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? t('settings.profile.avatarError'));
      }
      await save({ avatarUrl: body.url });
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.profile.avatarError')));
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  }

  async function removeAvatar() {
    try {
      await save({ avatarUrl: null });
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.profile.saveError')));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <dl className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          <dt className="pt-0.5 text-xs font-medium text-muted-foreground">
            {t('settings.profile.avatar')}
          </dt>
          <dd className="col-span-2 flex flex-wrap items-center gap-3">
            <UserAvatar
              size="md"
              user={{
                avatarBackgroundColor: user.avatarBgColor,
                avatarUrl: user.avatarUrl,
                displayName: user.displayName,
                initials: user.initials,
              }}
            />
            <input
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  void uploadAvatar(file);
                }
              }}
              ref={fileRef}
              type="file"
            />
            <Button
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              size="sm"
              type="button"
              variant="outline"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {uploading
                ? t('settings.profile.avatarUploading')
                : t('settings.profile.avatarUpload')}
            </Button>
            {user.avatarUrl && (
              <Button
                disabled={uploading}
                onClick={() => void removeAvatar()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('settings.profile.avatarRemove')}
              </Button>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <dt className="pt-0.5 text-xs font-medium text-muted-foreground">
            {t('settings.profile.name')}
          </dt>
          <dd className="col-span-2">
            <form
              className="flex items-center gap-2"
              onSubmit={e => {
                e.preventDefault();
                void saveName();
              }}
            >
              <Input
                aria-label={t('settings.profile.name')}
                disabled={saving}
                maxLength={MAX_NAME_LENGTH}
                onChange={e => setDraft(e.target.value)}
                value={name}
              />
              <Button disabled={saving || !valid || trimmed === user.name} size="sm" type="submit">
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </form>
          </dd>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <dt className="pt-0.5 text-xs font-medium text-muted-foreground">
            {t('settings.profile.email')}
          </dt>
          <dd className="col-span-2 text-sm text-foreground-secondary">{user.email}</dd>
        </div>
      </dl>
    </div>
  );
});
