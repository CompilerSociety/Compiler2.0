// lib/auth/mailer.mjs
// Delivers the one-time code through a transactional provider. Resend is the
// preferred backend: Gmail SMTP blocked the first OTP launch after a burst of
// identical messages (Gmail error 69585), so a personal Gmail account is only
// an emergency fallback. In local development, with no provider configured, the
// code is printed to the server console so the flow can be exercised without
// sending real mail. The console fallback is deliberately disabled on Vercel,
// where "no credentials" must fail closed rather than quietly logging a code.

import nodemailer from 'nodemailer';
import { emailProvider } from './email-config.mjs';

let cachedTransport = null;

export class EmailDeliveryError extends Error {
  // `definite` is true only when the provider clearly refused the message, so
  // no email can have gone out. A timeout or dropped connection is NOT
  // definite: the provider may have accepted the message before the reply was
  // lost, and the student may already be holding a working code.
  constructor(message, { provider, code = '', status = 0, definite = false, cause } = {}) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.definite = definite;
    if (cause) this.cause = cause;
  }
}

export function smtpConfigured() {
  return emailProvider() === 'smtp';
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
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    dnsTimeout: 5000,
    disableFileAccess: true,
    disableUrlAccess: true,
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

function fromAddress() {
  if (emailProvider() === 'resend') {
    return process.env.EMAIL_FROM || 'VTable <no-reply@vtable.site>';
  }
  return process.env.SMTP_FROM || `VTable <${process.env.SMTP_USER}>`;
}

function message({ to, code, nuid }) {
  return {
    from: fromAddress(),
    to,
    subject: 'Your VTable sign-in code',
    text: `Your VTable sign-in code is ${code}. It expires in 10 minutes.\n\n`
      + 'If you did not request this code, you can ignore this email.\n',
    html: `<p>Your VTable sign-in code is <strong>${escapeHtml(code)}</strong>.</p>`
      + '<p>It expires in 10 minutes.</p>'
      + '<p>If you did not request this code, you can ignore this email.</p>'
      + `<p style="color:#666;font-size:12px">NU ID: ${escapeHtml(nuid)}</p>`,
  };
}

async function sendWithResend(payload, idempotencyKey) {
  const key = process.env.RESEND_API_KEY;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new EmailDeliveryError('Resend request failed', {
      provider: 'resend',
      code: err?.name || 'network_error',
      cause: err,
    });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new EmailDeliveryError('Resend rejected the message', {
      provider: 'resend',
      code: data?.name || data?.message || `http_${res.status}`,
      status: res.status,
      // A 4xx is a refusal (bad key, unverified domain, quota). A 5xx may have
      // happened after the message was queued.
      definite: res.status >= 400 && res.status < 500,
    });
  }
  return { delivered: true, provider: 'resend', id: data?.id || null };
}

async function sendWithSmtp(payload) {
  try {
    const info = await transport().sendMail(payload);
    return { delivered: true, provider: 'smtp', id: info?.messageId || null };
  } catch (err) {
    const responseCode = Number(err?.responseCode) || 0;
    throw new EmailDeliveryError('SMTP delivery failed', {
      provider: 'smtp',
      code: err?.code || 'smtp_error',
      status: responseCode,
      // An SMTP reply code or a failure before the message was handed over is
      // a refusal; a socket timeout mid-DATA is not.
      definite: responseCode >= 400
        || ['EAUTH', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND', 'EENVELOPE'].includes(err?.code),
      cause: err,
    });
  }
}

// Returns { delivered, provider, dev }. Throws EmailDeliveryError only when
// production delivery cannot be completed, which request-code turns into a 503
// and deletes the challenge for.
export async function sendOtpEmail({ to, code, nuid, idempotencyKey }) {
  const provider = emailProvider();
  if (provider === 'none') {
    if (process.env.VERCEL) {
      throw new EmailDeliveryError('Email provider is not configured', {
        provider: 'none',
        code: 'not_configured',
        definite: true,
      });
    }
    // Local development only. Never reachable on a deployed server.
    console.log(`[auth] dev OTP for ${nuid} <${to}>: ${code}`);
    return { delivered: false, provider: 'dev', dev: true };
  }

  const payload = message({ to, code, nuid });
  if (provider === 'resend') return sendWithResend(payload, idempotencyKey);
  return sendWithSmtp(payload);
}
