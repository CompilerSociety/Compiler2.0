/* Harness for the snapshot reconciliation in api/timetable.js.
   Reproduces the exact production failure observed on 2026-08-23:

     Sheet cell:  "Intro to DS Lab (DS-A) Cancelled"  (row 66, col 11)
     Live parse:  filed under BS DS / 2023 / A        (stacked-header bug)
     Snapshot:    BS DS / 2025 / A                    (Python colour tier)

   A DS 2025-A student therefore saw the lab vanish from the live path while
   the Mongo fallback showed it without the Cancelled note — which is why two
   phones disagreed.

   The reconciliation builds its output FROM the snapshot and overlays fresh
   live notes + genuinely-new classes, so bucketing can never be polluted.
   Run: node scripts/test/reconcile-check.mjs                                   */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reconcileWithSnapshot } = require("../../api/timetable.js");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
}

// ── Live parse as the JS parser actually produced it ──
const live = {
  "BS DS": {
    // Correct: explicit ", 25" suffix survives.
    2025: { A: { Monday: [{ c: "OOP", l: "D-314", t: "08:30-09:50", n: "" }] } },
    // Wrong buckets: no year suffix → last stacked header (2023) won.
    2023: {
      A: {
        Monday: [
          { c: "LA", l: "D-312", t: "10:00-11:20", n: "" },
          { c: "UHQ-I&II", l: "D-314", t: "03:10-05:00", n: "" },
          { c: "Intro to DS Lab", l: "IT LAB 4-GPU (D-203)", t: "11:30-02:15", n: "Cancelled" },
        ],
      },
      B: {
        Tuesday: [{ c: "ML Lab", l: "D-211", t: "11:30-02:15", n: "Rescheduled" }],
        Wednesday: [{ c: "Intro to DS Lab", l: "IT LAB 4-GPU (D-203)", t: "11:30-02:15", n: "" }],
      },
    },
  },
};

// ── Generator snapshot (correctly bucketed, but notes-free) ──
const snap = {
  "BS DS": {
    2025: {
      A: {
        Monday: [
          { name: "LA", location: "D-312", time: "10:00-11:20", note: "" },
          { name: "UHQ-I&II", location: "D-314", time: "03:10-05:00", note: "" },
          { name: "Intro to DS Lab", location: "IT LAB 4-GPU (D-203)", time: "11:30-02:15", note: "" },
        ],
      },
      B: { Wednesday: [{ name: "Intro to DS Lab", location: "IT LAB 4-GPU (D-203)", time: "11:30-02:15", note: "" }] },
    },
    // Genuinely corroborated in both parsers at its own bucket.
    2023: { B: { Tuesday: [{ name: "ML Lab", location: "D-211", time: "11:30-02:15", note: "" }] } },
    // Snapshot-only class the JS parser dropped outright.
    2024: { C: { Friday: [{ name: "OS Lab", location: "C-MARGALA 4", time: "08:30-11:15", note: "" }] } },
  },
};

console.log("reconcileWithSnapshot:");
const { tt: out, stats } = reconcileWithSnapshot(live, snap);
console.log(`  stats: ${JSON.stringify(stats)}`);

const mon25A = out["BS DS"][2025].A.Monday;
const count = (t) => {
  let n = 0;
  for (const d of Object.values(t || {})) for (const b of Object.values(d)) for (const s of Object.values(b)) for (const a of Object.values(s)) n += a.length;
  return n;
};

check("stats counted", stats.merged === 5 && stats.noted === 2 && stats.appended === 1 && stats.dropped === 0);
check("Intro to DS Lab served under 2025-A with Cancelled note",
  mon25A.some((e) => e.c === "Intro to DS Lab" && e.n === "Cancelled"));
check("LA + UHQ present under 2025-A",
  mon25A.some((e) => e.c === "LA") && mon25A.some((e) => e.c === "UHQ-I&II"));
check("OOP kept (appended; not yet in snapshot)",
  mon25A.some((e) => e.c === "OOP" && e.t === "08:30-09:50"));
check("mis-filed copies NOT duplicated into 2023",
  !out["BS DS"][2023].A);
check("Wednesday lab merged into true 2025-B bucket",
  out["BS DS"][2025].B.Wednesday.some((e) => e.c === "Intro to DS Lab") &&
  !out["BS DS"][2023].B?.Wednesday);
check("corroborated ML Lab keeps its Rescheduled note",
  out["BS DS"][2023].B.Tuesday.some((e) => e.c === "ML Lab" && e.n === "Rescheduled"));
check("snapshot-only OS Lab survives",
  out["BS DS"][2024].C.Friday.length === 1);
check("no phantom growth: |out| == |snap| + appended",
  count(out) === count(snap) + stats.appended);
check("Monday array chronological", (() => {
  const mins = (t) => {
    const m = String(t).split("-")[0].match(/^(\d{1,2}):(\d{2})$/);
    let h = parseInt(m[1], 10);
    if (h < 8) h += 12; // sheet convention: anything before 08:xx is afternoon
    return h * 60 + parseInt(m[2], 10);
  };
  const seq = mon25A.map((e) => mins(e.t));
  return seq.every((v, i) => i === 0 || seq[i - 1] <= v);
})());

process.exit(failures ? 1 : 0);
