import nodemailer from 'nodemailer';
import { childLogger } from './logger';

const log = childLogger({ module: 'email' });

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    // In development, log emails to console instead of sending
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
  return process.env.APP_URL ?? 'http://localhost:3000';
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
  return `"Bilinear" <noreply@${domain}>`;
}

// ---------------------------------------------------------------------------
// Shared HTML wrapper
// ---------------------------------------------------------------------------

function htmlWrap(bodyHtml: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
      <p style="color:#9ca3af;font-size:12px">
        You're receiving this because you have notifications enabled.
        To stop, turn off email notifications in your account settings.
      </p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

export async function sendMagicLinkEmail(email: string, code: string): Promise<void> {
  const transport = createTransport();
  const base = appUrl();
  const verifyUrl = `${base}/verify?email=${encodeURIComponent(email)}&code=${code}`;

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(`
      <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Sign in to Bilinear</h2>
      <p style="color:#374151">Your sign-in code is:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;padding:16px 0;color:#111">${code}</div>
      <p>Or <a href="${verifyUrl}" style="color:#6366f1">click here to sign in</a>.</p>
      <p style="color:#6b7280;font-size:13px">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
    `),
    subject: `Your sign-in code: ${code}`,
    text: `Your sign-in code is: ${code}\n\nOr click the link below:\n${verifyUrl}\n\nThis code expires in 15 minutes.`,
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
  /** Recipient email address */
  to: string;
}

export async function sendAssignmentNotificationEmail(
  params: NotificationEmailBase,
): Promise<void> {
  const transport = createTransport();
  const { to, actorName, issueIdentifier, issueTitle, issueUrl } = params;

  const safeActor = escapeHtml(actorName);
  const safeId = escapeHtml(issueIdentifier);
  const safeTitle = escapeHtml(issueTitle);

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(`
      <p style="color:#374151"><strong>${safeActor}</strong> assigned you to an issue:</p>
      <div style="border-left:3px solid #6366f1;padding:12px 16px;margin:16px 0;background:#f9fafb;border-radius:4px">
        <a href="${issueUrl}" style="color:#111;font-weight:600;text-decoration:none">
          <span style="color:#6b7280;font-size:13px">${safeId}</span>
          &nbsp;${safeTitle}
        </a>
      </div>
      <a href="${issueUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View issue</a>
    `),
    subject: `You were assigned to ${issueIdentifier}: ${issueTitle}`,
    text: `${actorName} assigned you to ${issueIdentifier}: ${issueTitle}\n\n${issueUrl}`,
    to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ info, issueIdentifier, to }, 'Assignment notification email (dev)');
  }
}

export interface MentionNotificationEmailParams extends NotificationEmailBase {
  /** Plain-text excerpt of the comment or description where the mention appeared */
  excerpt?: string;
}

export async function sendMentionNotificationEmail(
  params: MentionNotificationEmailParams,
): Promise<void> {
  const transport = createTransport();
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, excerpt } = params;

  const safeActor = escapeHtml(actorName);
  const safeId = escapeHtml(issueIdentifier);
  const safeTitle = escapeHtml(issueTitle);
  const excerptHtml = excerpt
    ? `<blockquote style="border-left:3px solid #d1d5db;margin:12px 0;padding:8px 12px;color:#4b5563;font-style:italic">${escapeHtml(excerpt)}</blockquote>`
    : '';

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(`
      <p style="color:#374151"><strong>${safeActor}</strong> mentioned you in <a href="${issueUrl}" style="color:#6366f1">${safeId}: ${safeTitle}</a>:</p>
      ${excerptHtml}
      <a href="${issueUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View issue</a>
    `),
    subject: `${actorName} mentioned you in ${issueIdentifier}: ${issueTitle}`,
    text: `${actorName} mentioned you in ${issueIdentifier}: ${issueTitle}\n${excerpt ? `\n"${excerpt}"\n` : ''}\n${issueUrl}`,
    to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ info, issueIdentifier, to }, 'Mention notification email (dev)');
  }
}

export interface CommentNotificationEmailParams extends NotificationEmailBase {
  /** Plain-text excerpt of the new comment */
  excerpt?: string;
}

export async function sendCommentNotificationEmail(
  params: CommentNotificationEmailParams,
): Promise<void> {
  const transport = createTransport();
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, excerpt } = params;

  const safeActor = escapeHtml(actorName);
  const safeId = escapeHtml(issueIdentifier);
  const safeTitle = escapeHtml(issueTitle);
  const excerptHtml = excerpt
    ? `<blockquote style="border-left:3px solid #d1d5db;margin:12px 0;padding:8px 12px;color:#4b5563;font-style:italic">${escapeHtml(excerpt)}</blockquote>`
    : '';

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(`
      <p style="color:#374151"><strong>${safeActor}</strong> commented on <a href="${issueUrl}" style="color:#6366f1">${safeId}: ${safeTitle}</a>:</p>
      ${excerptHtml}
      <a href="${issueUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View comment</a>
    `),
    subject: `${actorName} commented on ${issueIdentifier}: ${issueTitle}`,
    text: `${actorName} commented on ${issueIdentifier}: ${issueTitle}\n${excerpt ? `\n"${excerpt}"\n` : ''}\n${issueUrl}`,
    to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ info, issueIdentifier, to }, 'Comment notification email (dev)');
  }
}

export interface StatusChangeNotificationEmailParams extends NotificationEmailBase {
  newStateName: string;
  oldStateName: string;
}

export async function sendStatusChangeNotificationEmail(
  params: StatusChangeNotificationEmailParams,
): Promise<void> {
  const transport = createTransport();
  const { to, actorName, issueIdentifier, issueTitle, issueUrl, oldStateName, newStateName } =
    params;

  const safeActor = escapeHtml(actorName);
  const safeId = escapeHtml(issueIdentifier);
  const safeTitle = escapeHtml(issueTitle);
  const safeOld = escapeHtml(oldStateName);
  const safeNew = escapeHtml(newStateName);

  const info = await transport.sendMail({
    from: fromAddress(),
    html: htmlWrap(`
      <p style="color:#374151"><strong>${safeActor}</strong> updated the status of <a href="${issueUrl}" style="color:#6366f1">${safeId}: ${safeTitle}</a>:</p>
      <p style="color:#374151">
        <span style="color:#9ca3af">${safeOld}</span>
        &nbsp;→&nbsp;
        <strong>${safeNew}</strong>
      </p>
      <a href="${issueUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View issue</a>
    `),
    subject: `${issueIdentifier} moved to ${newStateName}`,
    text: `${actorName} moved ${issueIdentifier}: ${issueTitle} from ${oldStateName} to ${newStateName}.\n\n${issueUrl}`,
    to,
  });

  if (process.env.NODE_ENV !== 'production') {
    log.info({ info, issueIdentifier, to }, 'Status change notification email (dev)');
  }
}
