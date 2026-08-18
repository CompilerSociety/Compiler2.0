# Handoff: VTable Desktop Redesign

## Overview

A full redesign of the VTable desktop website (vtable.site) — the FAST NUCES Islamabad student utility that surfaces class timetables, free rooms, faculty offices, exam date sheets, exam seating and show-up schedules from the registrar's live sheets, plus a hidden arcade easter egg.

The redesign replaces the current landing pattern (a header block + six large nav cards stacked above the tool panels) with a **slim sticky top nav and full-width content**. It keeps the existing product's palette, voice and philosophy; the change is structural, not a rebrand.

Three product rules drive the new structure:

1. **Nothing is gated.** Every tool is fully usable signed out. Signing in only remembers which section you belong to.
2. **Sign-in is an onboarding page, not a modal.** One roll-number field; a secondary path for students whose roll number can't be decoded.
3. **Signed-in users get a Dashboard**, separate from the guest home page. A returning user with a saved profile never sees the guest landing.

Source repo: `Riftwalker23x/Compiler2.0`, branch `main`, web app under `web/`.

## About the Design Files

The file in this bundle — `VTable Desktop.dc.html` — is a **design reference created in HTML**. It is a prototype that shows intended look, layout, copy and behavior. It is **not production code to copy directly**.

It is authored in a proprietary component format ("Design Component"): a template of inline-styled markup with `{{ }}` value holes and `<sc-if>` / `<sc-for>` control tags, driven by a `class Component` logic class, both mounted by the bundled `support.js` runtime. **Do not try to port that runtime or its tags.** Read it the way you would read a Figma file: for structure, exact values, copy and behavior.

The task is to **recreate this design in the VTable codebase's existing environment** — `web/` is plain HTML component partials + vanilla JS (`web/js/app.js`, `web/js/main.js`) + a single large stylesheet (`web/css/main.css`), with a component-fetch bootstrap in `web/js/main.js` and CSS custom properties already used for theming. Follow those established patterns: new/updated partials under `web/components/`, styles as classes in `web/css/main.css` (the prototype uses inline styles only because of its authoring format — **do not ship inline styles**; convert them to classes on the existing token system), and behavior wired into the existing app runtime. Real data comes from the existing endpoints and `db/` JSON — everything in the prototype is placeholder content.

To view the prototype: open `VTable Desktop.dc.html` in a browser with `support.js` beside it.

## Fidelity

**High fidelity.** Colors, typography, spacing, radii, motion and copy are final and specified exactly below. Recreate the UI pixel-perfectly using the codebase's own CSS and patterns.

The only deliberately loose parts: all timetable/room/faculty/exam/seating rows are placeholder data, and the arcade games are simplified re-implementations for demonstration — **the real games already exist in `web/js/app.js` (Compiler Run, Duck Hunter, Flappy Byte) and must be kept as-is**; only their surrounding chrome is redesigned.

---

## Design Tokens

Defined once as CSS custom properties on `:root`, overridden under `:root[data-theme="dark"]`. The existing site already themes this way (`web/index.html` sets `data-theme` before paint from `localStorage.theme`) — extend that, don't replace it.

### Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f2f6f0` | `#0f1a0d` | Page ground |
| `--bg-top` | `#ffffff` | `#182714` | Top stop of the page radial gradient |
| `--nav-bg` | `rgba(255,255,255,.9)` | `rgba(15,26,13,.9)` | Sticky nav (with `backdrop-filter: blur(14px)`) |
| `--surface` | `#ffffff` | `#1b2818` | Cards, filter bars, tables |
| `--surface2` | `#fbfdfa` | `#182415` | Recessed surfaces, inputs, side panels |
| `--panel` | `#16210f` | `#0a1206` | Dark feature panels (next-paper card, rooms status bar, arcade, toast) |
| `--tint` | `#edf5eb` | `#223a1f` | Green tint fill: active nav pill, selected rows, leadership cards |
| `--chip` | `#eef1ec` | `#25331f` | Neutral chip / inactive room pill |
| `--t1` | `#16210f` | `#e9f2e5` | Primary text |
| `--t2` | `rgba(22,33,15,.62)` | `rgba(233,242,229,.64)` | Secondary text |
| `--t3` | `rgba(22,33,15,.46)` | `rgba(233,242,229,.46)` | Tertiary text, labels, kickers |
| `--line` | `rgba(22,33,15,.09)` | `rgba(233,242,229,.1)` | Card borders, row rules |
| `--line2` | `rgba(22,33,15,.14)` | `rgba(233,242,229,.18)` | Input / control borders |
| `--green` | `#2f6b31` | `#3f8c41` | Primary action fill, brand mark, "on campus" days |
| `--green-text` | `#2f6b31` | `#8fc78d` | Green text on the page ground |
| `--green-ink` | `#1f4a22` | `#a9d8a5` | Text on green tint, hover of primary |
| `--green-line` | `rgba(47,107,49,.45)` | `rgba(143,199,141,.42)` | Green borders (active card, dashed gap row) |
| `--green-line-soft` | `rgba(47,107,49,.22)` | `rgba(143,199,141,.26)` | Soft green borders, primary button shadow |
| `--slot-on` | `#7fb87d` | `#6fae6d` | Free slot in the rooms grid |
| `--slot-off` | `#dfe3dc` | `#2c3a27` | Booked slot; off state of a toggle track |
| `--seat-mine` | `#cfe6cb` | `#34532f` | "Your section" seats |
| `--av2` | `#dcebd9` | `#2a3f26` | Alternating faculty avatar fill |

Fixed (not themed): white `#ffffff` for text on green/dark fills; `#8fc78d` for accents inside dark panels in both themes; `#b3261e` for error text; `#ffd8a3` on `rgba(255,180,80,.12)` with `rgba(255,180,80,.35)` border for the arcade "coming soon" note.

### Typography

Two families, loaded from Google Fonts:

- `--font-mono`: **DM Mono** 400/500 — every number, time, room code, roll number, kicker, label, page title and section heading. This is the design's voice.
- `--font-body`: **Figtree** 400/500/600/700/800 — sentences, card titles, buttons that read as words, table cell names.

Scale as used (all `font:` shorthand values from the prototype):

| Role | Value |
| --- | --- |
| Hero H1 | `500 68px/1.02 'DM Mono'`, `letter-spacing:-.035em` |
| Page H1 (tool screens) | `500 40px/1.05 'DM Mono'`, `-.03em` |
| Onboarding H1 | `500 42px/1.05 'DM Mono'`, `-.03em`; manual form `500 38px/1.08` |
| Dark panel figure ("2 days") | `500 46px/1 'DM Mono'`, `-.03em` (dashboard variant 38px) |
| Panel heading | `500 24–27px/1.15–1.2 'DM Mono'`, `-.02em` |
| Card title | `700 15–19px/1.25–1.35 'Figtree'`, `-.01em` |
| Body copy | `16–17.5px/1.55 Figtree`, color `--t2`, `text-wrap: pretty` |
| Kicker / label | `500 10–11px/1 'DM Mono'`, `letter-spacing .13–.16em`, `text-transform: uppercase`, color `--t3` |
| Data cell (time, room, score) | `500 13–19px/1 'DM Mono'` |
| Nav item | `600 13.5px Figtree`; active `700` |
| Button label | `500 13–15px 'DM Mono'`, `letter-spacing .04em` (primary) or `600 14px Figtree` (secondary/ghost) |
| Footer / helper | `12.5–13px Figtree`, color `--t3` |

Brand mark: the word `VTABLE` in `500 13.5px 'DM Mono'`, `letter-spacing .14em`, white on `--green`, `padding: 8px 14px`, `border-radius: 13px`. Beside it, two lines of `500 10.5px/1.35 'DM Mono'`, `.1em`, uppercase, `--t3`: "FAST NUCES / Islamabad".

### Spacing, radius, elevation

- Page container: `max-width: 1280px`, `padding: 0 30px`, centered. Nav inner bar the same width, `padding: 13px 30px`.
- Vertical rhythm: page header block `44px` top / `24px` bottom; home hero `78px 0 70px`; cards gap `10–18px`; filter bars `18px 22px` inner padding.
- Radii: pills and all buttons/inputs/selects `999px`; small tiles `16–18px`; cards `22–28px`; large panels/tables `30px`; hero side panel and arcade modal `34px`; brand mark `13px`.
- Control heights: nav pill `~38px`; select and small button `46px`; search field `50–52px`; primary CTA `56–58px`; toggle track `44×26px` with a `20px` knob.
- Shadows: only two — primary CTA `0 10px 24px var(--green-line-soft)`; hero green panel `0 18px 44px var(--green-line-soft)`; toast `0 14px 36px rgba(22,45,18,.35)`. Segmented-control thumb uses `0 1px 2px rgba(22,45,18,.14)`.
- Page background: `radial-gradient(90% 60% at 50% 0%, var(--bg-top) 0%, var(--bg) 70%)`.

### Motion

| Name | Definition | Used by |
| --- | --- | --- |
| `vtFade` | `from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none}` — run at `.28–.3s cubic-bezier(.22,1,.36,1)` | Every screen on mount; arcade modal at `.22s` |
| `vtPulse` | `0%,100%{box-shadow:0 0 0 0 rgba(47,107,49,.45)} 70%{box-shadow:0 0 0 9px rgba(47,107,49,0)}` — `2s infinite` | Live dots |
| `vtToast` | fade/slide in over 10%, hold to 86%, fade out — `2.4s cubic-bezier(.22,1,.36,1) forwards` | Toast |

Hover transitions are `.16s` on color/background/border and `.18s cubic-bezier(.22,1,.36,1)` on transform. Card hovers lift `translateY(-2px)` or `-3px`; the dashed "free window" row slides `translateX(4px)`; the primary CTA lifts `-2px`.

### Focus & states

`:focus-visible { outline: 2px solid var(--green-text); outline-offset: 2px; }` globally — never the browser default. Selects use a custom SVG chevron (`background-image`, `right 18px center`) with a light and a dark variant.

---

## Screens / Views

Ten screens live in one page, switched by a `screen` state value: `home`, `signin`, `manual`, `dashboard`, `timetable`, `rooms`, `faculty`, `exams`, `seating`, `showup`, `profile`. The arcade is an overlay on top of any of them.

### Chrome (all screens)

**Top nav** — sticky, `top: 0`, `z-index: 20`, `--nav-bg` + `backdrop-filter: blur(14px)`, bottom border `--line`. Three groups in one flex row, `gap: 22px`:

- **Left**: brand button (mark + campus lines). Single click → home (or dashboard if signed in). **Double click → opens the arcade.** `user-select: none`, `title="Double-click for something else"`. This replaces the current site's double-click-the-logo easter egg on `#header-logo` — keep the same trigger.
- **Center** (`flex: 1`, centered, wraps): tool pills — Timetable, Free rooms, Faculty, Exams, Seating, Show-up. When signed in, **Dashboard** is prepended. Pill: `padding: 9px 14px`, `border-radius: 999px`, transparent; active gets `background: --tint`, `color: --green-ink`, weight 700; hover `background: --tint`.
- **Right**: live clock `500 12.5px 'DM Mono'` in `--t3` reading `HH:MM · Tue 12 Aug` (ticks every 20s); a 38px circular theme toggle showing a sun in dark mode and a moon in light (Lucide-style, `stroke-width: 2.75`); then either a **Sign in** pill (`--green`, white, `height: 38px`) for guests, or an avatar chip for signed-in users — 30px green circle with initials + roll number in `500 12px 'DM Mono'`, in a `--surface` pill with `--line2` border, hover border `--green-line`; opens the profile screen.

**Footer** — inside the container, `margin-top: 52px`, `padding-top: 22px`, top border `--line`, `13px` `--t3`, space-between: the existing site's copy ("Live timetable, exam seat, room availability and faculty directory for FAST NUCES Islamabad.") on the left; on the right the "Timetable data source" Google Sheet link (`https://docs.google.com/spreadsheets/d/1vlTuotLw34fedME3gNQj09cZw-todVomxAiu5P1wZ6Q`, `target="_blank" rel="noopener noreferrer"`), a `·`, and "Synced 22 min ago" (bind to the existing `#footer-last-sync` value).

**Toast** — fixed, bottom `34px`, centered, `--panel` fill, white `500 13.5px 'DM Mono'`, `border-radius: 22px`, `padding: 16px 26px`, `vtToast` for 2.3s. Fired on: sign-in, section pinned, email copied, seat found, profile removed, disabled-notification tap.

### 1. Home (guest landing)

Two columns, `1.1fr .9fr`, `gap: 56px`, vertically centered, `padding: 78px 0 70px`.

**Left**: kicker "FALL 2026 · EVERY SCHOOL ON CAMPUS" → H1 "Stop wandering / FAST." (hard break) → body copy, `max-width: 530px`: *"Timetables, free rooms, faculty offices, exam seating and show-up days — pulled from the live sheets. Everything is open without an account; signing in just remembers your section."* → two buttons: primary **Open the timetable** (`--green`, 56px, shadow) and secondary **Sign in** (`--surface`, `--line2` border). Below, `13px` `--t3`: *"No account needed for any tool. Your profile stays on this device."*

If a signed-in user navigates back here, the secondary CTA becomes **Go to my dashboard** and the helper line becomes *"Signed in as 22i-1847 — your profile stays on this device."*

**Right**: green feature panel — `--green` fill, white text, `border-radius: 34px`, `padding: 30px`, shadow, `overflow: hidden`, with a decorative `190px` circle of `rgba(255,255,255,.1)` at `right:-48px; top:-56px`. Contents: pulsing dot + "RIGHT NOW ON CAMPUS"; `500 27px 'DM Mono'` "Slot 4 · 13:00–14:20"; three stats (Free rooms 23 / Blocks A–D / Synced 22m) as uppercase 10px labels over `500 20px 'DM Mono'` values; a `rgba(255,255,255,.2)` rule; then three tappable rows — *Free rooms near you* (23 open), *Exam date sheet & seat* (Next in 2 days), *Faculty offices & hours* (214 people) — each routing to its tool.

**There is no six-tool card grid.** It was removed deliberately: the top bar already carries those six destinations.

### 2. Sign in (onboarding)

Single column, `max-width: 560px`, centered, `padding: 78px 0 40px`.

Kicker "STEP 1 OF 1 · TAKES TEN SECONDS" → H1 "What's your roll number?" → copy: *"It decodes your school, program, batch and section, so nothing else needs filling in. Everything on VTable works without this — signing in only remembers where you belong."*

Card (`--surface`, `--line`, `radius 28px`, `padding: 26px`): label "NU ROLL NUMBER"; a 58px pill input on `--surface2` with `--line2` border (turns `#b3261e` on error), value in `500 18px 'DM Mono'` `letter-spacing .05em`, placeholder `22i-1234`, with a static `@nu.edu.pk` suffix in `--t3`; Enter submits. On error, a `500 13px` `#b3261e` line appears. Full-width primary **Continue** (56px). Under it, centered, a smaller ghost pill (`600 12.5px Figtree`, `--line2` border, hover `--tint`): **"Not a Computing (FSC) student? Enter details instead"**.

Below the card, a centered text button: **"Skip — browse without signing in"** → home.

### 3. Manual details (non-FSC and batch 2026)

Same column, `max-width: 620px`. Two variants of the same form, chosen by how it was reached:

- **Non-FSC**: kicker "OUTSIDE COMPUTING (FSC)", title "Tell us where you sit", copy: *"Only Computing roll numbers decode automatically. Give us the same three things we hold for FSC students and your section is remembered."*
- **Batch 2026** (roll number starting `26`): kicker "BATCH 2026 · NOT IN OUR SHEETS YET", title "We don't have your batch yet", copy: *"The 2026 timetables have not reached us from the registrar. Leave your details and VTable will remember your section — every tool still works in the meantime."* The typed roll number is pre-filled.

Card is a two-column grid (`1fr 1fr`, `gap: 16px`, `padding: 26px`, `radius 28px`): Roll number, Full name, Section, Program / department — each a 52px pill input on `--surface2` with a 10px uppercase mono label. Full-width primary **Save and continue** spans both columns. Below: two text buttons, "Back to roll number" and "Skip for now".

Validation: roll number, name and section are required; a missing one raises the toast *"Roll number, name and section are all needed"*.

### 4. Dashboard (signed in)

Header row: kicker = the profile line (`BS(CS) · 2022 · SECTION 6A`), H1 = "Good morning, {firstName}", right-aligned `500 12.5px 'DM Mono'` `--t3` date "Tuesday 12 August · week 6".

Body: `1fr 340px`, `gap: 18px`, `align-items: start`.

- **Left**: a small row — "TODAY · 6A" label and a "Full timetable ›" text link — then the day's class rows (same component as the timetable day view, described below).
- **Right**: the dark **next paper** card (`--panel`, white, `radius 28px`, `padding: 26px`): "NEXT PAPER IN" / `500 38px 'DM Mono'` "2 days" / "Computer Networks / Mon 17 Aug · 09:00 · C-301" / a full-width ghost button (48px, `rgba(255,255,255,.24)` border) "Seat R3 · C4 ›" → seating. Under it, three quick cards on `--surface2` (`radius 24px`, `padding: 20px 22px`, hover lift + green border): Free rooms → "23 open right now across A–D"; Show-up → "3 days on campus this week"; Faculty → "Offices and consultation hours".

### 5. Timetable

Header block: kicker "FALL 2026 · LIVE FROM THE SHEET", H1 "Class timetable", right-aligned note *"Any school, program, batch and section — the day you need or the whole week at once."*

**Filter bar** — one row, `--surface` card, `radius 26px`, `padding: 18px 22px`, wraps: five labelled selects (School, Program, Batch, Section, Day), each `height: 46px`, `min-width: 168px`, pill, `--surface2` fill. Then a spacer, then a **Day / Week** segmented control on `--tint` (`padding: 4px`, pill; active thumb `--surface` with the small shadow and weight 700).

Cascade rules (as on the current site): School drives Program. Batch options are `2022–2026` plus **"Repeat courses"** — selecting it swaps the Section select for a **Repeat course** select (the current site's `#repeat-course` behavior). Day includes Saturday. Selections persist per device.

**Day view** — `1fr 320px`:

- Class row: `--surface` card, `radius 26px`, `padding: 20px 24px`, flex, `gap: 22px`. A 104px time column (`500 18px 'DM Mono'` start over `13px` `--t3` end); a `--line2` left rule then the course name (`700 19px Figtree`) with the course code beneath in `500 13px 'DM Mono'` `--t2`; a room pill on the right (`--chip`, `500 15px 'DM Mono'`). Hover lifts 2px.
  - **The current class** gets `--tint` fill, `--green-line` border, and a green room pill with white text.
  - **Past classes** are `opacity: .55`.
  - **No instructor is shown anywhere** — the registrar sheets don't carry a reliable teacher-to-section mapping, so the design deliberately omits it.
- Gap row (free window): dashed `--green-line` border on `--tint`, `radius 22px`, `padding: 16px 24px` — a 118px mono time window, the label "Free window — 6 rooms open on C-2", and a "Find a room ›" affordance. Clicking it jumps to Free rooms pre-set to that block/floor.
- Side panel (`--surface2`, `radius 28px`, `padding: 24px`): "THIS SELECTION", the program · section in `500 22px 'DM Mono'`, then key/value rows (Program, Section or Course, Classes, First / last, Source) with mono uppercase keys and `600 14.5px Figtree` right-aligned values; a full-width tinted button **"Remember this section"**.

**Week view** — one card (`--surface`, `radius 30px`, `padding: 22px`) holding a grid of `88px repeat(5, 1fr)`, `gap: 10px`. Column headers are 16px-radius tiles showing the 3-letter day and a class count; the selected day's header is `--panel`/white, the rest `--tint`. Each row is a slot label (`12.5px` mono `--t3`) plus five cells: `min-height: 84px`, `radius 18px`, course name `700 13.5px Figtree` over room `500 12px 'DM Mono'`; cells in the selected day's column use `--tint` + `--green-line`; empty cells are `--surface2` with transparent text.

### 6. Free rooms

Header: kicker "RIGHT NOW ON CAMPUS", H1 "Free rooms".

**Status bar** — `--panel`, white, `radius 26px`, `padding: 20px 26px`: pulsing `#8fc78d` dot, "SLOT 4 · 13:00–14:20", the selected day + date, and the live clock right-aligned in `500 17px 'DM Mono'`.

**Controls row** — Block as four 88×62px tiles (`radius 22px`) each showing the letter in `500 19px 'DM Mono'` over a free count; selected tile is `--panel`/white. Floor as three pills (Ground / 1st floor / 2nd floor); selected is `--green`/white. A **Day** select (the current site's step 3). Right-aligned summary in `500 13px 'DM Mono'` `--green-text`: "9 of 12 free in slot 4".

**Availability table** — `--surface`, `radius 30px`, `padding: 8px 24px 22px`. Columns `120px 1fr 110px`: room name (`500 16px 'DM Mono'`), an 8-cell slot strip (each `flex: 1`, `height: 26px`, `radius 9px`, `--slot-on` free / `--slot-off` booked, `gap: 4px`), and a right-aligned status word ("Free" in `--green-ink`, "In class" in `--t3`). Header row carries the eight slot times (08:30, 10:00, 11:30, 13:00, 14:30, 16:00, 16:30, 17:20). Legend beneath, with the note "Eight teaching slots, 08:30 to 17:20."

### 7. Faculty directory

Header: kicker "ALL SCHOOLS · 214 PEOPLE", H1 "Faculty directory".

Layout `1fr 380px`, `gap: 18px`.

- **Search + filters**: a 50px pill search field (`--surface`, magnifier icon in `--t3`, placeholder "Name, department or office…") beside seven department chips (All, CS, AI, SE, DS, CY, SH); the selected chip is `--panel`/white.
- **Leadership strip**: two equal `--tint` cards (`radius 22px`, `--green-line-soft` border) — Head of school (HOS) and Head of department (HOD) — each with the role in 10px mono green-ink, the name in `700 15px Figtree`, and `room · email` in `500 12.5px 'DM Mono'` `--t2`. These mirror the current site's leadership directory; wire them to the same source and keep a copy-email affordance.
- **Result header**: "FACULTY DIRECTORY" label and an "N of M shown" count.
- **Grid**: two columns, `gap: 10px`. Each card (`--surface2`, `radius 24px`, `padding: 16px 18px`) is a 46px initials avatar (alternating `--chip`/`--av2` fills), name `700 15px Figtree` + title `12.5px` `--t2` (both ellipsised), and a room pill. The selected card takes `--tint` + `--green-line`. Empty state: *"No one by that name — try a surname or an office number."*
- **Detail panel** (sticky, `top: 92px`, `radius 30px`): a `--tint` head with a 76px avatar, name in `500 20px 'DM Mono'`, title; then Email / Office / Consultation hours / Department as label-over-value pairs; a full-width green **Copy email** button. No course list — the sheet doesn't reliably map faculty to courses.

### 8. Exam schedule

Header: kicker "SESSIONALS & FINALS · FALL 2026", H1 "Exam schedule".

Filter bar: Department and Batch selects, then a three-way segmented control **Sessional I / Sessional II / Finals** (matching the current site's S1/S2/Final badges).

Body `330px 1fr`:

- **Next-paper card**: `--panel`, `radius 30px`, `padding: 28px`, decorative `170px` circle in `--green-line-soft` bottom-right. "NEXT PAPER IN" / `500 46px 'DM Mono'` "2 days" / paper + date / rule / Room `C-301` and Seat `R3 · C4` (seat value in `#8fc78d`) / ghost button "Open seating plan".
- **Date sheet table**: `--surface`, `radius 30px`. Columns `76px 1fr 120px 110px 110px` = Date (day number in `500 19px 'DM Mono'` over the 3-letter month in 10px uppercase; the next paper's number is green), Paper (name `700 16px Figtree` + code `12.5px` `--t3`), Time, Room, Seat (a pill — `--tint`/`--green-ink` when assigned, `--chip`/`--t3` when "TBA"). A footer line gives the set summary, e.g. "5 papers · 17–26 Aug".

### 9. Seating plan

Header: kicker "PUBLISHED TWO DAYS BEFORE EACH PAPER", H1 "Seating plan".

Search row (`max-width: 640px`): a 56px pill field, placeholder "Full name or roll number — e.g. 22i-1847", plus a green **Find my seat** button. Result raises a toast: *"Found 22i-1847 — C-301, row 3, column 4"*.

Body `1fr 330px`:

- **Room map**: `--surface`, `radius 30px`, `padding: 28px 34px 30px`. A centered "FRONT · INVIGILATOR" caption with a 2px `--line2` underline; then five rows, each a row letter (22px, mono, `--t3`) and eight seats (`flex: 1`, `height: 56px`, `radius 16px`). Your seat is `--green` with white "YOU"; your section's seats are `--seat-mine`; others `--chip`. Legend beneath.
- **Assignment card**: `--tint`, `--green-line-soft` border, `radius 30px`: "YOUR ASSIGNMENT", the paper name in `500 24px 'DM Mono'`, then Paper / Reporting / Room / Seat (green) / Roll no rows, and the note *"Seating is published two days before each paper and matched against the exam sheet."*

### 10. Show-up schedule

Header: kicker "COMPUTING · WEEK OF 11 AUGUST", H1 "Show-up schedule".

Filter bar: Program, Batch, Section selects; right-aligned summary "3 days on campus · BS(CS) 6A".

Six equal day columns (`repeat(6, 1fr)`, `gap: 12px`, `min-height: 246px`, `radius 26px`, `padding: 22px 20px`). A day the section is due on campus is a solid `--green` card with white text and a `rgba(255,255,255,.22)` rule; other days are `--surface` with `--line`. Each shows the 3-letter day in `500 15px 'DM Mono'`, a status tag (On campus / Online / No classes), a rule, the day's classes as time-over-name pairs, and a bottom-aligned count. Caption beneath: *"Green days are the ones your section is due on campus — everything else runs online."*

### 11. Profile

Header: kicker "SAVED ON THIS DEVICE ONLY", H1 "Your profile", note *"Nothing here gates access — every tool on VTable works signed out."* Two equal columns, `max-width: 960px`.

- **Identity card**: `--tint` head with a 60px green avatar, name in `500 19px 'DM Mono'`, profile line; body lists NU ID / Section / Batch / Program / Source ("Decoded from roll number" or "Entered manually"); a full-width ghost **"Delete profile from this device"** which clears storage, returns to home and toasts *"Profile removed from this device"*.
- **Notifications**: the current site's five preferences — Class changes, Exam schedule, Show-up schedule, Seating plan, and Free-room digest (**disabled**, 50% opacity, tapping toasts "Free-room digest is not built yet"). Each row is a `--surface` card (`radius 22px`, `padding: 16px 18px`) with a bold label, a `12.5px` `--t2` help line, and a 44×26px pill toggle (`--green` on / `--slot-off` off; 20px white knob sliding `3px → 21px` over `.18s cubic-bezier(.22,1,.36,1)`). Footer note: *"Your profile is saved only on this device."*

### 12. Arcade (easter egg)

**Trigger: double-clicking the VTABLE brand mark.** No visible affordance beyond the tooltip; keep it undiscoverable. Escape closes it. This is the redesigned chrome for the existing `#game-picker` / `#cr-overlay` / `#dh-overlay` / `#fb-overlay` / `#chess-mode-picker` modals.

Full-screen scrim `rgba(6,12,4,.86)` + `blur(6px)`; modal `max-width: 820px`, `--panel` fill, `radius 34px`, `rgba(255,255,255,.12)` border. Head: kicker ("COMPILER SOCIETY", or "ARCADE · SECRET" while playing) in `#8fc78d`, title in `500 26px 'DM Mono'`, and a 42px circular close button.

- **Picker**: 2×2 grid of game cards (`rgba(255,255,255,.05)` on `rgba(255,255,255,.14)` border, `radius 24px`, hover lift + lighter fill): a 52px emoji tile, the game name in `500 15px 'DM Mono'` `.08em` `#8fc78d`, the description, and a right-aligned best score or "NEW" / "SOON". The four entries and their copy are unchanged from the live site: **COMPILER RUN** "Jump the virus, duck the AI" 🖥️; **DUCK HUNTER** "Shoot the ducks, don't miss" 🦆; **FLAPPY BYTE** "Tap to fly through the pipes" 🐦; **COMPILER CHESS** "Choose how to play" ♛.
- **Chess**: three stacked mode rows — 1V1 "Two players, one device" ♟️; PLAY WITH FRIEND "Invite a friend to a match" 🤝; VS COMPILER ENGINE "Play against the computer" 🤖. Any pick shows the amber coming-soon note; a "‹ All games" link returns.
- **Play**: a 720×220 canvas (`width: 100%`, `height: auto`) in a `radius 24px` frame on `#0c1508`. Before a run and after a game over, an overlay (`rgba(6,12,4,.72)`) shows a kicker, the state line ("Ready?" / "Game over · 128") and a `#8fc78d` **Start / Play again** button. Under the canvas: the control hint (uppercase mono, 60% opacity), the live score in `#8fc78d`, and the personal best. Under that, the leaderboard — rank / name / section / score in a `rgba(255,255,255,.12)` bordered card; the player's own row is highlighted `rgba(143,199,141,.16)` with a green score.

**Keep the real games.** `web/js/app.js` already implements Compiler Run, Duck Hunter and Flappy Byte against a 720×220 canvas with `setGameField()` refit hooks, plus the leaderboard client (`submitLeaderboardScore` / `fetchLeaderboard`, per-game JSON via `api/leaderboard.js`). Re-skin the surrounding modal to the spec above and leave the game loops, canvas IDs and leaderboard wiring untouched. The prototype's game code is a stand-in for demonstration only.

---

## Interactions & Behavior

### Routing and auth (the core change)

- Every screen is reachable with no profile. There is no gate, redirect or disabled control anywhere for a signed-out user.
- **On load**, if a saved profile exists in storage, restore it *and* land on `dashboard` — a returning user never sees the guest home page. Without a profile, land on `home`.
- The brand mark routes to `dashboard` when signed in, `home` when not.
- If a signed-in user reaches `home` deliberately, the secondary CTA reads "Go to my dashboard" and the helper line names their roll number.
- **Sign in** → `signin`. Submitting parses the roll number against `/^(\d{2})\s*[iIlL]\s*-?\s*(\d{4})$/`:
  - No match → inline error *"That does not look like a roll number — try the 22i-1234 shape."*, input border `#b3261e`.
  - Prefix `26` → `manual` in its batch-2026 variant, roll number pre-filled.
  - Otherwise → resolve the profile (school, program, batch, section) from the student records and go to `dashboard` with a toast. In production this is the existing `api/profile.py` / `db/students/<batch>.json` lookup; a roll number that resolves to a non-Computing school, or that isn't found, should fall through to the same `manual` form rather than failing.
- **"Not a Computing (FSC) student?"** → `manual` in its non-FSC variant.
- Saving from either manual variant stores the profile and goes to `dashboard`.
- Sign out ("Delete profile from this device") clears storage and returns to `home`.
- Every screen change scrolls to top (`behavior: 'smooth'`).

### Cross-links

- Timetable free-window row → Free rooms, pre-selecting block C, floor 2.
- Dashboard "Seat R3 · C4 ›" and the exams next-paper button → Seating plan.
- Home panel rows and dashboard quick cards → their tools.
- Faculty "Copy email" writes to the clipboard and toasts the address.

### Input behavior

- Roll-number field: Enter submits; typing clears the error state.
- Faculty search filters live across name, title and office; combined with the department chip (AND).
- All selects are controlled; changing School resets Program to that school's first option; choosing "Repeat courses" swaps Section for Repeat course.
- Theme toggle flips `data-theme` on `<html>` and persists to storage; the existing pre-paint script in `web/index.html` already reads it.

### Responsive

Desktop-first, designed at 1440×1000 and correct from ~1180px up (the `1280px` container plus `30px` gutters). Below the mobile breakpoint the existing `web/css/mobile.css` phone app takes over unchanged — **this redesign must not alter the phone view**.

---

## State Management

| Key | Shape | Notes |
| --- | --- | --- |
| `screen` | one of the 11 screen ids | Default `home`; `dashboard` when a profile is restored |
| `auth` | `{nuid, name, program, batch, section, school, source}` or `null` | Persisted at `vtable-desktop-profile`; `source` is `'roll'` or `'manual'` |
| `theme` | `'light' \| 'dark'` | Persisted; applied as `data-theme` on `<html>` |
| `nuid`, `nuidError` | strings | Sign-in field and inline validation |
| `manualMode`, `manual` | `'other' \| 'batch26'`, `{nuid,name,section,program}` | Manual onboarding |
| `tt` | `{school, program, batch, section, day}` | Timetable filters; persist per device |
| `ttView` | `'day' \| 'week'` | |
| `block`, `floor`, `roomDay` | `'A'–'D'`, `0–2`, weekday | Free rooms |
| `q`, `dept`, `fac` | string, string, index | Faculty search, chip, selected person |
| `ex`, `examTab` | `{dept, batch}`, `'s1' \| 's2' \| 'final'` | Exams |
| `spq` | string | Seating search |
| `su` | `{program, batch, section}` | Show-up |
| `notifs` | `{cls, exam, show, seat, room}` booleans | `room` is permanently disabled |
| `arcade`, `arView`, `arGame`, `arScore`, `arBest`, `arLive`, `arOver`, `soon` | overlay open, `'pick' \| 'chess' \| 'play'`, game id, numbers, flags, string | Best scores persist per game |
| `toast`, `clock` | string, `HH:MM` | Toast auto-clears after 2.3s; clock ticks every 20s |

**Data fetching** — all content in the prototype is placeholder. In production, bind to what already exists: `db/timetables/*.json` and `api/timetable.js` (timetable, free rooms), `db/faculty/data.json` (directory and leadership), `db/exams/*.json` (date sheets), `db/seating/plan.json` (seating), `db/showup/computing.json` (show-up), `db/students/*.json` + `api/profile.py` (roll-number lookup), `api/subscribe.js` (notification preferences), `api/leaderboard.js` (arcade). Each screen needs loading and empty states in the codebase's existing idiom — the prototype shows only the loaded state, except for the faculty empty message quoted above.

## Assets

- **Fonts**: DM Mono (400, 500) and Figtree (400–800), Google Fonts. The live site currently also loads VT323 / Share Tech Mono for the arcade — those are no longer used by this design; the arcade now uses DM Mono.
- **Icons**: Lucide, `stroke-width: 2.75` — search (magnifier), sun, moon, close (×), mail. Drawn inline as SVG in the prototype; use the codebase's icon approach.
- **Logo**: the prototype uses a typographic `VTABLE` mark instead of `web/assets/images/logo.png`. Either is fine — if you keep the image, preserve the double-click arcade trigger on it.
- **Emoji**: only inside the arcade game cards (🖥️ 🦆 🐦 ♛ ♟️ 🤝 🤖), matching the live site's picker.
- No photography or illustration.

## Files

- `VTable Desktop.dc.html` — the full desktop design (all 11 screens + arcade). The template is the markup; the `class Component` block at the bottom holds the data, state and behavior. Read both.
- `support.js` — the runtime that renders the file in a browser. Not part of the deliverable; do not port it.

Reference the live implementation alongside this: `web/index.html`, `web/components/*.html`, `web/modals/all-modals.html`, `web/js/app.js`, `web/js/main.js`, `web/css/main.css`.
