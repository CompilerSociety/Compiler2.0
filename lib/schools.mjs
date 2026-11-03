// lib/schools.mjs
// Which school a department belongs to, shared by the API handlers.
//
// FSC and FSM students are on the server-side roster: FSC from its seating
// plans, FSM from python/tools/student_profiles/build_fsm_directory.py, and
// both through /api/register for anyone the roster has not caught up with.
// FSE students are not stored - none of the roster's uses reach them yet, so
// their profile stays in their own browser. Notifications (api/subscribe.mjs)
// remain computing-only.
//
// Kept in step with COMPUTING_DEPTS / BUSINESS_DEPTS in web/js/app.js, which
// enforce the same rule client-side. The server check is what makes it true rather than merely
// intended: a stale cached client, or anyone POSTing directly, would otherwise
// still create a row.

// Short codes as a roster row stores them, i.e. the department label with any
// "BS "/"MS " prefix dropped. PCS is FSC too - it appears under "BS PCS" in the
// computing timetable - and leaving it out would quietly cut those students off
// from the notifications they are entitled to.
export const COMPUTING_DEPTS = ['CS', 'AI', 'DS', 'CY', 'SE', 'PCS'];

// FSM program codes as the seating plans print them (BAF-1A, BSBA-3C, ...).
// The client publishes these codes, never the timetable's full program names.
export const BUSINESS_DEPTS = ['BAF', 'BBA', 'BFT', 'BSBA', 'MB', 'MSBA', 'PMG'];

// Normalises "BS CS", "bs cs", "CS" and "MS (CS)" to "CS".
export function deptCode(department) {
  return String(department || '')
    .replace(/^(BS|MS|PhD)\s*/i, '')
    .replace(/[()]/g, '')
    .trim()
    .toUpperCase();
}

// True for FAST School of Computing departments.
export function isComputingDept(department) {
  return COMPUTING_DEPTS.includes(deptCode(department));
}

export function isBusinessDept(department) {
  return BUSINESS_DEPTS.includes(String(department || '').trim().toUpperCase());
}

// Departments whose students may be written to the roster.
export function isRosterDept(department) {
  return isComputingDept(department) || isBusinessDept(department);
}
