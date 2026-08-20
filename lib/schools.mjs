// lib/schools.mjs
// Which school a department belongs to, shared by the API handlers.
//
// This exists for one rule: only FAST School of Computing students are stored
// server-side. FSE and FSM students use the timetable exactly the same way, but
// none of the notification features - seat alerts, exam and show-up reminders,
// class cancellations - are sent to them, so keeping their name and roll number
// in a database would be collecting personal data with no purpose. Their
// profile lives in their own browser and is never uploaded.
//
// Kept in step with COMPUTING_DEPTS in web/js/app.js, which enforces the same
// rule client-side. The server check is what makes it true rather than merely
// intended: a stale cached client, or anyone POSTing directly, would otherwise
// still create a row.

// Short codes as a roster row stores them, i.e. the department label with any
// "BS "/"MS " prefix dropped. PCS is FSC too - it appears under "BS PCS" in the
// computing timetable - and leaving it out would quietly cut those students off
// from the notifications they are entitled to.
export const COMPUTING_DEPTS = ['CS', 'AI', 'DS', 'CY', 'SE', 'PCS'];

// Normalises "BS CS", "bs cs", "CS" and "MS (CS)" to "CS".
export function deptCode(department) {
  return String(department || '')
    .replace(/^(BS|MS|PhD)\s*/i, '')
    .replace(/[()]/g, '')
    .trim()
    .toUpperCase();
}

// True when this department's students are stored server-side.
export function isComputingDept(department) {
  return COMPUTING_DEPTS.includes(deptCode(department));
}
