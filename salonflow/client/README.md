# SalonFlow — Frontend (Phase 1: Dashboard + Appointments)

React + TypeScript + Vite, consuming the SalonFlow REST API built in the
backend phases. This is the first frontend milestone: the Dashboard and
Appointments pages, fully wired to the real API — not mockups.

## Why these two pages first

Per the master spec's page architecture (section 3): **Dashboard** provides
the high-level operational overview, **Appointments** manages the
appointment record and lifecycle. Every other page (Calendar, Clients,
Services, Staff, Payments, Reports, Settings) is in the nav as a
"Coming soon" placeholder so the app's structure is visible end-to-end,
but only these two have real content — consistent with the backend-first,
one-layer-at-a-time discipline this whole project has followed.

## Design decisions

Read `/mnt/skills/public/frontend-design/SKILL.md`'s guidance before
building this — the brief below is the result.

- **This is daily-use operational software, not a marketing site.** A
  persistent sidebar + topbar app shell is the right call for something a
  salon owner opens dozens of times a day — novelty here would cost
  usability, not add to it.
- **Color**: warm ink (`#221C1A`) on warm ivory (`#FBF8F4`), brass/amber
  accent (`#C98A2C`) and deep teal (`#2F4A43`) — grounded in a salon's
  actual materials (brass fixtures, velvet chairs) rather than the default
  cream+terracotta or blue-gradient SaaS palette.
- **Type**: Fraunces (a warm, characterful serif) for display moments — the
  business name, page titles, the dashboard's greeting — paired with Plus
  Jakarta Sans for every operational surface (tables, forms, nav). Neither
  is Inter or the generic serif+geometric-sans pairing.
- **The "hero" on Dashboard is an editorial greeting** ("Good morning,
  Amaka") grounded in the actual day's data, not a generic stat-grid as the
  first thing the owner sees.
- **Status badges are sentence-case with a color dot**, not all-caps pills —
  small deliberate choice against a common generic-AI-output tell.
- Business identity (section 5): the business's own name is what's
  prominent in the topbar; "Powered by SalonFlow" sits quietly in the
  sidebar footer.

## What's real, not mocked

- **Auth**: JWT login, stored in `localStorage`, attached to every request.
  A 401 anywhere in the app clears the session and redirects to `/login`.
- **Dashboard**: today's appointment count, needs-attention count (from the
  real `needsAttention` flag — section 7), today's revenue (real
  `/reports/revenue` call), total clients, today's schedule, and a full
  implementation of section 7's "needs attention" resolution UX — Mark
  Completed / Cancelled / No-show / Reschedule / Keep Pending, exactly the
  five options the spec describes, each a real API call.
- **Appointments**: list with status filter + search, a create-appointment
  flow that resolves qualified staff per service from real data (no
  hardcoded lists), a detail view with real event history, and status
  change / reschedule / reassign actions that only ever offer transitions
  the backend's state machine actually allows (mirrored in
  `utils/appointmentTransitions.ts` — a UX courtesy; the backend remains
  the real enforcement).
- **Reassignment is hidden for STAFF-role users** in the UI, matching the
  backend's owner/manager-only restriction — defense in depth, not a
  substitute for the backend check.

## One small backend addition this phase required

Two small, necessary additions to the backend to support this:
1. **`GET /api/notifications`** + `POST /api/notifications/:id/read` — didn't
   exist yet; the dashboard's alert bell needs somewhere to read from.
2. **Query filters on `GET /api/appointments`** (`from`, `to`, `status`,
   `needsAttention`) — previously returned everything for the business;
   the dashboard needs "just today" and "just what needs attention"
   efficiently.
3. **`POST /api/appointments/:id/acknowledge-attention`** — section 7 lists
   "Keep Pending" as one of five resolutions, but the state machine
   correctly rejects a PENDING→PENDING transition as a no-op, so there was
   no way to actually clear the attention flag without changing status.
   Added as its own small function or the "Keep Pending" button would have
   been fake.

All three are documented and tested in the backend README/test suite.

## Running it

```bash
cd server && npm install && npm run dev   # API on :4000
cd client && npm install && npm run dev   # frontend on :5173, proxies /api to :4000
```

No `.env` needed for local dev — `vite.config.ts` proxies `/api/*` to the
backend automatically.

## Sandbox caveat

Same as every backend phase: no network access in this environment, so
`npm install` / `vite build` / actually running the dev server haven't
been exercised here. Every import was cross-checked by hand against actual
exports, but treat `npm install && npm run dev` on your machine as the
real first test.

## Suggested next step

Per the nav's "Coming soon" placeholders, in roughly the order a salon
would need them: **Clients** (visit stats already exist on the backend —
`GET /api/clients/:id/stats` — nothing to build there but the UI),
**Calendar** (a visual week/day view over the same appointment data),
**Services** and **Staff** (CRUD UIs over already-complete backend
endpoints), then **Payments**, **Reports**, and **Settings**.

---

## Clients, Calendar, Services, Staff (this phase)

Four more pages, real and fully wired.

- **Clients**: list, search, create, and a detail view showing the derived
  stats from section 8 (visits, upcoming, no-shows, total spent — none of
  it a stored counter) plus real appointment history. Found one real gap
  while building this: there was no way to edit a client's info at all
  (fix a phone number, add notes) — added `PUT /api/clients/:id` on the
  backend, gated to OWNER/MANAGER by the existing permission.
- **Calendar**: a real staff×time grid (not a wrapped calendar library) —
  columns per active staff member, rows by time slot, positioned from
  actual business hours and each staff member's own weekly schedule. A
  staff member who doesn't work that day shows "Off today" instead of a
  bookable grid. Click any open slot to book it (pre-fills staff + time
  into the same create-appointment flow); click any appointment to open
  its detail. Found and fixed a real bug while extending the reschedule
  flow for this: `RescheduleModal` stays mounted persistently and only
  read its initial state from a prop, so reopening it for a *second,
  different* appointment would have shown the first one's stale time.
- **Services**: catalog CRUD over the already-complete backend — create,
  edit, and deactivate (soft delete only; a service with historical
  appointments must stay readable, per section 13).
- **Staff**: profile CRUD, a weekly schedule editor (the same schedule the
  Calendar page and the booking engine's availability checks read from),
  which services each staff member can perform, and status changes
  (Active/Inactive/Removed) that surface affected upcoming appointments
  right in the UI — the real implementation of section 10/11's "Ada has 2
  upcoming appointments" example, not a placeholder.

## Suggested next step

**Payments**, **Reports**, and **Settings** are the remaining "Coming
soon" placeholders — all three sit over already-complete backend
endpoints. Same sandbox caveat as above applies to everything in this
phase too.
