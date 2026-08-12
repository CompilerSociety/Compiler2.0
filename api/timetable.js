// Vercel Serverless Function: /api/timetable
// Multi-school timetable parser for FAST NUCES Islamabad
// Supports: computing (FSC), engineering (FSE), business (FSM)

const SCHOOLS = {
  computing: {
    id: "1vlTuotLw34fedME3gNQj09cZw-todVomxAiu5P1wZ6Q",
    tabs: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    format: "matrix"
  },
  engineering: {
    id: "1fL2TWhPgbPc2d66vm_KywTpdsGBIaBLqlmz4JLPudCw",
    tabs: ["Classes Schedule FA26 (In Progress)"],
    format: "flat"
  },
  business: {
    id: "1m5yFyi0QgWx0JhdEicQQL2JOEpSmcmVDOIi15_4p9Dw",
    tabs: ["Monday"],
    format: "paired-matrix"
  }
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Section key for batch-wide cells that name a department and year but no
// section letter (e.g. "Project (AI/DS)"). Stored once under this key; the
// frontend merges it into whichever section the student selects.
const ALL_SECTIONS = "ALL";

/* ── Text helpers ── */

function cleanTxt(v) {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function oneLine(v) {
  return cleanTxt(v).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

/* ── Google Sheets fetch ── */

function getGoogleSheetId(idOrUrl) {
  if (!idOrUrl) return "";
  const match = idOrUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : idOrUrl;
}

function gvizUrl(sheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&cachebust=${Date.now()}`;
}

function parseGVizText(text) {
  const raw = String(text || "").trim();
  if (raw.startsWith("{")) return JSON.parse(raw);
  const start = raw.indexOf("("), end = raw.lastIndexOf(")");
  if (start < 0 || end < 0 || end <= start)
    throw new Error("Google Sheets returned an unexpected response. Make sure sharing is: Anyone with the link can view.");
  return JSON.parse(raw.slice(start + 1, end));
}

async function loadSheetGrid(sheetId, sheetName) {
  const res = await fetch(gvizUrl(sheetId, sheetName), {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 Vercel Timetable Sync" }
  });
  if (!res.ok) throw new Error(`Google Sheets HTTP ${res.status} for tab ${sheetName}`);
  const data = parseGVizText(await res.text());
  const rows = data?.table?.rows || [];
  const colCount = Math.max(data?.table?.cols?.length || 0, ...rows.map((r) => (r.c || []).length), 0);
  return rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => {
      const cell = (r.c || [])[i];
      if (!cell) return "";
      return cleanTxt(cell.f ?? cell.v ?? "");
    })
  );
}

/* ── Time helpers ── */

function parseClock(h, mm, ampm) {
  let hour = Number(h), minute = Number(mm || 0);
  const ap = (ampm || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  if (!ap && hour >= 1 && hour <= 6) hour += 12;
  return hour * 60 + minute;
}

function minutesToSlotLabel(min) {
  let h = Math.floor(min / 60), m = min % 60;
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeTimeSlot(text) {
  const t = oneLine(text).replace(/[–—]/g, "-");
  const m = t.match(/(\d{1,2})[:.](\d{2})\s*(AM|PM)?\s*(?:-|to)\s*(\d{1,2})[:.](\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const start = parseClock(m[1], m[2], m[3] || m[6]);
  const end = parseClock(m[4], m[5], m[6] || m[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return `${minutesToSlotLabel(start)}-${minutesToSlotLabel(end)}`;
}

const SLOT_MINUTE_MAP = {
  "08:30":510, "09:50":590,
  "10:00":600, "11:20":680,
  "11:30":690, "12:50":770,
  "01:00":780, "02:20":860,
  "02:30":870, "03:50":950,
  "03:55":955, "05:15":1035,
  "05:20":1040, "06:40":1120,
  "06:45":1125, "08:05":1205,
  "08:30-11:15":510, "11:30-02:15":690,
  "02:30-05:15":870, "05:20-08:05":1040,
};

function slotToMinutes(slot) {
  if (slot in SLOT_MINUTE_MAP) return SLOT_MINUTE_MAP[slot];
  const start = String(slot || "").split("-")[0] || "";
  return SLOT_MINUTE_MAP[start] ?? 99999;
}

/* ── Room helpers ── */

function normalizeRoomName(room) {
  let r = oneLine(room).toUpperCase();
  r = r.replace(/\s+/g, " ");
  r = r.replace(/-{2,}/g, "-");
  r = r.replace(/\b([A-D])\s+(\d{3})\b/, "$1-$2");
  r = r.replace(/\b([A-D])\s+(IT\s+)?LAB\s*[-#]?\s*(\d+)\b/i, "$1-$2LAB $3");
  r = r.replace(/\b([A-D])\s+(MARGALA|RAWAL)\s+(\d+)\b/i, "$1-$2 $3");
  r = r.replace(/\b([A-D])\s+GPU\s+LAB\b/i, "$1-GPU LAB");
  r = r.replace(/\b([A-D])\s+(MEHRAN|CALL)\s*[-#]?\s*(\d*)\b/i, "$1-$2 $3").trim();
  r = r.replace(/\b([A-D])\s+(DIGITAL)\b/i, "$1-$2");
  let m = r.match(/CYBER\s*\(?\s*([A-D])-(\d{3})/i);
  if (m) return `Cyber (${m[1].toUpperCase()}-${m[2]})`;
  if (/\bAUDI(TORIUM)?\b/.test(r)) return "D-AUDI";
  // Rebuild from the canonical prefix, which drops trailing qualifiers such as
  // the "(GPU)" in "C-Rawal 3 (GPU)". Without this the same room arrives under
  // several names and Free Rooms shows one of them idle while a class is in it.
  m = r.match(/^([A-D])\s*-\s*(\d{3}|IT\s*LAB\s*\d+|MARGALA\s*\d*|RAWAL\s*\d*|GPU\s*LAB|MEHRAN\s*\d*|CALL-\d+|DIGITAL\b)/);
  if (m) return `${m[1]}-${m[2].trim()}`;
  // Same rooms written without their block letter at all ("Rawal 3", "Rawal-3").
  // The Margala and Rawal labs are all C block.
  m = r.match(/^(MARGALA|RAWAL)\s*-?\s*(\d+)\b/);
  if (m) return `C-${m[1]} ${m[2]}`;
  return r;
}

function sameRoom(a, b) {
  return normalizeRoomName(a) === normalizeRoomName(b);
}

/* ══════════════════════════════════════════
   COMPUTING SCHOOL — Matrix Parser
   ══════════════════════════════════════════ */

const SLOT_COLS = {
  1: "08:30-09:50", 6: "10:00-11:20", 11: "11:30-12:50",
  16: "01:00-02:20", 21: "02:30-03:50", 26: "03:55-05:15",
  31: "05:20-06:40", 36: "06:45-08:05",
};

const LAB_SLOT_COLS = {
  1: "08:30-11:15", 11: "11:30-02:15", 21: "02:30-05:15", 31: "05:20-08:05",
};

const BATCH_MAP = { "26": "2026", "25": "2025", "24": "2024", "23": "2023", "22": "2022" };
const COMPUTING_PROGRAM_CODES = new Set(["AI", "CS", "CY", "DS", "SE"]);

const CELL_REGEX = /(.+?)\s*\(([A-Z]+(?:\s*[\/,]\s*(?!GP?\b)[A-Z]+)*)(?:-([A-Z0-9]+))?(?:,\s*(?:Gp?-([IV]+)|(\d{2})))?\s*\)/i;

const CLASSROOM_LEFT_BLOCK = {
  roomCol: 0, endCol: 30,
  slotCols: [1, 6, 11, 16, 21, 26],
  slotMap: { 1: "08:30-09:50", 6: "10:00-11:20", 11: "11:30-12:50", 16: "01:00-02:20", 21: "02:30-03:50", 26: "03:55-05:15" }
};
const CLASSROOM_RIGHT_BLOCK = {
  roomCol: 30, endCol: null,
  slotCols: [31, 36],
  slotMap: { 31: "05:20-06:40", 36: "06:45-08:05" }
};
const LAB_BLOCK = {
  roomCol: 0, endCol: null,
  slotCols: [1, 11, 21, 31],
  slotMap: { 1: "08:30-11:15", 11: "11:30-02:15", 21: "02:30-05:15", 31: "05:20-08:05" }
};

/* ── Header-based batch detection ── */

function extractDeptFromHeader(text) {
  const cell = oneLine(text || "");
  if (!cell) return null;

  let m = cell.match(/^(BS|FT|BA|BBA|AF)\s*([A-Za-z][A-Za-z& ]*?)\s*(?:\(\d{4}\))?$/i);
  if (m) return { dept: `${m[1].toUpperCase()} ${m[2].trim().toUpperCase()}`, batch: (cell.match(/\b(20\d{2})\b/) || [])[1] || null };

  m = cell.match(/^MS\s*\(([A-Za-z]+)\)\s*(?:\(\d{4}\))?$/i);
  if (m) return { dept: `MS (${m[1].toUpperCase()})`, batch: "MS" };

  m = cell.match(/^MS\s*([A-Za-z]{2,4})\s*(?:\(\d{4}\))?$/i);
  if (m) return { dept: `MS (${m[1].toUpperCase()})`, batch: "MS" };

  return null;
}

function buildColBatchMap(grid) {
  const map = {};
  const headerRows = grid.slice(0, Math.min(grid.length, 4));
  const maxCols = Math.max(0, ...headerRows.map((row) => (row || []).length));
  for (const row of headerRows) {
    const starts = [];
    for (let c = 0; c < (row || []).length; c++) {
      const info = extractDeptFromHeader(row[c]);
      if (info) starts.push([c, info]);
    }
    for (let i = 0; i < starts.length; i++) {
      const [start, info] = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1][0] : maxCols;
      for (let c = Math.max(1, start); c < end; c++) map[c] = info;
    }
  }
  return map;
}

function lookupBatchForCol(colBatchMap, col, courseName, cellText) {
  const explicitMatch = cellText.match(/,\s*(\d{2})\s*\)/);
  if (explicitMatch) {
    const short = explicitMatch[1];
    return BATCH_MAP[short] || "20" + short;
  }
  if (colBatchMap[col] && colBatchMap[col].batch && colBatchMap[col].batch !== "MS") {
    return colBatchMap[col].batch;
  }
  if (colBatchMap[col] && colBatchMap[col].batch === "MS") return "MS";
  return inferBatchFromCourse(courseName) || "2023";
}

function inferBatchFromCourse(courseName) {
  const name = String(courseName || "").toUpperCase();
  if (/\b(CAPSTONE|FYP|SENIOR\s+PROJECT|FINAL\s+YEAR\s+PROJECT|TECH\s+STARTUP|TECH\s+ENTREPRENEURSHIP|INNOVATION\s+LAB|RESEARCH\s+METHODS|AI\s+ETHICS|DIGITAL\s+FORENSICS|ETHICAL\s+HACK|MALWARE|BIG\s+DATA|BDA|AUTONOMOUS\s+VEHICLES|ROBOTICS|IOT|PROFESSIONAL\s+ETHICS|BUSINESS\s+COMMUNICATION|ENTRE|TECH\s+MGT|COMP\s+VISION|COMPUTER\s+VISION)\b/i.test(name)) {
    return "2022";
  }
  if (/\b(COMPILER|COMP\s+CONST|PDC|PARALLEL|ARTIFICIAL\s+INTELLIGENCE|\bAI\b|MACHINE\s+LEARNING|\bML\b|DEEP\s+LEARN|DEEP\s+LEARNING|COMPUTER\s+NETWORKS|\bCN\b|COMP\s+NET|SOFTWARE\s+ENGINEERING|\bSE\b|SPM|PROJECT\s+MANAGEMENT|INFO\s+SEC|INFORMATION\s+SECURITY|PPIT|PROFESSIONAL\s+PRACTICES|IMAGE\s+PROCESSING|\bDIP\b|NATURAL\s+LANGUAGE|NLP|CLOUD\s+COMP|METRIC|GEN\s+AI|GENERATIVE\s+AI|PRODUCT\s+DEV|GAME\s+DEV|MOBILE\s+APP|STAT\s+MODELING|DIGITAL\s+MKTG|FIN\s+MGT)\b/i.test(name)) {
    return "2023";
  }
  if (/\b(DATA\s+ST|DATA\s+STRUCTURES|OPERATING\s+SYSTEMS|\bOS\b|DATABASE|\bDB\b|REQUIREMENTS|SRE|DESIGN\s+&\s+ARCHITECTURE|SDA|COMPUTER\s+ORGANIZATION|COAL|PROBABILITY|PROB\s+&\s+STATS|STATS\s+FOR\s+ML|LINEAR\s+ALGEBRA|DATA\s+ANALYSIS)\b/i.test(name)) {
    return "2024";
  }
  if (/\b(OBJECT|OOP|DISCRETE|DIGITAL\s+LOGIC|DLD|MULTIVARIABLE|MV\s+CALCULUS|APPLIED\s+PHYSICS|\bAP\b|PAK\s+STUDIES|PAKISTAN|FUNCTIONAL\s+ENGLISH|EXP\s+WRITING|EXPOSITORY|SEERAH|ISLAMIC|CIVICS|PROGRAMMING|\bPF\b|INTRO\s+TO\s+COMPUTING|ITC|CALCULUS|COMPOSITION)\b/i.test(name)) {
    return "2025";
  }
  return null;
}

// A time written after the closing paren overrides the column's slot time,
// e.g. "PF (SE-E) 09:30-10:50" runs 09:30-10:50, not the column's 08:30-09:50.
const CELL_TIME_OVERRIDE_RE = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/;
// A parenthetical holding nothing but a section letter, e.g. "Web Comp (A)".
const SECTION_ONLY_RE = /^[A-H]\d?$/i;

function parseTimetableCell(text) {
  const t = oneLine(text);
  if (!t) return null;
  const parenEnd = t.indexOf(")");
  const core = parenEnd >= 0 ? t.slice(0, parenEnd + 1) : t;
  const tail = parenEnd >= 0 ? t.slice(parenEnd + 1) : "";
  const ov = tail.match(CELL_TIME_OVERRIDE_RE);
  const timeOverride = ov ? `${ov[1]}-${ov[2]}` : null;
  const m = core.match(CELL_REGEX);
  if (!m) return null;
  const course = m[1].trim();
  const deptStr = m[2];
  let section = m[3];
  const group = m[4];
  if (!section && group) section = `G-${group.toUpperCase()}`;
  const rawCodes = deptStr.split(/\s*[\/,]\s*/).map((dept) => dept.trim().toUpperCase()).filter(Boolean);
  const depts = rawCodes.filter((dept) => dept.length >= 2);
  if (!depts.length) {
    // "Web Comp (A)" — the parenthetical is a bare section letter, not a
    // department. Keep the cell and let the column header supply the dept.
    if (rawCodes.length === 1 && SECTION_ONLY_RE.test(rawCodes[0]) && !section) {
      section = rawCodes[0].toUpperCase();
    } else {
      return null;
    }
  }
  return { depts, section: section || null, hasSection: Boolean(section), course, timeOverride };
}

function isMSContext(batch, dept) {
  return batch === "MS" || String(dept || "").startsWith("MS");
}

function resolveDepartmentsForCell(parsed, headerInfo, batch) {
  const headerDept = headerInfo?.dept || "";
  if (isMSContext(batch, headerDept)) {
    const msDepts = parsed.depts
      .filter((dept) => COMPUTING_PROGRAM_CODES.has(dept))
      .map((dept) => `MS (${dept})`);
    if (msDepts.length) return msDepts;
    if (headerDept) return [headerDept];
    return [];
  }
  if (headerDept) return [headerDept];
  return parsed.depts.map((dept) => `BS ${dept}`);
}

function findHeaderRow(grid) {
  const candidates = [];
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const cell = oneLine(grid[r][0] || "");
    if (/room/i.test(cell)) {
      let slotsFound = 0;
      for (const cIdx of Object.keys(SLOT_COLS)) {
        const v = oneLine(grid[r][parseInt(cIdx)] || "");
        if (normalizeTimeSlot(v)) slotsFound++;
      }
      if (slotsFound >= 4) return r;
      candidates.push(r);
    }
  }
  if (candidates.length) return candidates[0];
  return -1;
}

function findLabHeaderRow(grid, afterRow) {
  for (let r = afterRow; r < grid.length; r++) {
    const colA = oneLine(grid[r][0] || "").toLowerCase();
    if (colA.includes("lab")) return r;
    const colB = oneLine(grid[r][1] || "");
    if (/^\d{1,2}:\d{2}-(?:1[0-5]|0\d|2[0-3]):\d{2}$/.test(colB) && grid[r].filter(c => oneLine(c)).length <= 6) return r;
  }
  return -1;
}

function slotForColumn(col, slotCols) {
  let chosen = null;
  for (const slotCol of slotCols) {
    if (slotCol <= col) chosen = slotCol;
  }
  return chosen;
}

function addCourseToTT(target, { dept, batch, section, day, course, room, time }) {
  if (!dept || !batch || !section || !day || !course || !room || !time) return false;
  registerSlot(time);
  const depts = Array.isArray(dept) ? dept : [dept];
  let added = false;
  for (const deptCode of depts) {
    if (!deptCode) continue;
    target[deptCode] = target[deptCode] || {};
    target[deptCode][batch] = target[deptCode][batch] || {};
    target[deptCode][batch][section] = target[deptCode][batch][section] || {};
    target[deptCode][batch][section][day] = target[deptCode][batch][section][day] || [];
    const arr = target[deptCode][batch][section][day];
    if (!arr.some((x) => x.c === course && sameRoom(x.l, room) && x.t === time)) {
      arr.push({ c: course, l: room, t: time });
      added = true;
    }
  }
  return added;
}

const SLOTS = [];

function registerSlot(slot) {
  if (!slot || SLOTS.includes(slot)) return;
  SLOTS.push(slot);
  SLOTS.sort((a, b) => slotToMinutes(a) - slotToMinutes(b));
}

function countTTEntries(tt) {
  let n = 0;
  Object.values(tt).forEach((batches) =>
    Object.values(batches).forEach((sections) =>
      Object.values(sections).forEach((days) =>
        Object.values(days).forEach((arr) => { n += arr.length; })
      )
    )
  );
  return n;
}

function countReferenceEntries(tt) {
  let n = 0;
  Object.values(tt || {}).forEach((deps) =>
    Object.values(deps || {}).forEach((batches) =>
      Object.values(batches || {}).forEach((sections) =>
        Object.values(sections || {}).forEach((arr) => { n += (arr || []).length; })
      )
    )
  );
  return n;
}

function legacyTTToReferenceTT(tt) {
  const out = {};
  Object.entries(tt || {}).forEach(([depCode, batches]) => {
    const depLabel = depCode.startsWith("BS ") || depCode.startsWith("MS ") ? depCode : `BS ${depCode}`;
    out[depLabel] = out[depLabel] || {};
    Object.entries(batches || {}).forEach(([batch, sections]) => {
      out[depLabel][batch] = out[depLabel][batch] || {};
      Object.entries(sections || {}).forEach(([section, days]) => {
        out[depLabel][batch][section] = out[depLabel][batch][section] || {};
        Object.entries(days || {}).forEach(([day, arr]) => {
          out[depLabel][batch][section][day] = (arr || []).map((entry) => ({
            name: entry.c,
            location: entry.l,
            time: entry.t
          }));
        });
      });
    });
  });
  return out;
}

/* ── Matrix parser for Computing school ── */

function parseMatrixBlock(grid, startRow, endRow, block, day, target, colBatchMap, pending = []) {
  let added = 0;
  for (let r = startRow; r < Math.min(endRow, grid.length); r++) {
    const row = grid[r] || [];
    const room = normalizeRoomName(oneLine(row[block.roomCol] || ""));
    if (!room || room.length < 2 || /reserved|tutorial|fsm|fsa|fcss|fyp|travel|admin|room/i.test(room)) continue;
    for (let i = 0; i < block.slotCols.length; i++) {
      const timeCol = block.slotCols[i];
      const nextCol = block.slotCols[i + 1] ?? (block.endCol ?? row.length);
      const scanEnd = Math.min(nextCol, block.endCol ?? row.length, row.length);
      let parsed = null;
      for (let col = timeCol; col < scanEnd; col++) {
        const cell = oneLine(row[col] || "");
        if (!cell) continue;
        parsed = parseTimetableCell(cell);
        if (parsed) {
          const headerInfo = colBatchMap[col] || null;
          const batch = lookupBatchForCol(colBatchMap, col, parsed.course, cell);
          if (!batch) continue;
          const depts = resolveDepartmentsForCell(parsed, headerInfo, batch);
          const section = parsed.section || (depts.some((dept) => isMSContext(batch, dept)) ? "A" : "");
          // An explicit time in the cell beats the column's slot.
          const time = parsed.timeOverride || block.slotMap[timeCol];
          if (!section) {
            // Cells like "Project (AI/DS)" or "HCI (SE, 22)" name no section
            // because they apply to the whole batch. Dropping them silently
            // emptied the final-year timetables, so hold them here and fan
            // them out across that batch's sections once every day is read.
            pending.push({ depts, batch, day, course: parsed.course, room, time });
            break;
          }
          for (const dept of depts) {
            if (addCourseToTT(target, { dept, batch, section, day, course: parsed.course, room, time })) added++;
          }
          break;
        }
      }
    }
  }
  return added;
}

function parseGridToTT(grid, day, target, pending = []) {
  const colBatchMap = buildColBatchMap(grid);
  const hr = findHeaderRow(grid);
  if (hr < 0) return 0;
  const lr = findLabHeaderRow(grid, hr + 1);
  const classroomEnd = lr > 0 ? lr : grid.length;
  let added = 0;
  added += parseMatrixBlock(grid, hr + 1, classroomEnd, CLASSROOM_LEFT_BLOCK, day, target, colBatchMap, pending);
  added += parseMatrixBlock(grid, hr + 1, classroomEnd, CLASSROOM_RIGHT_BLOCK, day, target, colBatchMap, pending);
  if (lr > 0) added += parseMatrixBlock(grid, lr + 1, grid.length, LAB_BLOCK, day, target, colBatchMap, pending);
  return added;
}

/**
 * Place the cells that named no section.
 *
 * These are batch-wide listings — "Project (AI/DS)", "HCI (SE, 22)" — where the
 * sheet gives a department and year but no section letter. Previously they were
 * dropped, which left the final-year timetables nearly empty.
 *
 * They are stored ONCE under the reserved ALL_SECTIONS key rather than copied
 * into every section. Copying would both inflate the file and assert something
 * the sheet does not say: a single lab cannot hold an entire batch, so "every
 * section attends this" would be a fabrication. The frontend merges ALL_SECTIONS
 * into whichever section the student picks, so the class is visible to the whole
 * batch while the data stays truthful about what the sheet actually states.
 */
function flushSectionless(target, pending) {
  let added = 0;
  for (const item of pending) {
    for (const dept of item.depts) {
      if (addCourseToTT(target, {
        dept, batch: item.batch, section: ALL_SECTIONS, day: item.day,
        course: item.course, room: item.room, time: item.time,
      })) added++;
    }
  }
  return added;
}

/* ══════════════════════════════════════════
   BUSINESS SCHOOL — Paired-Column Matrix Parser
   Format: each time slot spans 9 columns (course at col N, section at col N+7)
   Day name in col 0, Classes/Labs in col 1, Room in col 2
   ══════════════════════════════════════════ */

const FSM_COURSE_RE = /^([A-Za-z]{2,4}\s?\d{4,5})\s*/;
const FSM_TIME_OVERRIDE_RE = /\((\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)\)\s*$/i;
const FSM_SECTION_RE = /^([A-Z]{2,5})(\d{2})([A-Z])(\d)?$/;
const FSM_COMBINED_RE = /^([A-Z]{2,5}\d{2})\s*([A-Z](?:\s*[\/&]\s*[A-Z])+)$/;

const FSM_SLOT_STARTS = [3, 12, 21, 30, 39, 48];
const FSM_SLOT_WIDTH = 9;
const FSM_SECTION_OFFSET = 7;

const FSM_DAY_RE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i;

const FSM_PROGRAM_MAP = {
  "FT": "BS Fintech",
  "BSFT": "BS Fintech",
  "BA": "BS Business Analytics",
  "BSBA": "BS Business Analytics",
  "BBA": "BS Business Administration",
  "AF": "BS Accounting & Finance"
};

function parseFSMCourseName(raw) {
  raw = oneLine(raw || "");
  if (!raw) return null;

  let timeOverride = null;
  const tm = raw.match(FSM_TIME_OVERRIDE_RE);
  if (tm) {
    timeOverride = normalizeTimeSlot(tm[1]);
    raw = raw.slice(0, tm.index).trim();
  }

  let code = null;
  let title = raw;
  const cm = raw.match(FSM_COURSE_RE);
  if (cm) {
    code = cm[1].replace(/\s/g, "");
    title = raw.slice(cm.index + cm[0].length).trim();
  }

  return { code, title, timeOverride, full: raw };
}

function parseFSMSectionCode(raw) {
  raw = oneLine(raw || "").toUpperCase().replace(/\s+/g, "");
  if (!raw) return null;

  // Try combined: "BBA08A/B/C" → multiple sections
  const combo = raw.match(FSM_COMBINED_RE);
  if (combo) {
    const base = combo[1];
    const lettersStr = combo[2].replace(/[\/&]/g, " ");
      const letters = lettersStr.trim().split(/\s+/);
    const results = [];
    for (let i = 0; i < letters.length; i++) {
      const l = letters[i];
      const code = i === 0 ? base : base.slice(0, -1) + l;
      const m = code.match(FSM_SECTION_RE);
      if (m) {
        results.push({
          program: m[1],
          semester: m[2],
          section: m[3],
          subSection: m[4] || null,
          full: code
        });
      }
    }
    return results.length > 0 ? results : null;
  }

  // Single section code: "FT02A", "BSFT04D"
  const m = raw.match(FSM_SECTION_RE);
  if (m) {
    return [{
      program: m[1],
      semester: m[2],
      section: m[3],
      subSection: m[4] || null,
      full: raw
    }];
  }

  return null;
}

function fsmSemesterToBatch(semester) {
  const sem = parseInt(semester, 10);
  if (isNaN(sem)) return null;
  // Spring 2026: sem 2 → batch 2025, sem 4 → batch 2024, etc.
  const currentYear = 2026;
  const batch = currentYear - Math.floor(sem / 2);
  return String(batch);
}

function inferFSMBatchFromCourse(courseTitle) {
  const name = (courseTitle || "").toUpperCase();
  // Capstone / senior-level courses → batch 2022
  if (/\b(CAPSTONE|FYP|SENIOR\s+PROJECT|THESIS|RESEARCH\s+PROJECT|TECH\s+STARTUP|ENTREPRENEURSHIP|INNOVATION|BUSINESS\s+ETHICS|ECONOMY\s+OF\s+PAKISTAN|SUPPLY\s+CHAIN|STRATEGY|HUMAN\s+RESOURCE\s+METRIC|BUSINESS\s+STRATEGY|TAXATION|FINANCIAL\s+DATA\s+ANALYTICS)\b/i.test(name)) {
    return "2022";
  }
  if (/\b(PREDICTIVE\s+ANALYTICS|BUSINESS\s+ANALYTICS|DATABASE\s+SYSTEMS\s+FOR\s+BUSINESS|DATA\s+ANALYSIS\s+FOR\s+BUSINESS|BUSINESS\s+RESEARCH|FINANCIAL\s+STATEMENT\s+ANALYSIS|CORPORATE\s+ACCOUNTING|FINANCIAL\s+INSTITUTIONS|BUSINESS\s+COMMUNICATION|PRINCIPLES\s+OF\s+LEADERSHIP|CRITICAL\s+THINKING|MACROECONOMICS|BUSINESS\s+LAW|WEB\s+PROGRAMMING)\b/i.test(name)) {
    return "2023";
  }
  if (/\b(FINANCIAL\s+MANAGEMENT|BUSINESS\s+FINANCE|MARKETING\s+MANAGEMENT|FUNDAMENTAL\s+OF\s+MANAGEMENT|FUNDAMENTALS\s+OF\s+MANAGEMENT|DATA\s+ANALYSIS\s+FOR\s+BUSINESS\s+I|DATA\s+ANALYSIS\s+FOR\s+BUSINESS\s+II|BUSINESS\s+MATH|MACROECONOMICS|ENVIRONMENTAL\s+SCIENCE|DATABASE\s+SYSTEMS|INTRODUCTION\s+TO\s+DATABASE|ENGLISH\s+II|BUSINESS\s+COMMUNICATION|PAKISTAN\s+STUDIES|IDEOLOGY\s+AND\s+CONSTITUTION|ISLAMIC\s+STUDIES|SIRAT|FINANCIAL\s+ACCOUNTING)\b/i.test(name)) {
    return "2024";
  }
  if (/\b(PROGRAMMING\s+FOR\s+BUSINESS|ENGLISH|IT\s+IN\s+BUSINESS|BUSINESS\s+MATH|FUNDAMENTALS\s+OF\s+MANAGEMENT|PRINCIPLES\s+OF\s+MANAGEMENT)\b/i.test(name)) {
    return "2025";
  }
  return null;
}

function parseBusinessGrid(grid, tabName, target) {
  const day = normalizeDay(tabName);
  if (!day) return 0;
  let added = 0;

  // Find header row with time slots
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 5); r++) {
    const cell = oneLine(grid[r][2] || "");
    if (/room/i.test(cell)) {
      // Check it has at least 3 time slots
      let slotCount = 0;
      for (const sc of FSM_SLOT_STARTS) {
        if (normalizeTimeSlot(oneLine(grid[r][sc] || ""))) slotCount++;
      }
      if (slotCount >= 3) { headerRow = r; break; }
    }
  }
  if (headerRow < 0) return 0;

  // Detect time labels from header row
  const headerTimes = {};
  for (const sc of FSM_SLOT_STARTS) {
    const slot = normalizeTimeSlot(oneLine(grid[headerRow][sc] || ""));
    if (slot) headerTimes[sc] = slot;
  }
  if (Object.keys(headerTimes).length < 3) return 0;

  // Walk data rows after header
  let currentDay = day;
  let currentType = "Classes";
  const processedCourses = new Set();

  for (let r = headerRow + 1; r < grid.length; r++) {
    const rowData = grid[r] || [];

    // Track day name (col 0) – only first row of each day block has it
    const dayCell = oneLine(rowData[0] || "");
    const dayMatch = dayCell.match(FSM_DAY_RE);
    if (dayMatch) currentDay = dayMatch[1];

    // Track Classes/Labs (col 1)
    const typeCell = oneLine(rowData[1] || "");
    if (typeCell === "Classes" || typeCell === "Labs") currentType = typeCell;

    // Room (col 2)
    const rawRoom = oneLine(rowData[2] || "");
    if (!rawRoom || rawRoom.length < 2) continue;
    const room = normalizeRoomName(rawRoom);
    if (/reserved|tutorial|fsm|fsa|fcss|fyp|travel|admin|room/i.test(rawRoom)) continue;
    if (!room || room.length < 2) continue;

    // If this is a Labs header row (has time slots but no room after col 2), skip
    if (currentType === "Labs" && typeCell === "Labs" && !rawRoom) continue;

    // Process each time slot
    const slotStarts = Object.keys(headerTimes).map(Number).sort((a, b) => a - b);
    for (let si = 0; si < slotStarts.length; si++) {
      const sc = slotStarts[si];
      const time = headerTimes[sc];
      const sEnd = si + 1 < slotStarts.length ? slotStarts[si + 1] : sc + FSM_SLOT_WIDTH;
      const sectionCol = sc + FSM_SECTION_OFFSET;

      const courseRaw = oneLine(rowData[sc] || "");
      if (!courseRaw) continue;

      const parsedCourse = parseFSMCourseName(courseRaw);
      if (!parsedCourse) continue;

      // Find section code – scan forward from section offset to end of slot
      let sectionRaw = "";
      for (let c = sectionCol; c < Math.min(sEnd, rowData.length); c++) {
        const cell = oneLine(rowData[c] || "");
        if (cell) { sectionRaw = cell; break; }
      }
      if (!sectionRaw) continue;

      // Skip non-section entries in labs (like lone "CS")
      if (sectionRaw.length < 4 && !/\d/.test(sectionRaw)) continue;

      const parsedSections = parseFSMSectionCode(sectionRaw);
      if (!parsedSections) continue;

      const courseLabel = parsedCourse.code
        ? `${parsedCourse.title} (${parsedCourse.code})`
        : parsedCourse.title;

      // Generate one record per (section, combined-section-letter)
      for (const ps of parsedSections) {
        const dept = FSM_PROGRAM_MAP[ps.program] || ps.program;
        let batch = fsmSemesterToBatch(ps.semester);

        // Fallback: infer batch from course title
        if (!batch) batch = inferFSMBatchFromCourse(parsedCourse.title);
        if (!batch) batch = "2025";

        const section = ps.section;
        const sub = ps.subSection || "";

        // Use time override if present
        const effectiveTime = parsedCourse.timeOverride || time;

        // Deduplicate: same dept+batch+section+day+course+room+time
        const dedupKey = `${dept}|${batch}|${section}|${currentDay}|${courseLabel}|${room}|${effectiveTime}`;
        if (processedCourses.has(dedupKey)) continue;
        processedCourses.add(dedupKey);

        if (addCourseToTT(target, {
          dept,
          batch,
          section,
          day: currentDay,
          course: courseLabel,
          room,
          time: effectiveTime
        })) added++;
      }
    }
  }

  return added;
}

/* ══════════════════════════════════════════
   ENGINEERING SCHOOL — Full Grid Parser
   All five weekdays live on one tab; day is read from column 0. Each header
   row has "Room"/"LABS" in col 2 with time labels in later columns, and each
   entry uses a course row followed by an instructor row. This extracts real
   rooms and times (the old parser produced TBA placeholders).
   ══════════════════════════════════════════ */

const FSE_SECTION_RE = /^(.*?)\s+((?:[A-Z][A-Za-z]*[-/])*(?:\s*)([A-Z]))\s*$/;
const FSE_SUFFIX_RE = /^((?:[A-Z][A-Za-z]*[-/])*)\s*([A-Z])$/;
const FSE_VALID_SECTIONS = new Set(["A", "B", "C", "D"]);

function parseFseCourseTitle(title) {
  if (!title) return null;
  const t = oneLine(title).trim();
  if (!t) return null;
  const skip = ["reserved", "fsm", "fse faculty", "quiz", "pf quiz"];
  if (skip.some((w) => t.toLowerCase().startsWith(w))) return null;
  if (/^\d{1,2}:\d{2}/.test(t) || /^Room\b/i.test(t)) return null;
  const m = t.match(FSE_SECTION_RE);
  if (!m) return null;
  const course = m[1].trim();
  const suffixRaw = m[2].trim();
  const section = m[3].toUpperCase();
  if (!FSE_VALID_SECTIONS.has(section)) return null;
  let programs = [];
  const sm = suffixRaw.match(FSE_SUFFIX_RE);
  if (sm && sm[1]) programs = sm[1].split(/[-/]/).map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (course.length < 3) return null;
  return { course, programs, section };
}

function fseResolveDepartments(parsed) {
  const programs = parsed.programs || [];
  if (!programs.length) return ["BS EE"];
  const depts = [];
  for (const p of programs) {
    const u = p.toUpperCase();
    if (u === "CE") depts.push("BS CE");
    else depts.push("BS EE"); // EE, Int, unknown → EE
  }
  return [...new Set(depts)];
}

// Keyword fallback for FSE batches. Mirrors infer_fse_batch_fallback() in
// python/generate_timetable/schools/engineering.py — keep the two in step.
//
// Retuned for Fall 2026: every tier moved on a year and a 1st-semester tier
// was added. Without it this could not return "2026" at all, so the freshman
// batch was scattered into whichever older bucket its course names hit.
function inferFseBatch(courseName) {
  const name = (courseName || "").toUpperCase();
  if (/\b(APPLIED\s+CALCULUS|APPLICATIONS\s+OF\s+ICT|PHYSICS\s+FOR\s+ENGR|PHYSICS\s+FOR\s+ENGINEER|PAKISTAN\s+STUD|ENGLISH\s+LANGUAGE|OCCUPATIONAL\s+HEALTH|ENGINEERING\s+DRAWING|PROG\.?\s+FUNDAMENTALS|PROGRAMMING\s+FUNDAMENTALS)/.test(name)) return "2026";
  if (/\b(LINEAR\s+CIRCUIT\s+ANALYSIS|PROG\.?\s+FOR\s+ENGINEERS|DIFFERENTIAL\s+EQU|LINEAR\s+ALGEBRA|APPLIED\s+PHYSICS|CIVICS|COMMUNITY\s+ENGAGEMENT|UNDERSTANDING\s+OF\s+HOLY|DIGITAL\s+LOGIC|OBJECT\s+ORIENTED)/.test(name)) return "2025";
  if (/\b(SIGNAL\s+.?\s*SYSTEMS?|DATA\s+STRUCT|PROBABILITY|PROB\.?\s+.?\s*RANDOM|COMMUNICATION\s+SKILLS?|ELECTRICAL\s+NETWORK|ELECT\.?\s+NETWK|BASIC\s+MECH|TECH\.?\s+COMM|ANALOG|COMPUTER\s+ARCH|COMPUTER\s+ORG|DATABASE|MICROPROCESSOR)/.test(name)) return "2024";
  if (/\b(ENGINEERING\s+ECONOMICS|ENTREPRENEURSHIP|OPERATING\s+SYSTEMS?|ELECTRO.?MECHANICAL|NETWORK\s+PROGRAM|FEEDBACK\s+CONTROL|INTRODUCTION\s+TO\s+IOT|ENGINEERING\s+WORKSHOP|POWER\s+ELECTRONICS?|DIGITAL\s+SIGNAL|VLSI|INDUSTRIAL\s+PROC|DEEP\s+LEARN|COMPUTATIONAL\s+STAT)/.test(name)) return "2023";
  return "2024";
}

function normaliseFseRoom(raw) {
  const r = oneLine(raw);
  const m = r.toUpperCase().match(/^([A-D])\s*-?\s*(\d{3})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return r.toUpperCase();
}

function parseEngineeringGrid(grid, tabName, target) {
  const total = grid.length;
  if (total < 5) return 0;
  let added = 0;

  // Map every row to its active day (day name appears in column 0).
  const rowDays = new Array(total).fill(null);
  let curDay = null;
  for (let r = 0; r < total; r++) {
    const c0 = oneLine((grid[r] || [])[0] || "").trim();
    if (DAYS.includes(c0)) curDay = c0;
    rowDays[r] = curDay;
  }

  // Find header rows ("Room"/"LABS" in col 2 with ≥3 time labels after it).
  const headerRows = [];
  for (let r = 0; r < total; r++) {
    const row = grid[r] || [];
    if (row.length < 3) continue;
    const col2 = oneLine(row[2] || "").trim().toUpperCase();
    if (col2 === "ROOM" || col2 === "LABS") {
      const slotMap = {};
      for (let c = 3; c < row.length; c++) {
        const s = normalizeTimeSlot(oneLine(row[c] || ""));
        if (s) slotMap[c] = s;
      }
      if (Object.keys(slotMap).length >= 3) headerRows.push([r, slotMap]);
    }
  }
  if (!headerRows.length) return 0;

  for (let hi = 0; hi < headerRows.length; hi++) {
    const [hRow, slotMap] = headerRows[hi];
    let dataEnd = hi + 1 < headerRows.length ? headerRows[hi + 1][0] : total;
    for (let r = hRow + 1; r < dataEnd; r++) {
      if (grid[r] && oneLine(grid[r][0] || "").trim().toLowerCase() === "keys") { dataEnd = r; break; }
    }
    const slotCols = Object.keys(slotMap).map(Number).sort((a, b) => a - b);

    // Data rows come in course/instructor pairs.
    let r = hRow + 1;
    while (r < dataEnd) {
      const row = grid[r] || [];
      const roomRaw = oneLine(row[2] || "").trim();
      if (!roomRaw) { r++; continue; }
      if (/reserved|room|labs/i.test(roomRaw)) { r += 2; continue; }
      const room = normaliseFseRoom(roomRaw);

      for (let si = 0; si < slotCols.length; si++) {
        const sc = slotCols[si];
        const nextSc = si + 1 < slotCols.length ? slotCols[si + 1] : row.length;
        const timeLabel = slotMap[sc];
        let courseText = null, courseCol = null;
        for (let c = sc; c < Math.min(nextSc, row.length); c++) {
          const cell = oneLine(row[c] || "");
          if (cell) { courseText = cell; courseCol = c; break; }
        }
        if (!courseText) continue;

        // Instructor row may carry a per-class time override.
        let effTime = timeLabel;
        const instrRow = r + 1 < total ? grid[r + 1] : [];
        if (instrRow && courseCol != null) {
          const to = normalizeTimeSlot(oneLine(instrRow[courseCol] || ""));
          if (to) effTime = to;
        }

        const parsed = parseFseCourseTitle(courseText);
        if (!parsed) continue;
        let depts = fseResolveDepartments(parsed);
        let batch = inferFseBatch(parsed.course);
        if (instrRow && courseCol != null && /\bPhd\b|\bMS\s+EE\b/i.test(oneLine(instrRow[courseCol] || ""))) {
          depts = ["MS EE"]; batch = "MS";
        }
        const day = rowDays[r];
        if (!day) continue;
        for (const dept of depts) {
          if (addCourseToTT(target, { dept, batch, section: parsed.section, day, course: parsed.course, room, time: effTime })) added++;
        }
      }
      r += 2;
    }
  }
  return added;
}

/* ══════════════════════════════════════════
   CD Room Occupancy (unchanged from original)
   ══════════════════════════════════════════ */

function isCDBlockRoom(room) {
  return /^[CD]-/.test(normalizeRoomName(room));
}

function cellToOccupancyInfo(cell) {
  const t = oneLine(cell);
  if (!t || /^reserved$/i.test(t)) return null;
  const parsed = parseTimetableCell(t);
  if (parsed) {
    const batch = lookupBatchForCol({}, 0, parsed.course, t) || "2023";
    return {
      course: parsed.course,
      dept: `BS ${parsed.depts[0]}`,
      batch,
      section: parsed.section
    };
  }
  return {
    course: t.replace(/\s*\([^)]*\).*$/, "").trim() || t,
    dept: "",
    batch: "",
    section: ""
  };
}

function addCDOccupancy(target, day, room, time, info) {
  const key = normalizeRoomName(room);
  target[day] = target[day] || {};
  target[day][key] = target[day][key] || [];
  if (!target[day][key].some((x) => x.time === time && x.course === info.course)) {
    target[day][key].push({ ...info, time });
  }
}

function parseCDBlock(grid, startRow, endRow, block, day, target) {
  let added = 0;
  for (let r = startRow; r < Math.min(endRow, grid.length); r++) {
    const row = grid[r] || [];
    const room = normalizeRoomName(oneLine(row[block.roomCol] || ""));
    if (!room || room.length < 2 || /^(room|admin)$/i.test(room)) continue;
    if (!isCDBlockRoom(room)) continue;
    for (let i = 0; i < block.slotCols.length; i++) {
      const timeCol = block.slotCols[i];
      const time = block.slotMap[timeCol];
      const nextCol = block.slotCols[i + 1] ?? (block.endCol ?? row.length);
      const scanEnd = Math.min(nextCol, block.endCol ?? row.length, row.length);
      for (let col = timeCol; col < scanEnd; col++) {
        const info = cellToOccupancyInfo(row[col] || "");
        if (!info) continue;
        addCDOccupancy(target, day, room, time, info);
        added++;
        break;
      }
    }
  }
  return added;
}

function parseGridToCDOccupancy(grid, day, target) {
  const hr = findHeaderRow(grid);
  if (hr < 0) return 0;
  const lr = findLabHeaderRow(grid, hr + 1);
  const classroomEnd = lr > 0 ? lr : grid.length;
  let added = 0;
  added += parseCDBlock(grid, hr + 1, classroomEnd, CLASSROOM_LEFT_BLOCK, day, target);
  added += parseCDBlock(grid, hr + 1, classroomEnd, CLASSROOM_RIGHT_BLOCK, day, target);
  if (lr > 0) added += parseCDBlock(grid, lr + 1, grid.length, LAB_BLOCK, day, target);
  return added;
}

function countCDOccupancyEntries(occupancy) {
  let n = 0;
  Object.values(occupancy || {}).forEach((dayMap) => {
    Object.values(dayMap || {}).forEach((arr) => { n += (arr || []).length; });
  });
  return n;
}

async function fetchCDRoomOccupancyFromSheets(sheetId) {
  const occupancy = {};
  let total = 0;
  for (const tab of SCHOOLS.computing.tabs) {
    const grid = await loadSheetGrid(sheetId, tab);
    const day = normalizeDay(tab);
    if (day) total += parseGridToCDOccupancy(grid, day, occupancy);
  }
  if (!total) throw new Error("Parsed 0 C/D room slots from Google Sheet.");
  return { occupancy, count: total };
}

/* ══════════════════════════════════════════
   Main Orchestrator
   ══════════════════════════════════════════ */

function normalizeDay(v) {
  const t = oneLine(v).toLowerCase();
  return DAYS.find((d) => t.includes(d.toLowerCase())) || null;
}

function nonEmptySamples(grid, max = 30) {
  const samples = [];
  for (let r = 0; r < grid.length && samples.length < max; r++) {
    for (let c = 0; c < (grid[r] || []).length && samples.length < max; c++) {
      const v = oneLine(grid[r][c]);
      if (v) samples.push({ r: r + 1, c: c + 1, v: v.slice(0, 160) });
    }
  }
  return samples;
}

async function fetchReferenceTimetable() {
  const url = `https://fastschedule.github.io/db/timetable.json?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Reference timetable HTTP ${res.status}`);
  const tt = await res.json();
  if (!tt || typeof tt !== "object") throw new Error("Reference timetable payload is empty");
  return tt;
}

function buildTTForSchool(grids, school) {
  const tt = {};
  SLOTS.length = 0;
  const pending = [];   // cells naming no section; placed once every day is read

  for (const sheet of grids) {
    if (sheet.error) continue;

    if (school.format === "matrix") {
      // Computing uses one tab per weekday; the tab name IS the day.
      const day = normalizeDay(sheet.name);
      if (!day) continue;
      parseGridToTT(sheet.grid, day, tt, pending);
    } else if (school.format === "paired-matrix") {
      // Business and engineering keep all weekdays on a single tab and read
      // the day from the grid itself, so the tab name need not be a weekday.
      parseBusinessGrid(sheet.grid, sheet.name, tt);
    } else if (school.format === "flat") {
      parseEngineeringGrid(sheet.grid, sheet.name, tt);
    }
  }

  if (pending.length) flushSectionless(tt, pending);

  Object.values(tt).forEach((batches) =>
    Object.values(batches).forEach((sections) =>
      Object.values(sections).forEach((days) =>
        Object.values(days).forEach((arr) => arr.sort((a, b) => slotToMinutes(a.t) - slotToMinutes(b.t)))
      )
    )
  );

  return tt;
}

/* ══════════════════════════════════════════
   Vercel Handler
   ══════════════════════════════════════════ */

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const schoolParam = req.query?.school || "computing";
    const school = SCHOOLS[schoolParam];
    if (!school) {
      return res.status(400).json({ ok: false, error: `Unknown school '${schoolParam}'. Use: computing, engineering, business` });
    }

    const sheetId = getGoogleSheetId(school.id);
    const roomsMode = req.query?.rooms;

    if (roomsMode === "cd") {
      const computingId = getGoogleSheetId(SCHOOLS.computing.id);
      const { occupancy, count } = await fetchCDRoomOccupancyFromSheets(computingId);
      return res.status(200).json({
        ok: true, count, occupancy,
        updatedAt: new Date().toISOString(),
        source: "google-sheet-cd-rooms"
      });
    }

    const tabs = req.query?.sheet ? [req.query.sheet] : school.tabs;
    const uniqueTabs = [...new Set(tabs)];

    const sheets = [];
    for (const tab of uniqueTabs) {
      try {
        const grid = await loadSheetGrid(sheetId, tab);
        sheets.push({ name: tab, grid });
      } catch (err) {
        sheets.push({ name: tab, grid: [], error: err.message || String(err) });
      }
    }

    if (req.query?.raw) {
      return res.status(200).json({
        ok: true, school: schoolParam, tabs: uniqueTabs,
        sheets: sheets.map((s) => ({
          name: s.name, error: s.error,
          rows: s.grid.length,
          cols: Math.max(0, ...s.grid.map((r) => r.length)),
          preview: s.grid.slice(0, 35),
          samples: nonEmptySamples(s.grid, 50)
        }))
      });
    }

    const tt = buildTTForSchool(sheets, school);
    const refTT = legacyTTToReferenceTT(tt);
    const count = countReferenceEntries(refTT);

    if (!count) {
      return res.status(500).json({
        ok: false,
        error: `Parsed 0 classes for ${schoolParam}. Open /api/timetable?school=${schoolParam}&raw=1 to debug.`,
        diagnostics: sheets.map((s) => ({ name: s.name, error: s.error, rows: s.grid.length, cols: s.grid[0]?.length || 0 }))
      });
    }

    return res.status(200).json({
      ok: true, count, tt: refTT, school: schoolParam,
      updatedAt: new Date().toISOString(),
      source: `google-sheet-${schoolParam}`
    });
  } catch (err) {
    console.error('timetable API error:', err);
    return res.status(500).json({
      ok: false,
      error: 'Internal error',
      message: err?.message || String(err),
    });
  }
};
