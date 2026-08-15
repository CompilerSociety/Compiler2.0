"""
Audit db/timetables/computing.json against the source spreadsheet.

Deliberately independent of python/generate_timetable: the grid is re-read
from the cached tabs with its own geometry detection, cell parsing and
colour->legend resolution, so agreement means two implementations agree
rather than one implementation restating itself.

Checks
  A  every JSON entry traces to a real sheet cell at its (day, room, time)
  B  every schedulable sheet cell reaches the JSON
  C  dept / section routing matches the department code written in the cell
  D  batch matches the legend that owns the cell's fill colour
  E  the time stored matches the time the cell itself states
"""
import json, os, re, sys
from collections import defaultdict, Counter

CACHE = sys.argv[1]
REPO = sys.argv[2]

# ---------------------------------------------------------------- sheet model

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

# Block geometry is read from each tab's own header row (see day_blocks) —
# never assumed. The generator hardcodes columns, so assuming them here would
# hide any tab whose columns have shifted.
GENERATOR_GEOMETRY = {
    "classroom-left":  {"room_col": 0,  "slots": [1, 6, 11, 16, 21, 26]},
    "classroom-right": {"room_col": 30, "slots": [31, 36]},
    "lab":             {"room_col": 0,  "slots": [1, 11, 21, 31]},
}

TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})")
# Course + (DEPT[/DEPT...][-SECTION][, YY | , Gp-N]) — written from the sheet's
# own convention rather than imported from config.CELL_RE.
CELL_RE = re.compile(
    r"^(?P<course>.+?)\s*\(\s*(?P<depts>[A-Za-z]{2,4}(?:\s*[/,]\s*[A-Za-z]{2,4})*)"
    r"(?:\s*-\s*(?P<section>[A-Za-z]+)(?P<sub>\d+)?)?"
    r"(?:\s*,\s*(?:Gp?\s*-\s*(?P<group>[IVX]+)|(?P<year>\d{2})))?\s*\)"
)
PROGRAMS = {"AI", "CS", "CY", "DS", "SE"}

# A parenthetical holding only a section letter (and maybe a year), e.g.
# "AP (A, 25)", "Web Comp (A)" — the department is not written in the cell.
SECTION_ONLY_CELL_RE = re.compile(
    r"^(?P<course>.+?)\s*\(\s*(?P<section>[A-H])(?P<sub>\d)?"
    r"(?:\s*,\s*(?P<year>\d{2}))?\s*\)\s*$")
# A cell that is only a course title — no parenthetical at all, e.g.
# "Fund of SPM", "Securing Cloud".
BARE_COURSE_CELL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9&/.,'’\- ]{2,}$")
NOT_A_CLASS_RE = re.compile(
    r"\b(?:reserved|reseved|resrved|tutorial|meeting|lunch|holiday|travel|admin)\b"
    r"|^(?:fsm|fsa|fcss|fyp|ee)$", re.IGNORECASE)
# Banners are letter-spaced in the sheet ("P R A Y E R  B R E A K").
BANNER_RE = re.compile(r"prayer|break", re.IGNORECASE)


def read_cell(t):
    """What one cell says about its course, department and section.

    Three forms, all of which the sheet uses and all of which the generator
    now keeps: the full "Course (DEPT-SECTION)", a section-only
    "Course (A, 25)", and a bare "Course".
    """
    blank = {"course": None, "depts": [], "section": "", "sub": None,
             "group": "", "year": None, "parsed": False}

    m = CELL_RE.match(t)
    if m:
        depts = [d.strip().upper() for d in
                 re.split(r"[/,]", m.group("depts")) if d.strip()]
        section = (m.group("section") or "").upper()
        # "UHQ-I & II (MS-SE)" names the degree first and the programme where
        # a section letter would go. The programme is the department, and the
        # cell names no section.
        if depts == ["MS"] and len(section) >= 2:
            depts, section = [section], ""
        return {
            "course": one_line(m.group("course")),
            "depts": depts,
            "section": section,
            "sub": m.group("sub"),
            "group": (m.group("group") or "").upper(),
            "year": m.group("year"),
            "parsed": True,
        }

    m = SECTION_ONLY_CELL_RE.match(t)
    if m and not TIME_RE.search(t):
        return {**blank, "course": one_line(m.group("course")),
                "section": m.group("section").upper(), "sub": m.group("sub"),
                "year": m.group("year"), "parsed": True}

    if (BARE_COURSE_CELL_RE.match(t) and not NOT_A_CLASS_RE.search(t)
            and not BANNER_RE.search(re.sub(r"\s+", "", t))):
        return {**blank, "course": one_line(t), "parsed": True}

    return blank


def one_line(v):
    return re.sub(r"\s+", " ", str(v or "").replace("\n", " ")).strip()


def norm_room(raw):
    r = one_line(raw).upper()
    r = re.sub(r"-{2,}", "-", r)
    r = re.sub(r"\b([A-D])\s+(\d{3})\b", r"\1-\2", r)
    m = re.match(r"([A-D])\s*-\s*(\d{3}|IT\s*LAB\s*\d+|MARGALA\s*\d*|RAWAL\s*\d*|"
                 r"GPU\s*LAB|MEHRAN\s*\d*|CALL-\d+|DIGITAL\b)", r)
    if m:
        return f"{m.group(1)}-{m.group(2).strip()}"
    # The sheet writes one room three ways — "C-Rawal 3", "Rawal 3 (GPU)",
    # "Rawal-3" — and only the first carries its block letter. Without this
    # they read as three different rooms, and every class in the other two
    # looked both missing from the JSON and invented in it.
    m = re.match(r"(MARGALA|RAWAL)\s*-?\s*(\d+)\b", r)
    if m:
        return f"C-{m.group(1)} {m.group(2)}"
    return r


def norm_course(name):
    """Comparison key for a course title, ignoring case/punctuation/spacing."""
    return re.sub(r"[^a-z0-9]+", " ", one_line(name).lower()).strip()


def is_white(c):
    return c is None or (c[0] >= 0.95 and c[1] >= 0.95 and c[2] >= 0.95)


# Fills the legend band labels as repeat/retake, e.g. "BS Repeat Courses".
# Read from the sheet rather than hardcoded: the audit was pinned to #FCFE58
# while the sheet painted #FFFF00, so it could not see the repeat bucket it
# was meant to check.
REPEAT_SWATCHES = set()


def is_yellow(c):
    if c is None:
        return False
    targets = ([tuple(v * 255 for v in s) for s in REPEAT_SWATCHES]
               or [(252, 254, 88)])
    return any(all(abs(v * 255 - t) <= 5 for v, t in zip(c, target))
               for target in targets)


def load_tab(day):
    p = os.path.join(CACHE, f"computing__{day}.json")
    d = json.load(open(p, encoding="utf-8"))
    return d["text"], [[tuple(c) if c else None for c in row] for row in d["colour"]]


# ------------------------------------------------------------- legend colours

def build_legend(all_tabs):
    """colour -> [(program|None, batch)], read from the legend band at the top
    of every tab. Mirrors the sheet, not colour_mapper.py."""
    legend = defaultdict(list)
    swatch_text = defaultdict(set)
    for day, (text, colour) in all_tabs.items():
        for r in range(min(10, len(text))):
            for c, cell in enumerate(text[r]):
                cell = one_line(cell)
                col = colour[r][c] if c < len(colour[r]) else None
                if not cell or is_white(col):
                    continue
                if not re.search(r"\b(BS|MS)\b", cell, re.I):
                    continue
                if re.search(r"\brepeat\b", cell, re.I):
                    REPEAT_SWATCHES.add(col)   # a fill, not a cohort
                    swatch_text[col].add(cell)
                    continue
                y = re.search(r"\b(20\d{2})\b", cell)
                if y:
                    m = re.search(r"\bBS\s+([A-Z]{2,3})\b", cell.upper())
                    entry = (m.group(1) if m else None, y.group(1))
                elif re.search(r"\bMS\b", cell) and "BS" not in cell.upper():
                    m = re.search(r"\bMS\s*\(\s*([A-Za-z]{2,3})\s*\)", cell)
                    entry = (m.group(1).upper() if m else None, "MS")
                else:
                    continue
                if entry not in legend[col]:
                    legend[col].append(entry)
                swatch_text[col].add(cell)
    return legend, swatch_text


def legend_batches(legend, colour, dept_codes):
    """Batches the legend allows for a cell of this fill and dept code."""
    if colour is None or is_white(colour):
        return None, "unpainted"
    entries = legend.get(colour)
    kind = "exact"
    if not entries:
        best, bd = None, None
        for sw, ent in legend.items():
            d = sum(abs(a - b) for a, b in zip(colour, sw))
            if all(abs(a - b) <= 0.03 for a, b in zip(colour, sw)) and (bd is None or d < bd):
                best, bd = ent, d
        entries, kind = best, "near"
    if not entries:
        return None, "unmapped"
    wanted = {d.upper() for d in dept_codes}
    scoped = [b for d, b in entries if d and d in wanted]
    if scoped:
        return set(scoped), kind + "/dept-scoped"
    return {b for _d, b in entries}, kind + ("/shared" if len(entries) > 1 else "")


# ------------------------------------------------------- ground-truth extract

def find_header_row(text):
    for r in range(min(len(text), 12)):
        if "room" in one_line(text[r][0] if text[r] else "").lower():
            times = sum(1 for c in range(len(text[r]))
                        if TIME_RE.match(one_line(text[r][c])))
            if times >= 4:
                return r
    return -1


def find_lab_row(text, after):
    for r in range(after, len(text)):
        a = one_line(text[r][0] if text[r] else "").lower()
        if "lab" in a:
            return r
        if len(text[r]) > 1 and re.match(r"^\d{1,2}:\d{2}-\d{1,2}:\d{2}$", one_line(text[r][1])):
            if sum(1 for c in text[r] if one_line(c)) <= 6:
                return r
    return -1


def header_slot_labels(text, row):
    """Actual {col: 'HH:MM-HH:MM'} from the header row itself."""
    out = {}
    for c in range(len(text[row])):
        m = TIME_RE.match(one_line(text[row][c]))
        if m:
            out[c] = f"{m.group(1)}-{m.group(2)}"
    return out


# A Room header, matched as a prefix rather than by equality — the sheet
# renamed the daytime header from "Room" to "Room/ Time" on all six day tabs
# and an equality test stops seeing the daytime block at all.
ROOM_HEADER_RE = re.compile(r"^rooms?\b", re.IGNORECASE)


def room_cols(text, row):
    return [c for c in range(len(text[row]))
            if ROOM_HEADER_RE.match(one_line(text[row][c]))]


def day_blocks(text, hr, lr, day, problems, variants):
    """
    Derive this tab's real block geometry from its header rows: each "Room"
    column opens a block, and the time labels to its right are that block's
    slots, each spanning up to the next label (or the next Room column).
    """
    blocks = []

    def add(name, header_row, rooms, start, stop):
        labels = header_slot_labels(text, header_row)
        cols = sorted(c for c in labels if start <= c < (stop if stop else 10 ** 6))
        bands = []
        for i, c in enumerate(cols):
            nxt = cols[i + 1] if i + 1 < len(cols) else stop
            bands.append({"col": c, "time": labels[c], "end": nxt})
        blocks.append({"name": name, "room_col": rooms, "bands": bands,
                       "header_row": header_row,
                       # The evening Room column is blank on every tab but
                       # Wednesday. Those classes are real and the generator
                       # emits them with an unknown room, so read them the
                       # same way rather than calling them invented.
                       "blank_room_ok": name == "classroom-right"})

    rc = room_cols(text, hr)
    if not rc:
        rc = [0]
    for i, r0 in enumerate(rc):
        nxt = rc[i + 1] if i + 1 < len(rc) else None
        add("classroom-left" if i == 0 else "classroom-right", hr, r0, r0 + 1, nxt)

    if lr > 0:
        lrc = room_cols(text, lr) or [0]
        for i, r0 in enumerate(lrc):
            nxt = lrc[i + 1] if i + 1 < len(lrc) else None
            add("lab", lr, r0, r0 + 1, nxt)

    # A tab whose columns differ from the common layout is not itself a fault
    # — the generator detects geometry per tab now, and Friday genuinely
    # differs. What IS a fault is a block with no readable slots at all,
    # because then neither side can know what a cell's time is.
    for blk in blocks:
        if not blk["bands"]:
            problems.append(
                f"{day}/{blk['name']}: no time labels found next to the Room "
                f"column at {blk['room_col']} — geometry unreadable")
            continue
        exp = GENERATOR_GEOMETRY.get(blk["name"])
        if not exp:
            continue
        got_rooms, got_slots = blk["room_col"], [b["col"] for b in blk["bands"]]
        if got_rooms != exp["room_col"] or got_slots != exp["slots"]:
            variants.append(
                f"{day}/{blk['name']}: room column {got_rooms}, time columns "
                f"{got_slots} (the common layout is {exp['room_col']} / {exp['slots']})")
    return blocks


def extract_day(day, text, colour, problems, variants):
    """Every schedulable cell in one day tab."""
    hr = find_header_row(text)
    if hr < 0:
        problems.append(f"{day}: no Room/time header row found")
        return []
    lr = find_lab_row(text, hr + 1)

    cells = []
    for blk in day_blocks(text, hr, lr, day, problems, variants):
        is_lab = blk["name"] == "lab"
        start = (lr + 1) if is_lab else (hr + 1)
        stop = len(text) if is_lab else (lr if lr > 0 else len(text))
        for r in range(start, min(stop, len(text))):
            row = text[r]
            if not row or len(row) <= blk["room_col"]:
                continue
            raw_room = one_line(row[blk["room_col"]])
            room = norm_room(raw_room)
            if not room and blk.get("blank_room_ok"):
                room = "TBA"
            elif (not room or len(room) < 2 or
                    re.search(r"reserved|tutorial|fsm|fsa|fcss|fyp|travel|admin|room",
                              room, re.I)):
                continue
            for band_def in blk["bands"]:
                sc = band_def["col"]
                end = min(band_def["end"], len(row)) if band_def["end"] else len(row)
                band = []
                for c in range(sc, end):
                    t = one_line(row[c] if c < len(row) else "")
                    if t:
                        band.append((c, t))
                if not band:
                    continue
                for pos, (c, t) in enumerate(band):
                    info = read_cell(t)
                    inline = TIME_RE.search(t)
                    cells.append({
                        "day": day, "block": blk["name"], "row": r, "col": c,
                        "room": room, "raw_room": raw_room,
                        "slot_time": band_def["time"],
                        "inline_time": f"{inline.group(1)}-{inline.group(2)}" if inline else None,
                        "text": t,
                        **info,
                        "colour": colour[r][c] if r < len(colour) and c < len(colour[r]) else None,
                        "band_pos": pos, "band_size": len(band),
                    })
    return cells


# --------------------------------------------------------------------- audit

def main():
    tabs = {d: load_tab(d) for d in DAYS}
    problems = []
    variants = []
    legend, swatch_text = build_legend(tabs)

    cells = []
    for d in DAYS:
        cells.extend(extract_day(d, tabs[d][0], tabs[d][1], problems, variants))

    tt = json.load(open(os.path.join(REPO, "db/timetables/computing.json"),
                        encoding="utf-8"))["tt"]

    # Flatten JSON
    entries = []
    for dept, batches in tt.items():
        for batch, secs in batches.items():
            for sec, days in secs.items():
                for day, items in days.items():
                    for it in items:
                        entries.append({
                            "dept": dept, "batch": batch, "section": sec, "day": day,
                            "course": it["name"], "room": it["location"], "time": it["time"],
                        })

    # index sheet cells by (day, room, time) and by (day, room)
    by_coord = defaultdict(list)
    by_room = defaultdict(list)
    for c in cells:
        by_coord[(c["day"], c["room"], c["slot_time"])].append(c)
        # A cell that states its own time is legitimately stored at that time
        # rather than its column's. Indexing only by the column slot reported
        # all 134 of them as mis-timed, which would bury a real one.
        if c["inline_time"] and c["inline_time"] != c["slot_time"]:
            by_coord[(c["day"], c["room"], c["inline_time"])].append(c)
        by_room[(c["day"], c["room"])].append(c)

    res = {
        "counts": {"json_entries": len(entries), "sheet_cells": len(cells),
                   "sheet_cells_parsed": sum(1 for c in cells if c["parsed"])},
        "geometry_problems": problems,
        "geometry_variants": variants,
        "A_no_cell_at_coord": [], "A_course_mismatch": [], "A_wrong_time": [],
        "B_unmatched_cells": [],
        "C_dept_mismatch": [], "C_section_mismatch": [],
        "D_batch_mismatch": [], "D_unmapped_colour": [],
        "E_time_override_ignored": [],
        "F_multi_cell_band": [],
        "legend": {str(k): v for k, v in legend.items()},
    }

    # ---- A + C + D: every JSON entry back to a cell
    matched_cells = set()
    # strip the "(A1)" subgroup label the generator appends
    def find_hit(cand, base, e):
        """Best cell for a JSON entry: same course, preferring the one whose
        section and dept code also line up, so a mis-timed entry isn't
        mismatched onto a sibling section's cell."""
        prog = re.sub(r"^(BS|MS)\s*", "", e["dept"]).strip("() ").upper()
        sec = e["section"].upper()

        def score(c):
            if not c["parsed"]:
                return -1
            exact = norm_course(c["course"]) == norm_course(base)
            if not exact and not norm_course(base).startswith(norm_course(c["course"])[:6]):
                return -1
            s = 1 if exact else 0
            cell_sec = c["section"] or (f"G-{c['group']}" if c["group"] else "")
            if cell_sec and cell_sec == sec:
                s += 4
            elif not cell_sec and sec == "A":
                s += 1
            # The department the cell names weighs as much as the section, and
            # naming a different one counts against. Every roomless evening
            # class shares the coordinate (day, "TBA", time), so several
            # unrelated cells compete for one entry and the department is
            # usually the only thing that separates them.
            if prog in c["depts"]:
                s += 4
            elif c["depts"]:
                s -= 2
            return s

        best, bs = None, 0
        for c in cand:
            v = score(c)
            if v > bs:
                best, bs = c, v
        return best

    for e in entries:
        base = re.sub(r"\s*\([A-Za-z]?\d\)\s*$", "", e["course"])
        cand = by_coord.get((e["day"], e["room"], e["time"]), [])
        hit = find_hit(cand, base, e)
        if not hit:
            # Same room, some other time? Then the entry is real but mis-timed.
            elsewhere = find_hit(by_room.get((e["day"], e["room"]), []), base, e)
            if elsewhere:
                res["A_wrong_time"].append(
                    {**e, "cell": elsewhere["text"], "sheet_time": elsewhere["slot_time"],
                     "sheet_col": elsewhere["col"], "block": elsewhere["block"]})
                hit = elsewhere
            elif not cand:
                res["A_no_cell_at_coord"].append(e)
                continue
            else:
                res["A_course_mismatch"].append(
                    {**e, "cells_at_coord": [c["text"] for c in cand]})
                continue
        matched_cells.add((hit["day"], hit["row"], hit["col"]))

        # C — dept routing
        prog = re.sub(r"^(BS|MS)\s*", "", e["dept"]).strip("() ").upper()
        if hit["depts"] and prog not in hit["depts"] and prog != "REPEAT":
            res["C_dept_mismatch"].append(
                {**e, "cell": hit["text"], "cell_depts": hit["depts"]})

        # C — section routing
        exp = hit["section"] or (f"G-{hit['group']}" if hit["group"] else "")
        if hit["sub"]:
            exp = exp  # subgroup lives in the course label, section unchanged
        if exp and e["section"].upper() != exp:
            res["C_section_mismatch"].append({**e, "cell": hit["text"], "cell_section": exp})
        elif not exp and e["section"] not in ("A", "ALL"):
            # A cell naming no section belongs to the whole batch. "ALL" is
            # the key the generator stores that under and the frontend merges
            # into whichever section the student picks; "A" is the older
            # single-section form. Anything else claims a section the sheet
            # never wrote.
            res["C_section_mismatch"].append(
                {**e, "cell": hit["text"], "cell_section": "(none — defaulted)"})

        # D — batch vs legend colour
        if e["batch"] == "REPEAT":
            if not is_yellow(hit["colour"]):
                res["D_batch_mismatch"].append(
                    {**e, "cell": hit["text"], "why": "filed REPEAT but fill is not the repeat yellow",
                     "colour": hit["colour"]})
        elif is_yellow(hit["colour"]):
            res["D_batch_mismatch"].append(
                {**e, "cell": hit["text"], "why": "repeat-yellow fill but filed under a normal batch",
                 "colour": hit["colour"]})
        elif hit["year"]:
            expect = "20" + hit["year"]
            if e["batch"] != expect:
                res["D_batch_mismatch"].append(
                    {**e, "cell": hit["text"], "why": f"cell text states batch {expect}"})
        else:
            allowed, kind = legend_batches(legend, hit["colour"], hit["depts"])
            if allowed is None:
                res["D_unmapped_colour"].append(
                    {**e, "cell": hit["text"], "colour": hit["colour"], "why": kind})
            elif e["batch"] not in allowed:
                res["D_batch_mismatch"].append(
                    {**e, "cell": hit["text"], "colour": hit["colour"],
                     "why": f"legend fill allows {sorted(allowed)} ({kind})"})

        # E — inline time override
        if hit["inline_time"] and hit["inline_time"] != e["time"]:
            res["E_time_override_ignored"].append(
                {**e, "cell": hit["text"], "cell_time": hit["inline_time"]})

    # ---- B: every sheet cell into the JSON
    for c in cells:
        if (c["day"], c["row"], c["col"]) in matched_cells:
            continue
        res["B_unmatched_cells"].append({
            "day": c["day"], "room": c["room"], "time": c["slot_time"],
            "block": c["block"], "text": c["text"], "parsed": c["parsed"],
            "depts": c["depts"], "section": c["section"],
            "colour": c["colour"], "band_pos": c["band_pos"], "band_size": c["band_size"],
            "row": c["row"], "col": c["col"],
        })
        if c["band_size"] > 1 and c["parsed"]:
            res["F_multi_cell_band"].append({
                "day": c["day"], "room": c["room"], "time": c["slot_time"],
                "text": c["text"], "band_size": c["band_size"], "band_pos": c["band_pos"]})

    json.dump(res, open(os.path.join(CACHE, "audit_computing.json"), "w", encoding="utf-8"),
              indent=1, default=str)

    print(f"JSON entries      : {len(entries)}")
    print(f"sheet cells       : {len(cells)} ({res['counts']['sheet_cells_parsed']} parseable)")
    for k in ["geometry_problems", "geometry_variants", "A_no_cell_at_coord", "A_course_mismatch", "A_wrong_time",
              "B_unmatched_cells", "C_dept_mismatch", "C_section_mismatch",
              "D_batch_mismatch", "D_unmapped_colour", "E_time_override_ignored",
              "F_multi_cell_band"]:
        print(f"{k:28s}: {len(res[k])}")


main()
