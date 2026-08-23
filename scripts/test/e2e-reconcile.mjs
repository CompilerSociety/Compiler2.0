/* End-to-end check: reconcile the REAL live API output against the REAL
   generator snapshot, exactly as the handler will in production. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reconcileWithSnapshot } = require("../../api/timetable.js");

const get = async (u) => (await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const apiData = await get("https://www.vtable.site/api/timetable?school=computing");
const snap = await get("https://www.vtable.site/db/timetable-computing.json");

// reference format -> internal entry shape (handler reconciles pre-conversion)
const tt = {};
for (const [dep, batches] of Object.entries(apiData.tt)) {
  tt[dep] = {};
  for (const [bat, secs] of Object.entries(batches)) {
    tt[dep][bat] = {};
    for (const [sec, days] of Object.entries(secs)) {
      tt[dep][bat][sec] = {};
      for (const [day, arr] of Object.entries(days || {})) {
        tt[dep][bat][sec][day] = (arr || []).map((e) => ({ c: e.name, l: e.location, t: e.time, n: e.note || "" }));
      }
    }
  }
}

const count = (t) => {
  let n = 0;
  for (const d of Object.values(t || {})) for (const b of Object.values(d)) for (const s of Object.values(b)) for (const a of Object.values(s)) n += a.length;
  return n;
};

console.log("BEFORE: live", count(tt), "entries | snapshot", count(snap.tt), "entries");
console.log("BEFORE DS/2025/A Monday:", JSON.stringify(tt["BS DS"]?.["2025"]?.A?.Monday));
console.log("BEFORE DS/2023/A Monday:", JSON.stringify(tt["BS DS"]?.["2023"]?.A?.Monday?.slice(0, 6)));

const { tt: out, stats } = reconcileWithSnapshot(tt, snap.tt);
console.log("STATS:", JSON.stringify(stats), "| OUT total:", count(out));
console.log("OUT DS/2025/A Monday:", JSON.stringify(out["BS DS"]?.["2025"]?.A?.Monday, null, 1));

// Diagnose unmatched live entries: dept/day/courseKey missing from snapshot index.
const idxKeys = new Set();
for (const [dep, batches] of Object.entries(snap.tt))
  for (const [, secs] of Object.entries(batches))
    for (const [, days] of Object.entries(secs))
      for (const [day, arr] of Object.entries(days || {}))
        for (const e of arr || []) idxKeys.add(`${dep}|${day}|${String(e.name).toLowerCase().replace(/[^a-z0-9]/g, "")}`);

const unmatch = [];
for (const [dep, batches] of Object.entries(apiData.tt))
  for (const [, secs] of Object.entries(batches))
    for (const [, days] of Object.entries(secs))
      for (const [day, arr] of Object.entries(days || {}))
        for (const e of arr || []) {
          const k = `${dep}|${day}|${String(e.name).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
          if (!idxKeys.has(k)) unmatch.push({ dep, day, name: e.name, time: e.time });
        }
console.log("LIVE entries with NO snapshot dept|day|course match:", unmatch.length);
const byDept = {};
for (const u of unmatch) byDept[u.dep] = (byDept[u.dep] || 0) + 1;
console.log("by dept:", JSON.stringify(byDept));
console.log("samples:", JSON.stringify(unmatch.slice(0, 25), null, 1));
