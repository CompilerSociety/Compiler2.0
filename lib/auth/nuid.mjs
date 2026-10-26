// lib/auth/nuid.mjs
// Turns a typed NU ID into the university mailbox that proves ownership of it.
//
// This is the one place the ID -> email rule lives. The browser never supplies
// the recipient address: it supplies a roll number, this module validates the
// shape, and the derived address is what the code is sent to. If the mapping is
// wrong for a campus the code goes nowhere useful, so a campus stays DISABLED
// until its rule has been confirmed against a real student mailbox.
//
// A format note: the campus is the alphabetic block, and its email prefix is
// not always the same letter. Islamabad IDs look like `25I-0816` and their
// mailbox is `i250816@isb.nu.edu.pk` (prefix `i` + batch `25` + serial `0816`).
// That rule is confirmed; the other campuses are not, so they are absent on
// purpose rather than guessed.

const NUID_RE = /^(\d{2})([A-Za-z]{1,4})-(\d{4})$/;

// campus code -> the confirmed mailbox rule. `enabled` is the gate: an entry
// that is present but false means "we know the campus exists, but not its
// mailbox format yet", which is a clearer error than "invalid NU ID".
const CAMPUSES = {
  I: { name: 'Islamabad', domain: 'isb.nu.edu.pk', prefix: 'i', enabled: true },
  // K: { name: 'Karachi',   domain: 'khi.nu.edu.pk', prefix: 'k', enabled: false },
  // L: { name: 'Lahore',    domain: 'lhr.nu.edu.pk', prefix: 'l', enabled: false },
  // P: { name: 'Peshawar',  domain: 'pwr.nu.edu.pk', prefix: 'p', enabled: false },
};

export function normalizeNuid(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Returns one of:
//   { ok: true, nuid, batch, campus, email, maskedEmail }
//   { ok: false, error: 'invalid_nuid' }
//   { ok: false, error: 'campus_not_supported', campus }
export function parseNuid(raw) {
  const nuid = normalizeNuid(raw);
  const match = NUID_RE.exec(nuid);
  if (!match) return { ok: false, error: 'invalid_nuid' };

  const batch = match[1];
  const campusCode = match[2].toUpperCase();
  const serial = match[3];
  if (campusCode.length !== 1) return { ok: false, error: 'invalid_nuid' };

  const campus = CAMPUSES[campusCode];
  if (!campus || !campus.enabled) {
    return { ok: false, error: 'campus_not_supported', campus: campusCode };
  }

  const email = `${campus.prefix}${batch}${serial}@${campus.domain}`;
  return {
    ok: true,
    nuid,
    batch,
    campus: campusCode,
    campusName: campus.name,
    email,
    maskedEmail: maskEmail(email),
  };
}

// Enough of the address to let a student recognise where the code went, without
// printing the full mailbox into a response or a log.
export function maskEmail(email) {
  const text = String(email || '');
  const at = text.indexOf('@');
  if (at < 0) return '';
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  if (local.length <= 4) return `${local[0] || ''}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
}
