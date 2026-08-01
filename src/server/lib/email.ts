import nodemailer from 'nodemailer';
import { APP_NAME } from '@/lib/app-config';
import { defaultLocale, isLocale, type Locale, translate } from '@/lib/i18n';
import { env } from './env';
import { childLogger } from './logger';

const log = childLogger({ module: 'email' });

/**
 * Resolve the recipient's persisted locale to a supported one, then translate.
 * Recipients with no stored preference (or an unsupported value) fall back to
 * the app default so transactional emails are always in a known language.
 */
function emailT(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const resolved: Locale = isLocale(locale) ? locale : defaultLocale;
  return translate(resolved, key, params);
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // In test mode (TEST_AUTH_CODE set by playwright.config.ts) or when no
  // SMTP host is configured in a non-production environment, log emails to
  // console rather than attempting a real SMTP connection. This prevents
  // test suites from failing when Mailpit is not running.
  if (!host || process.env.TEST_AUTH_CODE) {
    if (process.env.NODE_ENV !== 'production') {
      return nodemailer.createTransport({ jsonTransport: true });
    }
    throw new Error('SMTP configuration is missing');
  }

  // Support unauthenticated SMTP (e.g. Mailpit in local dev)
  // SMTP_SECURE overrides the default; falls back to true only for port 465
  const secureEnv = process.env.SMTP_SECURE;
  const secure = secureEnv !== undefined && secureEnv !== '' ? secureEnv === 'true' : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { pass, user } } : {}),
  });
}

function appUrl(): string {
  return env.APP_URL;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fromAddress(): string {
  const host = process.env.SMTP_HOST ?? 'example.com';
  const domain = host.startsWith('smtp.') ? host.slice(5) : host;
  return `"${APP_NAME}" <noreply@${domain}>`;
}

// ---------------------------------------------------------------------------
// Shared HTML building blocks
// ---------------------------------------------------------------------------

function htmlWrap(bodyHtml: string, locale: string | null | undefined): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
      <p style="color:#9ca3af;font-size:12px">
        ${emailT(locale, 'email.footer')}
      </p>
    </div>
  `;
}

function ctaButton(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">${label}</a>`;
}

function issueLinkHtml(url: string, identifier: string, title: string): string {
  return `<a href="${url}" style="color:#6366f1">${escapeHtml(identifier)}: ${escapeHtml(title)}</a>`;
}

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

export async function sendMagicLinkEmail(
  email: string,
  code: string,
  locale?: string | null,
): Promise<void> {
  const transport = createTransport();
  const base = appUrl();
  const verifyUrl = `${base}/verify?email=${encodeURIComponent(email)}&code=${code}`;

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(
      `
      <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">${emailT(locale, 'email.magicLink.heading', { appName: APP_NAME })}</h2>
      <p style="color:#374151">${emailT(locale, 'email.magicLink.codeIntro')}</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;padding:16px 0;color:#111">${code}</div>
      <p>${emailT(locale, 'email.magicLink.or')} <a href="${verifyUrl}" style="color:#6366f1">${emailT(locale, 'email.magicLink.clickHere')}</a>.</p>
      <p style="color:#6b7280;font-size:13px">${emailT(locale, 'email.magicLink.expiry')}</p>
    `,
      locale,
    ),
    subject: emailT(locale, 'email.magicLink.subject', { code }),
    text: emailT(locale, 'email.magicLink.textBody', { code, url: verifyUrl }),
    to: email,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ code, email, verifyUrl }, 'Magic link (dev)');
    if ((info as { message?: string }).message) {
      log.info('Magic link (dev mode — not actually sent)');
    }
  }
}

// ---------------------------------------------------------------------------
// Organization invitation
// ---------------------------------------------------------------------------

/**
 * Deliver an invitation link. The raw token reaches the database only as a
 * SHA-256 hash, so this email is the single place it exists in the clear —
 * a failure to send means the invitation is unreachable and must be re-issued
 * rather than looked up.
 *
 * Localized to the *organization's* inviter-independent default rather than
 * the recipient's saved locale: an invitee frequently has no account yet, and
 * therefore no `User.locale` to read.
 */
export async function sendOrganizationInviteEmail(params: {
  to: string;
  organizationName: string;
  inviterName: string | null;
  inviteUrl: string;
  locale?: string | null;
}): Promise<void> {
  const transport = createTransport();
  const { locale } = params;
  const safeOrg = escapeHtml(params.organizationName);
  const safeInviter = params.inviterName ? escapeHtml(params.inviterName) : null;

  // Two keys rather than an "someone" placeholder: the inviter is unknown
  // only when their account was deleted since (the FK is SET NULL), and
  // "Someone invited you" reads like a phishing mail.
  const bodyKey = safeInviter ? 'email.invite.bodyWithInviter' : 'email.invite.body';
  const bodyParams: Record<string, string> = { organization: `<strong>${safeOrg}</strong>` };
  if (safeInviter) {
    bodyParams.inviter = `<strong>${safeInviter}</strong>`;
  }

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(
      `
      <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">${emailT(locale, 'email.invite.heading', { appName: APP_NAME })}</h2>
      <p style="color:#374151">${emailT(locale, bodyKey, bodyParams)}</p>
      ${ctaButton(params.inviteUrl, emailT(locale, 'email.invite.cta'))}
      <p style="color:#6b7280;font-size:13px">${emailT(locale, 'email.invite.expiry')}</p>
    `,
      locale,
    ),
    subject: emailT(locale, 'email.invite.subject', { organization: params.organizationName }),
    text: emailT(locale, 'email.invite.textBody', {
      organization: params.organizationName,
      url: params.inviteUrl,
    }),
    to: params.to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ email: params.to, inviteUrl: params.inviteUrl }, 'Organization invite (dev)');
    if ((info as { message?: string }).message) {
      log.info('Organization invite (dev mode — not actually sent)');
    }
  }
}

// ---------------------------------------------------------------------------
// Notification emails
// ---------------------------------------------------------------------------

export interface NotificationEmailBase {
  /** Display name of the actor who triggered the notification */
  actorName: string;
  /** Issue identifier, e.g. "ENG-123" */
  issueIdentifier: string;
  /** Issue title */
  issueTitle: string;
  /** Direct link to the issue */
  issueUrl: string;
  /** Recipient's persisted locale; falls back to the app default when unset */
  locale?: string | null;
  /** Recipient email address */
  to: string;
}

/**
 * Shared send envelope for the notification emails: wraps the caller-built
 * `bodyHtml` (already localized and escaped) in the standard chrome, sends it,
 * and emits the dev-mode log. Each public `send*` function only has to build
 * its body + subject/text, so the transport/from/log boilerplate lives once.
 */
async function sendNotificationEmail(params: {
  to: string;
  locale?: string | null;
  bodyHtml: string;
  subject: string;
  text: string;
  issueIdentifier: string;
  logLabel: string;
}): Promise<void> {
  const { to, locale, bodyHtml, subject, text, issueIdentifier, logLabel } = params;
  const transport = createTransport();
  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(bodyHtml, locale),
    subject,
    text,
    to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ info, issueIdentifier, to }, logLabel);
  }
}

/** Optional italic blockquote for a comment/mention excerpt (empty when absent). */
function excerptBlockquote(excerpt: string | undefined): string {
  if (!excerpt) {
    return '';
  }
  return `<blockquote style="border-left:3px solid #d1d5db;margin:12px 0;padding:8px 12px;color:#4b5563;font-style:italic">${escapeHtml(excerpt)}</blockquote>`;
}

export async function sendAssignmentNotificationEmail(
  params: NotificationEmailBase,
): Promise<void> {
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, locale } = params;

  const safeActor = escapeHtml(actorName);
  const safeId = escapeHtml(issueIdentifier);
  const safeTitle = escapeHtml(issueTitle);

  await sendNotificationEmail({
    bodyHtml: `
      <p style="color:#374151">${emailT(locale, 'email.assignment.body', { actor: `<strong>${safeActor}</strong>` })}</p>
      <div style="border-left:3px solid #6366f1;padding:12px 16px;margin:16px 0;background:#f9fafb;border-radius:4px">
        <a href="${issueUrl}" style="color:#111;font-weight:600;text-decoration:none">
          <span style="color:#6b7280;font-size:13px">${safeId}</span>
          &nbsp;${safeTitle}
        </a>
      </div>
      ${ctaButton(issueUrl, emailT(locale, 'email.viewIssue'))}
    `,
    issueIdentifier,
    locale,
    logLabel: 'Assignment notification email (dev)',
    subject: emailT(locale, 'email.assignment.subject', {
      identifier: issueIdentifier,
      title: issueTitle,
    }),
    text: emailT(locale, 'email.assignment.text', {
      actor: actorName,
      identifier: issueIdentifier,
      title: issueTitle,
      url: issueUrl,
    }),
    to,
  });
}

export interface MentionNotificationEmailParams extends NotificationEmailBase {
  /** Plain-text excerpt of the comment or description where the mention appeared */
  excerpt?: string;
}

export async function sendMentionNotificationEmail(
  params: MentionNotificationEmailParams,
): Promise<void> {
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, excerpt, locale } = params;

  const safeActor = escapeHtml(actorName);

  await sendNotificationEmail({
    bodyHtml: `
      <p style="color:#374151">${emailT(locale, 'email.mention.body', {
        actor: `<strong>${safeActor}</strong>`,
        issueLink: issueLinkHtml(issueUrl, issueIdentifier, issueTitle),
      })}</p>
      ${excerptBlockquote(excerpt)}
      ${ctaButton(issueUrl, emailT(locale, 'email.viewIssue'))}
    `,
    issueIdentifier,
    locale,
    logLabel: 'Mention notification email (dev)',
    subject: emailT(locale, 'email.mention.subject', {
      actor: actorName,
      identifier: issueIdentifier,
      title: issueTitle,
    }),
    text: emailT(locale, 'email.mention.text', {
      actor: actorName,
      excerpt: excerpt ? `\n"${excerpt}"\n` : '',
      identifier: issueIdentifier,
      title: issueTitle,
      url: issueUrl,
    }),
    to,
  });
}

export interface CommentNotificationEmailParams extends NotificationEmailBase {
  /** Plain-text excerpt of the new comment */
  excerpt?: string;
}

export async function sendCommentNotificationEmail(
  params: CommentNotificationEmailParams,
): Promise<void> {
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, excerpt, locale } = params;

  const safeActor = escapeHtml(actorName);

  await sendNotificationEmail({
    bodyHtml: `
      <p style="color:#374151">${emailT(locale, 'email.comment.body', {
        actor: `<strong>${safeActor}</strong>`,
        issueLink: issueLinkHtml(issueUrl, issueIdentifier, issueTitle),
      })}</p>
      ${excerptBlockquote(excerpt)}
      ${ctaButton(issueUrl, emailT(locale, 'email.viewComment'))}
    `,
    issueIdentifier,
    locale,
    logLabel: 'Comment notification email (dev)',
    subject: emailT(locale, 'email.comment.subject', {
      actor: actorName,
      identifier: issueIdentifier,
      title: issueTitle,
    }),
    text: emailT(locale, 'email.comment.text', {
      actor: actorName,
      excerpt: excerpt ? `\n"${excerpt}"\n` : '',
      identifier: issueIdentifier,
      title: issueTitle,
      url: issueUrl,
    }),
    to,
  });
}

export interface StatusChangeNotificationEmailParams extends NotificationEmailBase {
  newStateName: string;
  oldStateName: string;
}

export async function sendStatusChangeNotificationEmail(
  params: StatusChangeNotificationEmailParams,
): Promise<void> {
  const {
    to,
    actorName,
    issueIdentifier,
    issueTitle,
    issueUrl,
    oldStateName,
    newStateName,
    locale,
  } = params;

  const safeActor = escapeHtml(actorName);
  const safeOld = escapeHtml(oldStateName);
  const safeNew = escapeHtml(newStateName);

  await sendNotificationEmail({
    bodyHtml: `
      <p style="color:#374151">${emailT(locale, 'email.statusChange.body', {
        actor: `<strong>${safeActor}</strong>`,
        issueLink: issueLinkHtml(issueUrl, issueIdentifier, issueTitle),
      })}</p>
      <p style="color:#374151">
        <span style="color:#9ca3af">${safeOld}</span>
        &nbsp;→&nbsp;
        <strong>${safeNew}</strong>
      </p>
      ${ctaButton(issueUrl, emailT(locale, 'email.viewIssue'))}
    `,
    issueIdentifier,
    locale,
    logLabel: 'Status change notification email (dev)',
    subject: emailT(locale, 'email.statusChange.subject', {
      identifier: issueIdentifier,
      state: newStateName,
    }),
    text: emailT(locale, 'email.statusChange.text', {
      actor: actorName,
      identifier: issueIdentifier,
      newState: newStateName,
      oldState: oldStateName,
      title: issueTitle,
      url: issueUrl,
    }),
    to,
  });
}
