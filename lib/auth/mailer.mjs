// lib/auth/mailer.mjs
// Delivers the one-time code. In production the SMTP credentials are required;
// locally, with none configured, the code is printed to the server console so
// the flow can be exercised without sending real mail. The console fallback is
// deliberately disabled on Vercel, where "no credentials" must fail closed
// rather than quietly logging a code into deployment logs.

import nodemailer from 'nodemailer';

let cachedTransport = null;

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  if (cachedTransport) return cachedTransport;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE
    ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
    : port === 465;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cachedTransport;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Returns { delivered, dev }. Throws only when production delivery cannot be
// attempted, which the caller turns into a 503 and a deleted challenge.
export async function sendOtpEmail({ to, code, nuid }) {
  if (!smtpConfigured()) {
    if (process.env.VERCEL) {
      throw new Error('SMTP is not configured');
    }
    // Local development only. Never reachable on a deployed server.
    console.log(`[auth] dev OTP for ${nuid} <${to}>: ${code}`);
    return { delivered: false, dev: true };
  }

  const from = process.env.SMTP_FROM || `VTable <${process.env.SMTP_USER}>`;
  await transport().sendMail({
    from,
    to,
    subject: `Your VTable sign-in code`,
    text: `Your VTable sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your VTable sign-in code is <strong>${escapeHtml(code)}</strong>.</p>`
      + `<p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`
      + `<p style="color:#666;font-size:12px">NU ID: ${escapeHtml(nuid)}</p>`,
  });
  return { delivered: true, dev: false };
}
