"""
Audit db/timetables/engineering.json against the FSE spreadsheet.

Two sources of truth, both re-parsed here independently of
python/generate_timetable/schools/engineering.py:

  * "Classes Schedule FA26 (In Progress)" — where/when each class actually sits
  * "Course Allocation FA26"             — the real course list: which course
                                            belongs to which dept, batch and
                                            sections

Checks
  A  every JSON entry traces to a real schedule cell at its (day, room, time)
  B  every schedule cell reaches the JSON
  C  every JSON course is a real course on the Course Allocation tab
  D  dept / batch / section agree with that course's allocation row
  E  the time stored matches the time the sheet states
"""
import json, os, re, sys
from collections import defaultdict, Counter

CACHE, REPO = sys.argv[1], sys.argv[2]
SCHED = "engineering__Classes_Schedule_FA26__In_Progress_.json"
ALLOC = "engineering__Course_Allocation_FA26.json"

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})")
PROGS = {"EE", "CE"}


def one_line(v):
    return re.sub(r"\s+", " ", str(v or "").replace(" ", " ")).strip()


def tokens(name):
    n = str(name or "").lower().replace("&", " and ")
    return [t for t in re.split(r"[^a-z0-9]+", n) if t and t != "and"]


def key(name):
    return " ".join(tokens(name))


def load(fn):
    return json.load(open(os.path.join(CACHE, fn), encoding="utf-8"))["text"]


# --------------------------------------------------- Course Allocation tab

def parse_allocation(text):
    """
    Real courses, read from the allocation tab's own header row: a block header
    in the columns left of Code sets dept/batch, a course row carries the code,
    title and one instructor per section column.
    """
    hdr = code_col = title_col = None
    sec_cols = []
    for r, row in enumerate(text[:12]):
        cells = [one_line(c) for c in row]
        if "code" not in [c.lower() for c in cells]:
            continue
        code_col = [c.lower() for c in cells].index("code")
        title_col = next((i for i, c in enumerate(cells)
                          if i > code_col and c.lower().startswith("course")), None)
        if title_col is None:
            continue
        for i, c in enumerate(cells):
            m = re.match(r"^Section\s*-?\s*([A-Za-z])$", c, re.I)
            if i > title_col and m:
                sec_cols.append((i, m.group(1).upper()))
        hdr = r
        break
    if hdr is None:
        raise SystemExit("allocation tab: no Code/Course header row")

    recs = []
    dept = batch = None
    block_repeat = False
    semester = None
    for r in range(hdr + 1, len(text)):
        row = text[r]
        if not row:
            continue
        head = one_line(" ".join(one_line(row[i]) for i in range(min(code_col, len(row)))))
        if head:
            m_db = re.search(r"Batch\s+BS\s*\(\s*([A-Za-z]+)\s*\)\s+(\d{4})", head, re.I)
            m_ms = re.search(r"\bMS(?:\s*/\s*PhD)?\s*\(?\s*([A-Za-z]{2,3})\b\)?", head, re.I)
            m_yr = re.search(r"(?<!\d)(20\d{2})(?!\d)", head)
            m_bd = re.search(r"\bBS\s+([A-Za-z]{2,3})\b(?=.*Semester)", head, re.I)
            if m_db:
                dept, batch = m_db.group(1).upper(), m_db.group(2)
                block_repeat = bool(re.search(r"repeat", head, re.I))
            elif m_ms and m_ms.group(1).upper() in PROGS:
                dept, batch, block_repeat = m_ms.group(1).upper(), "MS", False
            elif m_bd:
                dept, batch, block_repeat = m_bd.group(1).upper(), None, False
            elif m_yr:
                batch = m_yr.group(1)
                block_repeat = bool(re.search(r"repeat", head, re.I))
            sem = re.search(r"(\d+)\w{2}\s+Semester", head, re.I)
            if sem:
                semester = sem.group(1)

        code = one_line(row[code_col] if len(row) > code_col else "")
        title = one_line(row[title_col] if len(row) > title_col else "")
        if not code or not title or title.lower() in ("course", "course/lab", "lab"):
            continue

        rep = re.search(r"\(([^)]*repeat[^)]*)\)", title, re.I)
        clean = one_line(title[:rep.start()] + title[rep.end():]) if rep else title
        also = []
        if rep:
            also = [t.upper() for t in re.findall(r"\b[A-Za-z]{2,4}\b", rep.group(1))
                    if t.upper() in PROGS]
        secs = [L for i, L in sec_cols if len(row) > i and one_line(row[i])]

        recs.append({"code": code, "title": clean, "raw_title": title, "key": key(clean),
                     "dept": dept, "batch": batch, "semester": semester,
                     "sections": secs, "row": r,
                     "is_repeat": block_repeat or (bool(rep) and not also),
                     "repeat_for": also})
    return recs


# ------------------------------------------------------------ schedule grid

def parse_title(raw):
    """
    Split a schedule cell into (course, programs, sections).

    The grid writes the cohort as a suffix: "Applied Calculus EE-A",
    "Civics ... CE-A, CE-B", "Under. of Holy Quran I & II A,B", "Signals CE/B".
    Multi-section cells are kept whole rather than dropped, so the audit can
    tell whether the generator kept them.
    """
    t = one_line(raw)
    if not t:
        return None
    if re.match(r"^(reserved|resrved|fsm|fse faculty|quiz|pf quiz|room)\b", t, re.I):
        return None
    # A batch the cell states for itself sits after the section suffix,
    # e.g. "Applied Physics A (Batch 2025)".
    batch_hint = None
    bm = re.search(r"\(\s*batch\s*(\d{4})\s*\)\s*$", t, re.I)
    if bm:
        batch_hint = bm.group(1)
        t = t[:bm.start()].strip()
    # Drop trailing instructor / time / venue noise that shares the cell.
    t = TIME_RE.sub(" ", t)
    t = re.sub(r"\(?\s*(?:main|d\s*block)\s+auditoriam[^)]*\)?", " ", t, flags=re.I)
    t = one_line(t)

    # Sections run A–E: the allocation lists five for the EE 2026 labs.
    m = re.search(
        r"^(?P<course>.*?)[\s]+(?P<suffix>((?:[A-Za-z]{2}[-/])?[A-E])"
        r"(?:\s*,\s*(?:[A-Za-z]{2}[-/])?[A-E])*)\s*"
        r"(?P<tail>(?:(?:Teacher|Instructor)\s*:|(?:Dr|Mr|Mrs|Ms|Engr|Prof)\b).*)?$",
        t)
    if not m:
        return None
    course = one_line(m.group("course"))
    if len(course) < 3:
        return None
    progs, secs = [], []
    for part in m.group("suffix").split(","):
        part = part.strip()
        pm = re.match(r"^(?:([A-Za-z]{2})[-/])?([A-E])$", part)
        if not pm:
            continue
        if pm.group(1):
            progs.append(pm.group(1).upper())
        secs.append(pm.group(2).upper())
    if not secs:
        return None
    return {"course": course, "programs": list(dict.fromkeys(progs)),
            "sections": list(dict.fromkeys(secs)), "batch_hint": batch_hint}


def norm_room(raw):
    r = one_line(raw).upper()
    return re.sub(r"\s*-\s*", "-", r)


def parse_schedule(text, problems):
    headers = []
    for r, row in enumerate(text):
        if not row or len(row) < 3:
            continue
        if one_line(row[2]).upper() in ("ROOM", "LABS"):
            slots = {}
            for c in range(3, len(row)):
                m = TIME_RE.match(one_line(row[c]))
                if m:
                    slots[c] = f"{m.group(1)}-{m.group(2)}"
            if len(slots) >= 3:
                headers.append((r, one_line(row[2]).upper() == "LABS", slots))

    row_day, cur = [None] * len(text), None
    for r, row in enumerate(text):
        if row:
            d = one_line(row[0]).capitalize()
            if d in DAYS:
                cur = d
        row_day[r] = cur

    cells = []
    for hi, (hrow, is_lab, slots) in enumerate(headers):
        end = headers[hi + 1][0] if hi + 1 < len(headers) else len(text)
        cols = sorted(slots)
        r = hrow + 1
        while r < end:
            row = text[r] if r < len(text) else []
            if not row:
                r += 1
                continue
            room_raw = one_line(row[2] if len(row) > 2 else "")
            if not room_raw:
                r += 1
                continue
            if re.search(r"reserved|resrved|^room$|^labs$", room_raw, re.I):
                r += 2
                continue
            instr = text[r + 1] if r + 1 < len(text) else []
            for si, sc in enumerate(cols):
                nxt = cols[si + 1] if si + 1 < len(cols) else len(row)
                band = [(c, one_line(row[c])) for c in range(sc, min(nxt, len(row)))
                        if c < len(row) and one_line(row[c])]
                for pos, (c, txt) in enumerate(band):
                    p = parse_title(txt)
                    it = one_line(instr[c]) if c < len(instr) else ""
                    ov = TIME_RE.search(txt) or TIME_RE.search(it)
                    cells.append({
                        "day": row_day[r], "room": norm_room(room_raw), "row": r, "col": c,
                        "slot_time": slots[sc],
                        "sheet_time": f"{ov.group(1)}-{ov.group(2)}" if ov else slots[sc],
                        "has_override": bool(ov),
                        "text": txt, "instructor": it, "is_lab": is_lab,
                        "course": p["course"] if p else None,
                        "programs": p["programs"] if p else [],
                        "sections": p["sections"] if p else [],
                        "parsed": bool(p),
                        "band_pos": pos, "band_size": len(band),
                    })
            r += 2
    return cells


# ------------------------------------------------------------------- match

def match_course(k, by_key, all_recs, sections=None):
    """Allocation rows for a schedule title. Exact key first, then the
    abbreviation the grid uses; ambiguity is reported, never guessed.

    The grid both drops words the allocation spells out ("MP Inter. & Prog"
    for "Microprocessor Interfacing & Programming") and adds words of its own
    ("Fund. Database Systems" for "Database Systems"), so the comparison has
    to tolerate a little of each — bounded, and only after the strict pass
    finds nothing usable.
    """
    if k in by_key:
        return by_key[k], "exact"
    gt = k.split()
    if not gt:
        return [], "empty"

    def sub(short, long):
        it = iter(long)
        return all(ch in it for ch in short)

    def tok_ok(g, c):
        if c.startswith(g) or (len(c) >= 4 and g.startswith(c)):
            return True
        if len(g) >= 3 and g[0] == c[0] and sub(g, c):
            return True
        # "mp" -> "microprocessor": a short stub against a long word only.
        return len(g) == 2 and len(c) >= 6 and g[0] == c[0] and sub(g, c)

    def matched_count(ct):
        """Longest in-order pairing of grid tokens to allocation tokens."""
        best = [0] * (len(ct) + 1)
        for g in gt:
            prev = 0
            for j, c in enumerate(ct, 1):
                carry = best[j]
                best[j] = prev + 1 if tok_ok(g, c) else max(best[j], best[j - 1])
                prev = carry
        return best[-1]

    def find(max_extra):
        out = []
        for ck, recs in by_key.items():
            n = matched_count(ck.split())
            if len(gt) - n <= max_extra and n >= min(2, len(gt)):
                out.append((ck, recs))
        return out

    def offers(hs):
        if not sections:
            return True
        return any(set(sections) <= set(r.get("sections") or [])
                   for _ck, recs in hs for r in recs)

    hits = find(0)
    # A word-for-word hit that doesn't run the cell's sections is the wrong
    # row — the MS block spells "Holy Quran I & II/Ethics I & II" exactly,
    # but only the 2025 block has a section B.
    if hits and not offers(hits):
        covering = [h for h in find(1) if offers([h])]
        if covering:
            hits = covering
    if not hits:
        hits = find(1)

    lab = "lab" in gt
    filtered = [h for h in hits if ("lab" in h[0].split()) == lab]
    if filtered:
        hits = filtered
    if len(hits) > 1:
        fewest = min(len(h[0].split()) for h in hits)
        hits = [h for h in hits if len(h[0].split()) == fewest]
    if len(hits) == 1:
        return hits[0][1], "abbreviated:" + hits[0][0]
    if len(hits) > 1:
        # Rows that agree on dept, batch and repeat status are two halves of
        # one class (SS1021 / SS1022), not a genuine ambiguity.
        merged, sigs = [], set()
        for _ck, recs in hits:
            for r in recs:
                sig = (r.get("dept"), r.get("batch"), r.get("is_repeat"))
                sigs.add(sig)
                if sig not in {(m.get("dept"), m.get("batch"), m.get("is_repeat"))
                               for m in merged}:
                    merged.append(r)
        if len(sigs) == 1:
            return merged, "abbreviated:" + hits[0][0]
        return [], "ambiguous:" + "|".join(h[0] for h in hits)
    return [], "no-match"


def main():
    problems = []
    alloc = parse_allocation(load(ALLOC))
    by_key = defaultdict(list)
    for a in alloc:
        by_key[a["key"]].append(a)

    cells = parse_schedule(load(SCHED), problems)
    tt = json.load(open(os.path.join(REPO, "db/timetables/engineering.json"),
                        encoding="utf-8"))["tt"]
    entries = []
    for dept, bs in tt.items():
        for batch, ss in bs.items():
            for sec, ds in ss.items():
                for day, items in ds.items():
                    for it in items:
                        entries.append({"dept": dept, "batch": batch, "section": sec,
                                        "day": day, "course": it["name"],
                                        "room": it["location"], "time": it["time"]})

    by_coord = defaultdict(list)
    by_room = defaultdict(list)
    for c in cells:
        by_coord[(c["day"], c["room"], c["slot_time"])].append(c)
        by_coord[(c["day"], c["room"], c["sheet_time"])].append(c)
        by_room[(c["day"], c["room"])].append(c)

    res = {"counts": {"json": len(entries), "cells": len(cells),
                      "cells_parsed": sum(1 for c in cells if c["parsed"]),
                      "alloc_rows": len(alloc), "alloc_titles": len(by_key)},
           "problems": problems,
           "A_no_cell": [], "A_wrong_time": [],
           "B_unmatched_cells": [],
           "C_not_a_real_course": [], "C_ambiguous": [],
           "D_dept_mismatch": [], "D_batch_mismatch": [], "D_section_not_offered": [],
           "E_time_override_ignored": [],
           "alloc_never_scheduled": []}

    def pick(cand, e):
        k = key(e["course"])
        best, bs = None, 0
        for c in cand:
            if not c["parsed"]:
                continue
            s = 0
            if key(c["course"]) == k:
                s = 3
            elif key(c["course"]).startswith(k[:8]) or k.startswith(key(c["course"])[:8]):
                s = 1
            if not s:
                continue
            if e["section"] in c["sections"]:
                s += 4
            prog = e["dept"].split()[-1]
            if prog in c["programs"]:
                s += 2
            if s > bs:
                best, bs = c, s
        return best

    matched = set()
    for e in entries:
        cand = by_coord.get((e["day"], e["room"], e["time"]), [])
        hit = pick(cand, e)
        if not hit:
            other = pick(by_room.get((e["day"], e["room"]), []), e)
            if other:
                res["A_wrong_time"].append({**e, "cell": other["text"],
                                            "sheet_time": other["sheet_time"],
                                            "slot_time": other["slot_time"]})
                hit = other
            else:
                res["A_no_cell"].append({**e, "cells_here": [c["text"] for c in cand][:4]})
                continue
        matched.add((hit["row"], hit["col"]))

        if hit["has_override"] and hit["sheet_time"] != e["time"]:
            res["E_time_override_ignored"].append(
                {**e, "cell": hit["text"][:60], "sheet_time": hit["sheet_time"]})

        # C / D — against the real course list
        # The sections the CELL names, not just this entry's — a multi-section
        # cell is what tells the two "Holy Quran" allocation rows apart.
        recs, how = match_course(key(e["course"]), by_key, alloc,
                                 hit.get("sections") or [e["section"]])
        if how.startswith("ambiguous"):
            res["C_ambiguous"].append({**e, "candidates": how.split(":", 1)[1]})
            continue
        if not recs:
            res["C_not_a_real_course"].append({**e, "cell": hit["text"][:60]})
            continue

        prog = e["dept"].split()[-1]
        if prog not in PROGS and e["batch"] != "MS":
            res["D_dept_mismatch"].append(
                {**e, "why": f"'{e['dept']}' is not an FSE department",
                 "alloc": [f"{r['dept']} {r['batch']} {r['code']}" for r in recs]})
            continue

        same_dept = [r for r in recs if r["dept"] == prog] or \
                    [r for r in recs if r["dept"] is None]
        if not same_dept:
            res["D_dept_mismatch"].append(
                {**e, "matched_via": how, "cell": hit["text"][:60],
                 "alloc": [f"{r['dept']} {r['batch']} {r['code']} {r['raw_title']}" for r in recs]})
            continue

        exp_batches = {r["batch"] for r in same_dept}
        exp_repeat = any(r["is_repeat"] for r in same_dept) or \
                     any(prog in r["repeat_for"] for r in recs)
        if e["batch"] == "REPEAT":
            if not exp_repeat:
                res["D_batch_mismatch"].append(
                    {**e, "why": "filed as REPEAT but the allocation row is not a repeat",
                     "alloc": sorted(exp_batches)})
        elif e["batch"] not in exp_batches:
            res["D_batch_mismatch"].append(
                {**e, "matched_via": how, "cell": hit["text"][:60],
                 "alloc": sorted(b for b in exp_batches if b),
                 "codes": [r["code"] for r in same_dept]})
        else:
            offered = set()
            for r in same_dept:
                if r["batch"] == e["batch"]:
                    offered |= set(r["sections"])
            if offered and e["section"] not in offered:
                res["D_section_not_offered"].append(
                    {**e, "alloc_sections": sorted(offered),
                     "codes": [r["code"] for r in same_dept if r["batch"] == e["batch"]]})

    for c in cells:
        if (c["row"], c["col"]) in matched:
            continue
        res["B_unmatched_cells"].append({
            "day": c["day"], "room": c["room"], "time": c["slot_time"],
            "text": c["text"][:90], "parsed": c["parsed"], "is_lab": c["is_lab"],
            "sections": c["sections"], "programs": c["programs"],
            "band_pos": c["band_pos"], "band_size": c["band_size"]})

    scheduled = {key(c["course"]) for c in cells if c["parsed"]}
    for a in alloc:
        recs, how = match_course(a["key"], {k: v for k, v in by_key.items()}, alloc)
        hit = a["key"] in scheduled or any(
            match_course(s, by_key, alloc)[0] and a in match_course(s, by_key, alloc)[0]
            for s in scheduled)
        if not hit:
            res["alloc_never_scheduled"].append(
                f"{a['raw_title']} [{a['dept']} {a['batch']} {a['code']}]")

    json.dump(res, open(os.path.join(CACHE, "audit_engineering.json"), "w",
                        encoding="utf-8"), indent=1, default=str)
    print(f"JSON entries {len(entries)} | schedule cells {len(cells)} "
          f"({res['counts']['cells_parsed']} parsed) | allocation rows {len(alloc)}")
    for k in ["problems", "A_no_cell", "A_wrong_time", "B_unmatched_cells",
              "C_not_a_real_course", "C_ambiguous", "D_dept_mismatch",
              "D_batch_mismatch", "D_section_not_offered",
              "E_time_override_ignored", "alloc_never_scheduled"]:
        print(f"{k:26s}: {len(res[k])}")


main()
