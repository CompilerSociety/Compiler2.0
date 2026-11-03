// lib/auth/email-config.mjs
// Chooses the transactional email backend. Kept separate from mailer.mjs so
// request validation can fail closed on a deployed server without importing
// Nodemailer into every endpoint that needs the auth guard.

export function emailProvider() {
  const explicit = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'resend' || explicit === 'smtp') return explicit;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return 'smtp';
  }
  return 'none';
}

export function emailConfigError() {
  if (!process.env.VERCEL) return null;

  const provider = emailProvider();
  if (provider === 'resend') {
    const missing = [];
    if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM');
    return missing.length ? `Missing ${missing.join(', ')}` : null;
  }

  if (provider === 'smtp') {
    const missing = [];
    if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
    if (!process.env.SMTP_USER) missing.push('SMTP_USER');
    if (!process.env.SMTP_PASS) missing.push('SMTP_PASS');
    if (!process.env.SMTP_FROM && !process.env.SMTP_USER) missing.push('SMTP_FROM');
    return missing.length ? `Missing ${missing.join(', ')}` : null;
  }

  return 'Missing email provider configuration: set RESEND_API_KEY + EMAIL_FROM, or SMTP_HOST/SMTP_USER/SMTP_PASS.';
}
