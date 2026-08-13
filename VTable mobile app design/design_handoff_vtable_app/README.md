# Handoff: VTable — FAST NUCES Islamabad timetable app

## Overview
VTable is a student-built timetable lookup app for FAST-NUCES Islamabad, run as a locally-installed
web app (PWA-style: plain HTML/CSS/JS, no native builds). It covers timetable lookup (own + anyone
else's), free rooms by block and floor, a faculty directory, exam schedule and seating plans, push
notifications and a show-up schedule. Built by Compiler Society.

## About the design files
`VTable App.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing
intended look and behaviour, not production code to copy. It is authored in a proprietary
component format (`<x-dc>` template + a logic class, mounted by `support.js`); do **not** try to ship
or port that runtime. Read it for structure, copy, colors and interaction, then **recreate the
screens in the target codebase** using its own patterns (the existing repo is
`Riftwalker23x/Compiler2.0` — vanilla HTML/CSS/JS served locally; keep it that way unless the team
decides otherwise). If you open the file directly in a browser it renders the full clickable
prototype — use that as the visual source of truth.

Where the prototype's data is hardcoded (courses, faculty, rooms, exams), the real app reads from
the live Google Sheet / existing data layer in the repo. Treat the shapes below as the contract.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and motion are final. Recreate pixel-accurately
at a 390 × 844 viewport; scale fluidly for other phone widths (the layout is a single column with
18px side padding — everything below is width-agnostic apart from that).

---

## Design tokens

### Color
| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#16210f` | Primary text, dark surfaces (rooms status bar, exam hero, arcade, toast) |
| `green` | `#2f6b31` | Primary accent: buttons, active chips, "now" banner, avatar |
| `green-deep` | `#1f4a22` | Pressed/hover of primary, text on green tints |
| `green-bright` | `#8fc78d` | Accents on dark surfaces (arcade CTA, live dot) |
| `tint` | `#edf5eb` | Green-tinted fills: segmented track, active tab pill, selected cards |
| `tint-hover` | `#e0eedd` | Hover of tinted fills |
| `surface` | `#fbfdfa` | Card / list-row background |
| `white` | `#ffffff` | App background, active segmented thumb, bottom bar |
| `page` | `#f2f6f0` | Page background outside the phone frame |
| `neutral` | `#eef1ec` | Neutral chips (course code pill, "other" seats) |
| `slot-free` | `#7fb87d` | Free slot bar in free-rooms |
| `slot-busy` | `#dfe3dc` | Booked slot bar |
| `seat-section` | `#cfe6cb` | "Your section" seats |
| Borders | `rgba(22,33,15,.09)` cards · `rgba(22,33,15,.14)` inputs/chips · `rgba(47,107,49,.35–.55)` green-tinted |
| Muted text | `rgba(22,33,15,.5)` labels · `rgba(22,33,15,.6–.65)` secondary body · `rgba(22,33,15,.45)` tertiary |

### Typography
Two families only — do not introduce a third.
- **DM Mono** (400/500) — screen titles, all numbers, room codes, times, uppercase labels, buttons,
  the wordmark, tab labels, status bar. This is the brand voice.
- **Figtree** (400/500/600/700) — sentence-case body copy, course names, faculty names, chips.

| Role | Spec |
| --- | --- |
| Wordmark (sign-in) | DM Mono 500 · 27px · letter-spacing .16em · white on green, 22px radius, 16/26 padding |
| Hero headline | DM Mono 500 · 38px / 1.08 · letter-spacing −.03em |
| Screen title | DM Mono 500 · 22px / 1 · letter-spacing −.01em |
| Screen kicker | DM Mono 500 · 11px · .1em · uppercase · muted |
| Section label | DM Mono 500 · 10.5px · .13em · uppercase · muted |
| Card title (course, faculty) | Figtree 700 · 15–16px / 1.25 |
| Body / secondary | Figtree 400–500 · 12.5–15.5px / 1.45–1.5 |
| Times, room codes | DM Mono 400–500 · 12–15px |
| Big numbers (countdown, score) | DM Mono 500 · 24–34px |
| Tab label | DM Mono 500/600 · 10.5px |

### Spacing, radius, elevation
- Screen padding: `0 18px 24px` (sign-in/onboarding `22–24px`, min-height 756px).
- Gaps: 9–10px between list rows, 12px between day cards, 16–22px between sections.
- Radii: pills/buttons/inputs `999px`; list rows `22–26px`; big cards `28–32px`; seat tiles `12px`;
  block tiles `26px`; phone screen `36px` inside a `46px` bezel with 11px padding.
- Shadows: primary button `0 10px 24px rgba(47,107,49,.26)`; "now" banner `0 14px 30px rgba(47,107,49,.24)`;
  active segmented thumb `0 1px 2px rgba(22,45,18,.14)`; toast `0 12px 32px rgba(22,45,18,.35)`.

### Motion
| Name | Keyframes | Where |
| --- | --- | --- |
| `vtSlide` | opacity 0 → 1, translateX 28px → 0 | forward screen change, .3s `cubic-bezier(.22,1,.36,1)` |
| `vtBack` | same from −28px | back navigation |
| `vtFade` | opacity 0 → 1, translateY 14px → 0 | progressive reveals (floor list, room list, lookup results) |
| `vtPulse` | expanding `box-shadow` ring, 2s infinite | live dots |
| `vtPop` | scale .7 → 1 | arcade target tile, .18s |
| `vtToast` | in 12%, hold, out | toast, 2.4s forwards |
| `vtSpin` | rotate 360° | sign-in spinner, .7s linear infinite |
Hover: buttons/cards `translateY(-2px)` or `translateX(3px)` over .16–.18s `cubic-bezier(.22,1,.36,1)`;
primary buttons also darken to `green-deep`. Focus: `outline: 2px solid #2f6b31; outline-offset: 2px`.

---

## Screens

### 1. Sign in
Full-bleed, `space-between` column. Top: green wordmark block, then the headline "Stop / wandering /
FAST." and a one-line promise. Bottom: label "YOUR NU ID", a 58px pill input (DM Mono 17px,
placeholder `22i-1234`) with a static `@nu.edu.pk` suffix, a 58px green "Continue" button, and
"Built with love by Compiler Society".
Behaviour: Continue sets a loading state (spinner + label "Checking…") for ~900ms, then goes to
onboarding. Real app: validate the NU ID format and authenticate.

### 2. Onboarding — auto (Computing) / manual (everyone else)
Kicker "READ FROM <roll no>", title "Got it — you're Computing.", copy explaining nothing needs
filling in. Then four read-only rows (label 66px wide, value, and a small green "source" token showing
which part of the roll number it came from): School → Computing (FSC); Program → BS Computer Science;
Batch → 2022 · 6th semester; Section → 6A.
A tinted footer button toggles to **manual mode** for schools whose data can't be derived: title
"Set it up yourself.", four chip groups — School (Computing FSC / Engineering FSE / Business FSM /
Sciences & Humanities), Program (dependent on school; picking a school clears the program), Batch
(2022–2025), Section (A–F). Selected chip = green fill, white text; unselected = surface fill,
`rgba(22,33,15,.14)` border.
"Open my timetable" validates all four in manual mode (toast "Fill all four fields" otherwise).

### 3. Today (home) — the primary screen
- Segmented control (Today / Week) in a `tint` track, 4px padding, 40px pills; active pill white
  with the small shadow.
- **"In class now" banner**: green card, 30px radius, decorative `150px` white-10% circle at
  `right:-40px; top:-40px`. Rows: pulsing dot + "IN CLASS NOW · ENDS 11:20"; course name DM Mono
  24px; three stat columns (Room / Time / Teacher) with uppercase 10px labels and DM Mono 18px values.
  **Double-click opens the Arcade** (easter egg — keep it undiscoverable, no visible affordance).
- Meta row: "TUESDAY · 5 CLASSES" left, the user's program·batch·section right in green.
- Class list, one row per slot: 58px time column (start 15px, end 12px muted), a 1px divider, then
  course name (Figtree 700 16px), teacher, and two pills — room (green fill when the class is now,
  else neutral) and course code. Past classes render at 55% opacity; the current class gets the
  `tint` background and a green border.
- **Gap rows** are a dashed green-bordered tinted button: clock icon, "Free until 13:00 — 6 rooms
  open in C", and a "Find one ›" action that jumps to Free rooms pre-filtered to that block/floor.

### 4. Week
Same segmented control. One card per weekday: header strip (day name DM Mono 15px, right-aligned
uppercase meta); today's card header is `ink` with white text, others are `tint`. Body lists
time / course / room-pill rows separated by 1px rules.

### 5. Lookup (anyone's timetable)
Five stacked fields, each: label row (uppercase label left, current value right — green when set,
`rgba(22,33,15,.35)` when "—") over a horizontally scrolling chip row. Fields: School, Program
(dependent), Batch, Section, Day (Mon–Fri).
Until all five are set, an empty state: dashed 28px-radius box, DM Mono 13px, "Pick a school, program,
batch, section and day to load a timetable."
When complete: an `ink` summary bar (program · batch · section · day) with a "SAVE" pill on the right
(pins the lookup; toast confirms), then class rows in the same shape as Today's rows minus the
"now" treatment. Real app: this is the existing web-version query against the live sheet.

### 6. Free rooms
- `ink` status bar: pulsing bright-green dot, "SLOT 4 · 13:00–14:20", live clock right.
- Step 01 — block: 4-column grid of 74px tiles (letter DM Mono 21px + "N free"); selected tile is `ink`.
- Step 02 — floor (revealed with `vtFade` after a block is picked): three pills — Ground / 1st floor /
  2nd floor; selected is green.
- Room list (revealed after a floor): per room a 58px name, an 8-segment slot bar (free `#7fb87d`,
  busy `#dfe3dc`, 9px tall, 3px gaps, pill ends), and a right-aligned uppercase status
  ("Free now" green / "Class" muted). Free rooms get the tint background + green border.
- Caption: "Each bar is the day's eight slots — green is free, grey is booked."

### 7. Faculty directory
52px pill search field (magnifier icon, placeholder "Name, course or office…") filtering on name,
title, office and courses. Below it a scrolling department chip row (All, CS, AI, SE, DS, CY, SH;
selected = `ink`). Rows: 46px circular initials avatar (alternating `#dcebd9`/`#eef1ec` fills),
name + title, office pill. Empty state: "No one by that name — try a surname or a course code."

### 8. Faculty detail
Back pill ("‹ Directory"), then a tinted 32px-radius header card: 82px avatar, name DM Mono 21px,
title. Two actions: a green "Copy email" button (copies, toast confirms) and a 54px square-ish
download/save icon button. Then four rows (Email / Office / Office hrs / Dept) and a wrapped chip
list "TEACHING THIS SEMESTER".

### 9. Exams
Segmented Schedule / Seating plan.
- **Schedule**: `ink` hero with a green decorative circle — "NEXT PAPER IN", "2 days", and the paper
  line. Then exam rows: 52×56 date block (green for the next paper, else tint), name, meta
  (time · room · seat), and a right tag pill (Sessional II tinted green / Final neutral).
- **Seating plan**: tinted summary (course · date, Room and Seat as DM Mono 26px, seat in green),
  then the room map — a "FRONT · INVIGILATOR" rule, five labelled rows of six square seat tiles
  (green "YOU", `#cfe6cb` same-section, `#eef1ec` other), and a three-item legend.

### 10. Notifications
List of rows: 38px circular initial badge (green for unread/urgent, `#dcebd9` otherwise), title,
body, relative time. Unread urgent rows use the tint background + green border. "Mark all as read"
outline button clears the header dot and toasts "All caught up".
Categories in use: class change, exam seating, show-up schedule, cancellation, product update.

### 11. Profile
Tinted identity card (64px avatar, name, roll · program · section). "NOTIFICATIONS" section with
four toggle rows (class changes, exam schedule, show-up schedule, free-room digest) — track 50×29px,
23px white thumb, green when on. "YOUR SECTION" row shows the current program·batch·section and
whether it was decoded or set manually; tapping returns to onboarding.

### 12. Arcade (hidden — "Room Rush")
Reached only by double-clicking the Today banner. Full dark (`ink`) screen: "ARCADE · SECRET" kicker,
"ROOM RUSH" title, close ✕. Three stat tiles (Score / Time / Best) on white-8% fills. A 3×3 grid of
square room tiles; one is the live target ("FREE", bright-green, `vtPop` in), the rest "BUSY".
20-second round on a 1s interval; correct tap +1 and moves the target, wrong tap −1 (floored at 0);
timer expiry ends the round and records the best. CTA cycles Start → Give up → Play again.

---

## Global chrome
- **Status bar** (prototype only — the real PWA uses the OS bar): 44px, clock left (DM Mono 13px),
  signal + battery glyphs right.
- **Header**: 23px screen title + uppercase kicker on the left; on the right a 42px bell button
  (10px green dot when unread) and a 42px green avatar button → profile. Hidden on sign-in,
  onboarding and arcade.
- **Bottom tab bar**: white, 1px top rule, five equal tabs — Today (calendar), Lookup (magnifier),
  Rooms (house), Faculty (person), Exams (document). Each is a 46×28 pill (tint when active) holding
  a 19px Lucide-style icon at stroke-width 2.5, with a DM Mono 10.5px label below (600 weight and
  `green-deep` when active, 500 and `rgba(22,33,15,.45)` otherwise). Today also covers Week; Faculty
  covers Faculty detail.
- **Toast**: fixed 20px from each side, 104px from the bottom, `ink` pill, DM Mono 13px, auto-dismiss
  at 2.3s.

## State
```
screen           'signin'|'onboard'|'today'|'week'|'lookup'|'rooms'|'faculty'|'facdetail'
                 |'exams'|'arcade'|'notifs'|'profile'
dir              'fwd'|'back'          // drives the slide direction
nuid, signingIn
manual           bool                  // manual onboarding vs roll-number decode
mSchool/mProgram/mBatch/mSection
lk               {school, program, batch, section, day}
block, floor     free-rooms drill-down
q, dept          faculty search + filter
fac              selected faculty member
examTab          'schedule'|'seating'
read             notifications read flag
prefs            {cls, exam, show, room}
toast, clock
arLive, arScore, arTime, arTarget, arBest
```
Navigation is a single `screen` value plus a direction flag — no router in the prototype. In the real
app, use hash routes so back/forward and deep links work (`#/lookup`, `#/faculty/hammad-majeed`, …).

## Data the real app needs
- **Roll-number decode** (Computing only): school, program, batch year and section derived from the
  NU ID; every other school falls back to manual selection. This asymmetry is deliberate — surface it
  in copy, don't hide it.
- **Timetable**: `{day, start, end, course, code, teacher, room, section, program, batch}`.
- **Rooms**: block → floor → room, with an 8-slot busy/free vector per day.
- **Faculty**: `{name, title, dept, office, email, officeHours, courses[]}`.
- **Exams**: `{date, time, course, room, seat: {row, col}, type}` + a seat map per room
  (rows × cols with occupant section).
- **Notifications**: `{type, title, body, timestamp, read}` + the four preference flags.

## Assets
No images. All icons are inline SVG in the Lucide style (stroke-width 2.5–2.75, round caps/joins) —
calendar, search, home, user, file-text, bell, mail, download, chevron-left, clock, info, x.
Fonts load from Google Fonts: `DM Mono` (400,500) and `Figtree` (400,500,600,700,800). For a locally
installed app, self-host both.

## Files
- `VTable App.dc.html` — the full interactive design (open in a browser to click through everything).
- `support.js` — the runtime that mounts the prototype. Reference only; not part of the deliverable.
