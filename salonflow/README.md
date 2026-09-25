# SalonFlow

A connected salon operating system — not a collection of dashboards and
CRUD pages. Built backend-first per the project's own MVP Discipline
principle: every business-logic layer is complete and tested before any
UI touches it.

## Structure

```
server/   Node/Express/TypeScript/PostgreSQL API — the entire backend, complete.
          See server/README.md for the full architecture, phase-by-phase.
client/   React/TypeScript/Vite frontend — Dashboard + Appointments pages,
          consuming the real API. See client/README.md.
```

## Status

**Backend: complete.** Core data model, business logic, auth, REST API,
multi-channel AI Receptionist (WhatsApp/Instagram/website), Service/Staff/
Knowledge Base CRUD, integrations connect/disconnect flow, a real Claude
model client, an owner-facing AI Assistant, the reputation engine, and a
background job scheduler.

**Frontend: in progress.** Dashboard and Appointments are real and fully
wired; every other page (Calendar, Clients, Services, Staff, Payments,
Reports, Settings) exists in the nav as a "Coming soon" placeholder,
following the same page architecture the spec describes, built in the same
order a salon would actually need them.

## Running everything locally

```bash
# Backend
cd server
cp .env.example .env   # point DATABASE_URL at a real Postgres instance
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed             # optional demo data
npm run dev               # API on :4000

# Frontend (separate terminal)
cd client
npm install
npm run dev                # on :5173, proxies /api to :4000
```

Then visit `http://localhost:5173`, register a business via
`POST http://localhost:4000/api/auth/register` (no signup UI yet — that's
part of a future frontend phase), and log in.

## A note on verification

Every phase of this build — backend and frontend — was written in a
sandboxed environment with no network access: no `npm install`, no
`npm test`, no `vite build`, no live calls to Meta or Anthropic's APIs.
Each phase's own README documents this honestly where it matters. The code
was written carefully and cross-checked by hand (import/export pairing,
Prisma relation names, brace/paren balance, mock call shapes in tests),
but **treat `npm install && npm test` / `npm run dev` on your own machine
as the real first verification**, not this summary.
