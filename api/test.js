/**
 * test.js — VTable pipeline stress test
 *
 * Runs the Vercel handler against every day + school combo,
 * validates the output shape, prints the final merged JSON,
 * and reports a pass/fail summary.
 *
 * Usage:
 *   node test.js              — full run (all schools, all days)
 *   node test.js computing    — single school
 *   node test.js computing Monday — single school + single day
 */

const fs      = require("fs");
const path    = require("path");
const handler = require("./timetable");

// ── Logger — writes to console AND log.txt (ANSI codes stripped for file) ────

const LOG_PATH  = path.join(__dirname, "log.txt");
const logStream = fs.createWriteStream(LOG_PATH, { flags: "w" });
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*m/g, "");

// Patch process.stdout.write so progress ticks (no newline) also land in log.txt
const _stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  logStream.write(stripAnsi(String(chunk)));
  return _stdoutWrite(chunk, ...args);
};

// Must call this instead of process.exit() — waits for the stream to fully
// flush to disk before killing the process. process.exit() cuts the process
// dead instantly, dropping buffered writes that haven't hit the OS yet.
function finish(code) {
  logStream.end(() => process.exit(code));
}


// ── Config ────────────────────────────────────────────────────────────────────

const SCHOOLS = ["computing", "engineering", "business"];
const DAYS    = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const [, , argSchool, argDay] = process.argv;
const targetSchools = argSchool ? [argSchool] : SCHOOLS;
const targetDays    = argDay    ? [argDay]    : DAYS;

// ── Mock Vercel req/res ───────────────────────────────────────────────────────

function makeReqRes(query) {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

  const res = {
    _code: 200,
    setHeader() {},
    status(code) { this._code = code; return this; },
    json(data)   { resolve({ code: this._code, data }); },
    end()        { resolve({ code: this._code, data: null }); },
  };

  const req = { method: "GET", query };
  return { req, res, promise };
}

// ── Validators ────────────────────────────────────────────────────────────────

function validateTT(tt, label) {
  const errors = [];
  if (!tt || typeof tt !== "object") {
    errors.push(`${label}: tt is not an object`);
    return errors;
  }

  for (const [dept, batches] of Object.entries(tt)) {
    if (!/^BS |^MS /.test(dept))
      errors.push(`${label}: dept key "${dept}" missing BS/MS prefix`);

    for (const [batch, sections] of Object.entries(batches)) {
      if (!/^(20\d{2}|MS)$/.test(batch))
        errors.push(`${label}: "${dept}" has unexpected batch "${batch}"`);

      for (const [section, days] of Object.entries(sections)) {
        if (!section || section.length > 4)
          errors.push(`${label}: "${dept}/${batch}" has weird section "${section}"`);

        for (const [day, entries] of Object.entries(days)) {
          if (!["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].includes(day))
            errors.push(`${label}: "${dept}/${batch}/${section}" has unknown day "${day}"`);

          if (!Array.isArray(entries)) {
            errors.push(`${label}: "${dept}/${batch}/${section}/${day}" entries not an array`);
            continue;
          }

          entries.forEach((e, i) => {
            if (!e.name)     errors.push(`${label}: entry [${i}] in ${dept}/${batch}/${section}/${day} missing name`);
            if (!e.location) errors.push(`${label}: entry [${i}] in ${dept}/${batch}/${section}/${day} missing location`);
            if (!e.time)     errors.push(`${label}: entry [${i}] in ${dept}/${batch}/${section}/${day} missing time`);
            if (e.time && !/\d{2}:\d{2}/.test(e.time))
              errors.push(`${label}: entry [${i}] in ${dept}/${batch}/${section}/${day} time "${e.time}" looks malformed`);
          });
        }
      }
    }
  }
  return errors;
}

function countTTEntries(tt) {
  let n = 0;
  Object.values(tt  || {}).forEach(batches =>
  Object.values(batches).forEach(sections =>
  Object.values(sections).forEach(days =>
  Object.values(days).forEach(arr => { n += arr.length; }))));
  return n;
}

// ── Runner ────────────────────────────────────────────────────────────────────

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36m·\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";

async function runOne(school, day) {
  const label = `${school}/${day}`;
  const { req, res, promise } = makeReqRes({ school, sheet: day });

  try {
    await handler(req, res);
  } catch (err) {
    return { label, ok: false, errors: [`handler threw: ${err.message}`], count: 0 };
  }

  const { code, data } = await promise;

  if (code !== 200 || !data?.ok) {
    return {
      label, ok: false, count: 0,
      errors: [`HTTP ${code} — ${data?.error || "no error message"}`],
    };
  }

  const tt     = data.tt;
  const count  = data.count ?? countTTEntries(tt);
  const errors = validateTT(tt, label);

  return { label, ok: errors.length === 0, errors, count, tt };
}

// Merge partial TTs from individual day calls into one full TT
function mergeTTs(partials) {
  const merged = {};
  for (const { tt } of partials) {
    if (!tt) continue;
    for (const [dept, batches] of Object.entries(tt)) {
      merged[dept] = merged[dept] || {};
      for (const [batch, sections] of Object.entries(batches)) {
        merged[dept][batch] = merged[dept][batch] || {};
        for (const [section, days] of Object.entries(sections)) {
          merged[dept][batch][section] = merged[dept][batch][section] || {};
          for (const [day, entries] of Object.entries(days)) {
            const existing = merged[dept][batch][section][day] || [];
            const combined = [...existing];
            for (const e of entries) {
              if (!combined.some(x => x.name === e.name && x.time === e.time && x.location === e.location))
                combined.push(e);
            }
            merged[dept][batch][section][day] = combined;
          }
        }
      }
    }
  }
  return merged;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const allResults = [];
  const perSchoolResults = {};

  console.log("\n\x1b[1mVTable pipeline stress test\x1b[0m");
  console.log(`Schools: ${targetSchools.join(", ")}  |  Days: ${targetDays.join(", ")}\n`);

  for (const school of targetSchools) {
    const schoolResults = [];
    process.stdout.write(`  ${school.padEnd(12)}`);

    for (const day of targetDays) {
      const result = await runOne(school, day);
      schoolResults.push(result);
      allResults.push(result);
      process.stdout.write(result.ok ? ` ${PASS}${day.slice(0,3)}` : ` ${FAIL}${day.slice(0,3)}`);
    }

    const totalCount = schoolResults.reduce((s, r) => s + r.count, 0);
    console.log(`  (${totalCount} entries)`);

    perSchoolResults[school] = schoolResults;
  }

  // ── Per-result errors ─────────────────────────────────────────────────────

  const failedResults = allResults.filter(r => !r.ok);
  if (failedResults.length) {
    console.log(`\n\x1b[31mFailed:\x1b[0m`);
    for (const r of failedResults) {
      console.log(`  ${FAIL} ${r.label}`);
      r.errors.slice(0, 5).forEach(e => console.log(`       ${WARN} ${e}`));
      if (r.errors.length > 5) console.log(`       ${WARN} ...and ${r.errors.length - 5} more`);
    }
  }

  // ── Coverage summary ──────────────────────────────────────────────────────

  console.log("\n\x1b[1mCoverage summary (computing school):\x1b[0m");
  const computingResults = perSchoolResults["computing"] || [];
  const computingTTs     = computingResults.filter(r => r.ok && r.tt);

  if (computingTTs.length) {
    const merged = mergeTTs(computingTTs);

    const depts   = Object.keys(merged).sort();
    const batches = [...new Set(
      Object.values(merged).flatMap(b => Object.keys(b))
    )].sort();

    console.log(`  Departments : ${depts.join("  ")}`);
    console.log(`  Batches     : ${batches.join("  ")}`);

    // Per-dept breakdown
    for (const dept of depts) {
      const batchKeys = Object.keys(merged[dept]).sort();
      const parts = batchKeys.map(b => {
        const secs  = Object.keys(merged[dept][b]).sort().join("");
        const count = countTTEntries({ x: { y: merged[dept][b] } });
        return `${b}[${secs}] ${count}cls`;
      });
      console.log(`  ${INFO} ${dept.padEnd(8)} ${parts.join("  ")}`);
    }

    // Spot-check: find a cell with an explicit batch suffix (sanity that colours worked)
    let suffixExample = null;
    outer:
    for (const [dept, batches] of Object.entries(merged)) {
      for (const [batch, sections] of Object.entries(batches)) {
        for (const [section, days] of Object.entries(sections)) {
          for (const [day, entries] of Object.entries(days)) {
            const hit = entries.find(e => /\d{2}/.test(e.name));
            if (hit) { suffixExample = { dept, batch, section, day, ...hit }; break outer; }
          }
        }
      }
    }
    if (suffixExample) console.log(`\n  ${PASS} Explicit-suffix cell found: ${JSON.stringify(suffixExample)}`);
    else console.log(`\n  ${WARN} No explicit-suffix cells found (colour-only batch assignment may have failed)`);
  } else {
    console.log("  (no computing results to summarise)");
  }

  // ── Final JSON output ─────────────────────────────────────────────────────

  const finalPayload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    count: allResults.reduce((s, r) => s + r.count, 0),
    school: targetSchools.length === 1 ? targetSchools[0] : "all",
    source: "test-run",
    tt: mergeTTs(allResults.filter(r => r.ok && r.tt)),
  };

  // ── Room × Day × Slot breakdown ───────────────────────────────────────────
  // Inverts tt[dept][batch][section][day] → rooms[room][day][slot] = [{course,dept,batch,sec}]

  console.log("\n\x1b[1m─────────────── ROOMS · CLASSES · SUBJECTS ───────────────\x1b[0m\n");

  const rooms = {};
  const ORDERED_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  for (const [dept, batches] of Object.entries(finalPayload.tt)) {
    for (const [batch, sections] of Object.entries(batches)) {
      for (const [section, days] of Object.entries(sections)) {
        for (const [day, entries] of Object.entries(days)) {
          for (const e of entries) {
            const room = e.location || "UNKNOWN";
            rooms[room] = rooms[room] || {};
            rooms[room][day] = rooms[room][day] || {};
            rooms[room][day][e.time] = rooms[room][day][e.time] || [];
            rooms[room][day][e.time].push({
              course:  e.name,
              dept,
              batch,
              section,
            });
          }
        }
      }
    }
  }

  const sortedRooms = Object.keys(rooms).sort();
  for (const room of sortedRooms) {
    console.log(`\x1b[1m${room}\x1b[0m`);
    for (const day of ORDERED_DAYS) {
      const slots = rooms[room][day];
      if (!slots) continue;
      console.log(`  ${day}`);
      const sortedSlots = Object.keys(slots).sort((a, b) => {
        const mins = t => { const [h,m] = t.split(":").map(Number); return h*60+m; };
        return mins(a.split("-")[0]) - mins(b.split("-")[0]);
      });
      for (const slot of sortedSlots) {
        for (const c of slots[slot]) {
          console.log(`    ${slot.padEnd(14)}  ${c.course.padEnd(32)}  ${c.dept} ${c.batch} ${c.section}`);
        }
      }
    }
    console.log("");
  }

  // ── Raw JSON ──────────────────────────────────────────────────────────────

  console.log("\n\x1b[1m─────────────── FINAL MERGED JSON ───────────────\x1b[0m\n");
  console.log(JSON.stringify(finalPayload, null, 2));

  // ── Pass/fail footer ──────────────────────────────────────────────────────

  const passed = allResults.filter(r => r.ok).length;
  const total  = allResults.length;
  const icon   = passed === total ? PASS : FAIL;
  console.log(`\n${icon} ${passed}/${total} passed · ${finalPayload.count} total entries`);
  console.log(`\x1b[36mLog written to: ${LOG_PATH}\x1b[0m\n`);

  finish(passed === total ? 0 : 1);
})();