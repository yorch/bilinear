import nodemailer from 'nodemailer';

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // In development, log emails to console instead of sending
    if (process.env.NODE_ENV !== 'production') {
      return nodemailer.createTransport({ jsonTransport: true });
    }
    throw new Error('SMTP configuration is missing');
  }

  return nodemailer.createTransport({
    auth: { pass, user },
    host,
    port,
    secure: port === 465,
  });
}

const transport = createTransport();

export async function sendMagicLinkEmail(
  email: string,
  code: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verifyUrl = `${appUrl}/verify?email=${encodeURIComponent(email)}&code=${code}`;

  const info = await transport.sendMail({
    from: `"Issue Tracker" <noreply@${process.env.SMTP_HOST ?? 'example.com'}>`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Sign in to Issue Tracker</h2>
        <p>Your sign-in code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; padding: 16px 0;">${code}</div>
        <p>Or <a href="${verifyUrl}">click here to sign in</a>.</p>
        <p style="color: #666; font-size: 14px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
    subject: `Your sign-in code: ${code}`,
    text: `Your sign-in code is: ${code}\n\nOr click the link below:\n${verifyUrl}\n\nThis code expires in 15 minutes.`,
    to: email,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[Email] Magic link for',
      email,
      '- Code:',
      code,
      '- URL:',
      verifyUrl,
    );
    if ((info as { message?: string }).message) {
      console.log('[Email] (dev mode — not actually sent)');
    }
  }
}
