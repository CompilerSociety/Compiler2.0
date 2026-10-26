// lib/auth/profile.mjs
// The allowlist for what a browser may store on its own account: the profile
// it used to keep only in the vtable_profile cookie, plus its friends address
// book. Everything is length-capped and unknown fields are dropped, so an
// account row cannot be grown into a blob store. The NU ID is never taken from
// here; callers key the row by the session.

import { sanitizeCoursePrefs } from '../notification-courses.mjs';

export const NUID_RE = /^\d{2}[A-Z]{1,4}-\d{4}$/;
const SCHOOLS = ['', 'computing', 'engineering', 'business'];
const MAX_FRIENDS = 100;

function text(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid field');
  const out = String(value).trim();
  if (out.length > max) throw new Error('Field too long');
  return out;
}

function school(value) {
  const out = text(value, 20).toLowerCase();
  if (!SCHOOLS.includes(out)) throw new Error('Invalid school');
  return out;
}

export function normalizeNuid(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Throws on anything malformed; the caller answers 400.
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid profile');
  // Missing lists mean "none yet"; a present but malformed one is rejected
  // rather than read as empty, which would silently wipe the saved courses.
  const list = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Invalid course list');
    return value;
  };
  const prefs = sanitizeCoursePrefs({
    removed: list(raw.courseRemoved),
    added: list(raw.courses),
    revision: raw.coursePrefsRevision,
  });
  return {
    name: text(raw.name, 60),
    school: school(raw.school),
    department: text(raw.department, 60),
    batch: text(raw.batch, 10),
    section: text(raw.section, 10).toUpperCase(),
    manual: raw.manual === true,
    courses: prefs.added,
    courseRemoved: prefs.removed,
    coursePrefsRevision: prefs.revision,
  };
}

export function sanitizeFriends(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_FRIENDS) throw new Error('Invalid friends');
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') throw new Error('Invalid friend');
    const nuid = normalizeNuid(f.nuid);
    if (!NUID_RE.test(nuid)) throw new Error('Invalid friend NU ID');
    if (seen.has(nuid)) continue;
    seen.add(nuid);
    out.push({
      nuid,
      name: text(f.name, 60),
      school: school(f.school),
      department: text(f.department, 60),
      batch: text(f.batch, 10),
      section: text(f.section, 10).toUpperCase(),
    });
  }
  return out;
}

// What a friend is allowed to see of someone's profile: enough to draw their
// week and their extra/repeat courses. The friends address book stays private.
export function sharedProfileView(profile) {
  if (!profile) return null;
  return {
    name: profile.name || '',
    school: profile.school || '',
    department: profile.department || '',
    batch: profile.batch || '',
    section: profile.section || '',
    manual: profile.manual === true,
    courses: Array.isArray(profile.courses) ? profile.courses : [],
    courseRemoved: Array.isArray(profile.courseRemoved) ? profile.courseRemoved : [],
  };
}
