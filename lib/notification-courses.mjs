// The same overlay as My courses: own section minus removals, plus explicit picks.
const text = value => String(value || '').trim();
export const courseName = value => text(value).replace(/\s*(ReSch(eduled)?|Cancelled|Cancel)\b.*$/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const dept = value => text(value).replace(/^BS\s*/i, '').toUpperCase();
const batch = value => text(value).replace(/^(\d{2})$/, '20$1');
const section = value => text(value).replace(/[^A-Za-z]/g, '').toUpperCase();

export function sanitizeCoursePrefs(raw) {
  if (!raw || !Array.isArray(raw.removed) || !Array.isArray(raw.added)
      || raw.removed.length > 40 || raw.added.length > 40) throw new Error('Invalid course preferences');
  const field = value => {
    if (typeof value !== 'string' || value.length > 160) throw new Error('Invalid course preference field');
    return value.trim();
  };
  return {
    revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? Math.min(raw.revision, Date.now()) : 0,
    removed: [...new Set(raw.removed.map(field))],
    added: raw.added.map(c => {
      if (!c || typeof c !== 'object') throw new Error('Invalid added course');
      const result = Object.fromEntries(['school', 'dept', 'batch', 'section', 'name'].map(k => [k, field(c[k] || '')]));
      if (!result.name || !result.dept) throw new Error('Invalid added course');
      return result;
    }),
  };
}

function namesMatch(left, right) {
  const a = courseName(left), b = courseName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Timetables abbreviate names (PF, Data St); exam sheets expand them.
  // Keep labs distinct and require every substantive word to correspond.
  const words = value => text(value).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !['AND', 'OF', 'THE'].includes(w));
  const aw = words(left), bw = words(right);
  const lab = ws => ws.some(w => /^LAB(ORATORY)?$/.test(w));
  if (lab(aw) !== lab(bw)) return false;
  if (aw.length === 1 && bw.length > 1 && a.length >= 2 && a === bw.map(w => w[0]).join('')) return true;
  if (bw.length === 1 && aw.length > 1 && b.length >= 2 && b === aw.map(w => w[0]).join('')) return true;
  return aw.length > 1 && aw.length === bw.length && aw.every((w, i) =>
    w === bw[i] || (Math.min(w.length, bw[i].length) >= 2 && (w.startsWith(bw[i]) || bw[i].startsWith(w))));
}
function sameName(pick, event) {
  return [event.name, event.course, event.code].some(value => namesMatch(pick, value));
}
function sameScope(pick, event) {
  return (!event.school || (pick.school || 'computing') === event.school)
    && dept(pick.dept || pick.department) === dept(event.dept)
    && batch(pick.batch) === batch(event.batch)
    && (event.section === 'ALL' || section(pick.section) === section(event.section));
}
export function wantsCourse(entry, event) {
  const prefs = entry.coursePrefs;
  if (prefs?.added?.some(c => sameScope(c, event) && sameName(c.name, event))) return true;
  return sameScope(entry, event) && !prefs?.removed?.some(n => sameName(n, event));
}
// Seating is already addressed to a specific student, without a section scope.
export function wantsPaper(entry, paper) {
  const event = { name: paper };
  return !entry.coursePrefs?.removed?.some(n => sameName(n, event))
    || entry.coursePrefs?.added?.some(c => sameName(c.name, event));
}
