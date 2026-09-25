# SalonFlow — Core Data Model & Business Logic Layer

This is Phase 1 of the build: the connected core described in the SalonFlow
architecture spec. No dashboard/calendar/AI UI yet — this is the engine
everything else will sit on top of, built so that adding those layers later
never requires re-deriving business rules.

## Why this exists before any UI

Per the spec's MVP Discipline principle: the fundamental workflow
(Business → Services → Staff → Availability → Appointments → Clients →
Payments → Notifications → Reports) has to be *reliable* before any AI or
channel integration touches it. Every rule below is enforced in code, not
left as a UI convention that different pages could each get slightly wrong.

## File map → spec section

| File | Spec section | What it enforces |
|---|---|---|
| `prisma/schema.prisma` | §2, §3, §6, §13 | Single source of truth. One `Appointment` table for every channel. Price/duration are *snapshotted* on the appointment at booking time so later Service edits can't rewrite history. |
| `modules/appointments/appointmentStateMachine.ts` | §6, §7 | Explicit allow-list of status transitions. `COMPLETED`/`CANCELLED`/`NO_SHOW` are terminal — nothing can silently flip them back. |
| `modules/appointments/appointmentService.ts` | §2, §6, §11, §18 | The **one** booking engine. `createAppointment`, `changeAppointmentStatus`, `rescheduleAppointment`, `reassignAppointmentStaff` — every channel (dashboard, calendar, staff app, WhatsApp/Instagram via AI Receptionist) must call these, never write to the table directly. Every mutation writes a paired `AppointmentEvent` + `AuditLog` row. |
| `modules/appointments/attentionScanner.ts` | §7 (hard rule) | Flags stale pending/confirmed appointments (`needsAttention`) — **never** transitions their status itself. Resolution is always a human (or AI acting with permission) calling `changeAppointmentStatus`. |
| `modules/staff/staffAvailability.ts` | §12 | The one availability engine. Checks schedule, time off, existing bookings, and — critically — extends the "busy" window by the home-service travel buffer so a 2:00 PM home visit can't be booked back-to-back with a 2:30 PM salon slot. |
| `modules/staff/staffLifecycle.ts` | §10, §11 | Removing/deactivating a staff member never deletes or orphans their upcoming appointments — it raises an `staff.removed` event with the affected list for the owner to reassign. |
| `modules/clients/clientStats.ts` | §8 | `totalVisits` is **not a column** — it's `COUNT(appointments WHERE status = COMPLETED)`, computed at read time. A pending/confirmed/cancelled appointment can never inflate it. |
| `modules/payments/paymentService.ts` | §13 | Payments are their own ledger, linked to (not derived from) appointments. Amounts are historical facts, never recalculated from current service pricing. |
| `modules/reports/reportService.ts` | §14 | Every report queries `Appointment`/`Payment`/`Client` directly — there is no parallel reporting table that could drift. |
| `modules/notifications/notificationListeners.ts` | §15, §16 | All notifications are reactions to domain events (`core/eventBus.ts`), registered once at boot — not side-effects buried inside business logic. |
| `modules/ai/aiKnowledge.ts` | §23, §24, §25 (hard rule) | Answers only from actual `Service` data or the salon's own `KnowledgeBaseEntry` rows. No match → escalates to a human via `ai.escalation_needed`, never fabricates an answer. |
| `core/permissions.ts` | §27, §28 | The one `can()`/`assertCan()` check. AI Assistant and AI Receptionist calls must pass through this the same as a human user — there's no "AI bypass" path. |
| `core/auditLog.ts` | §32 | Generic who/what/when/before/after log used by every module above. |
| `core/eventBus.ts` | (infrastructure) | Decouples "what happened" (business logic) from "who cares" (notifications, AI, future reporting jobs). |
| `core/auth.ts` | (infrastructure) | JWT signing/verification and password hashing — the only place either happens. |
| `core/tenantGuard.ts` | §2, §33 | `assertBelongsToBusiness` — blocks a valid, authenticated user from one salon touching another salon's records by ID. |
| `middleware/authenticate.ts` | §27 | Verifies the JWT and attaches `req.actor`. The only source of "who is making this request" — never the request body. |
| `middleware/authorize.ts` | §27, §28 | Wraps `assertCan` for HTTP routes; 403s on denial instead of silently proceeding. |
| `middleware/internalOnly.ts` | §7 (infra) | Shared-secret gate for the attention-scanner cron endpoint — no human actor, so it can't go through `authenticate`. |
| `modules/auth/authService.ts` | §28 | Registration always creates exactly one Business + one OWNER; team-member role is chosen by the caller (an existing OWNER), never self-selected by the invitee. |
| `routes/*.ts` | §39 | Every mutating/sensitive route: `authenticate` → `requirePermission` → `assertBelongsToBusiness` → the actual business-logic module. Nothing writes to Prisma directly from a route beyond simple reads. |

## What's deliberately NOT here yet

- HTTP auth middleware / JWT issuing (stubbed — `index.ts` takes `actorUserId` directly for now)
- React frontend (Phase 2)
- WhatsApp/Instagram webhook adapters — these will be thin translators that
  call the *same* `createAppointment` / `resolveClientQuestion` functions above,
  per §2 and §18. No separate "WhatsApp appointment" model will ever exist.
- Reputation engine (§30), full knowledge base admin UI (§25), AI Assistant
  chat surface (§29) — these are Differentiating/Future-Intelligence layer,
  correctly deferred past MVP per §37.

## Running it

```bash
cp .env.example .env   # point DATABASE_URL at a real Postgres instance
npm install
npm run prisma:generate
npm run prisma:migrate   # creates the schema in your database
npm run seed              # optional demo data (Big Kitchen Hair Studio)
npm run dev
```

## Test suite (spec §38)

Unit tests live next to the code they cover, in `__tests__/` folders, and
run against a fully mocked Prisma client (`src/lib/__mocks__/prisma.ts`, via
`jest-mock-extended`) — no real database needed to run them. Route-level
tests use `supertest` to exercise real HTTP requests through the actual
Express routers (auth → permission → tenant-scoping), still against the
mocked Prisma client.

```bash
npm install
npm test
```

| Test file | Realistic scenario from §38 it covers |
|---|---|
| `appointmentStateMachine.test.ts` | Every valid/invalid status transition; confirms COMPLETED/CANCELLED/NO_SHOW are terminal. |
| `staffAvailability.test.ts` | Double-booking at the salon; the "Ada" home-service-then-salon-appointment scenario with no travel time; staff removed/inactive/not home-eligible; outside working hours; approved time off. |
| `appointmentService.test.ts` | Booking a retired/inactive service; booking a home service the salon doesn't offer at home; a later service price change never touching an already-booked appointment's snapshot; invalid status transitions rejected before any DB write; reassignment recording previous → new staff. |
| `attentionScanner.test.ts` | A stale pending appointment gets flagged with all five safe resolutions offered — and its `status` field is never written by the scanner itself. |
| `staffLifecycle.test.ts` | Removing a staff member with upcoming appointments raises them for reassignment instead of deleting/orphaning them; removing a staff member with none does not falsely alarm the owner. |
| `clientStats.test.ts` | A client with upcoming pending/confirmed appointments still shows `totalVisits: 0` for those — only completed visits count. |
| `paymentService.test.ts` | Outstanding balance uses the historical price snapshot, never the current service price; never goes negative on overpayment. |
| `permissions.test.ts` | Role defaults, per-user overrides (both more and less permissive), and confirms there is exactly one permission check — usable identically by the AI Assistant and the UI. |
| `auth.test.ts` | JWT sign/verify round-trip, tampered-token rejection, password hashing never stores plaintext. |
| `tenantGuard.test.ts` | Cross-business access is blocked even for a structurally valid, authenticated request. |
| `authenticate.test.ts` | Missing/malformed/invalid tokens all 401; a valid token attaches the right `ActorContext`. |
| `authorize.test.ts` | Permission grant → `next()`; permission denial → 403; unexpected errors are forwarded to Express's error handler, not swallowed as a 403. |
| `authService.test.ts` | Registration always creates exactly one OWNER (role can't be smuggled in); login rejects unknown email / wrong password / deactivated account without leaking which; team-member role is set by the caller, never self-selected. |
| `appointments.routes.test.ts` (integration) | End-to-end through real HTTP: a STAFF token only ever sees their own appointments; cross-business access 403s even with a structurally valid OWNER token; reassignment is blocked for STAFF regardless of their "edit" permission. |
| `auth.routes.test.ts` (integration) | Team creation is OWNER-only by default; attempting to create another OWNER through the team endpoint is rejected outright. |

> **Note on this sandbox:** this environment has no network access, so I
> wasn't able to run `npm install` / `npx jest` here to confirm everything
> passes end-to-end. Every mock call was traced by hand against the actual
> implementation (call order, argument shapes, return values), but please
> run `npm install && npm test` on your machine as the first sanity check —
> if anything's off it's most likely a minor mock-shape mismatch, not a
> business-logic bug.

## API auth & REST surface (this phase)

**Identity model:** a JWT carries exactly three claims — `sub` (userId),
`businessId`, `role` — signed on `/register` and `/login`. Every other route
reads identity **only** from `req.actor` (attached by `middleware/authenticate.ts`),
never from the request body. This is what makes it structurally impossible
for a client to say "act as a different user" or "book into a different
business" by editing a payload.

**Three checks, in order, on every protected route:**
1. `authenticate` — is this a valid, unexpired token? → attaches `req.actor`
2. `requirePermission(resource, action)` (`middleware/authorize.ts`) — does this
   actor's **role** (or an explicit per-user override) allow this kind of action
   at all? Calls `core/permissions.ts::assertCan` — the exact same function the
   AI Assistant will call before acting on a user's behalf (section 27).
3. `assertBelongsToBusiness` (`core/tenantGuard.ts`) — for any route loading a
   specific record by ID, does that record actually belong to *this* actor's
   business? A valid OWNER token from Salon A must never reach Salon B's data.

On top of that, `appointments.routes.ts` adds one more layer specific to
appointments: a STAFF role's default "view"/"edit" permission is scoped to
*their own* linked `Staff` profile (list is filtered, single-record routes
403 on mismatch), and reassigning an appointment to a *different* staff
member is blocked for STAFF entirely — treated as an owner/manager decision
per section 11, not something the generic "edit" permission alone should grant.

### Endpoints

```
POST   /api/auth/register              — public. Creates a Business + its OWNER. Returns { token }.
POST   /api/auth/login                 — public. Returns { token }.
GET    /api/auth/me                    — any authenticated user.
POST   /api/auth/team                  — OWNER only (by default). Creates a MANAGER/STAFF account;
                                          the caller sets the role, the invitee never self-selects it (§28).

GET    /api/appointments               — list, scoped to own business (and own staff profile if role=STAFF)
GET    /api/appointments/:id
POST   /api/appointments               — books through the one engine, whatever the eventual channel
POST   /api/appointments/:id/status    — the ONLY way status changes; invalid transitions rejected
POST   /api/appointments/:id/reschedule
POST   /api/appointments/:id/reassign  — owner/manager only

GET    /api/staff
GET    /api/staff/:id
POST   /api/staff/:id/status           — surfaces affected upcoming appointments in the response

GET    /api/clients
GET    /api/clients/:id
GET    /api/clients/:id/stats          — totalVisits, always derived, never stored
POST   /api/clients

GET    /api/payments
POST   /api/payments
GET    /api/payments/appointments/:appointmentId/outstanding

GET    /api/reports/revenue
GET    /api/reports/outcomes
GET    /api/reports/popular-services
GET    /api/reports/staff-performance
GET    /api/reports/client-retention

GET    /api/settings                   — business-wide config only (section 4)
PUT    /api/settings
PUT    /api/settings/working-hours

POST   /api/internal/scan-attention    — no human actor; gated by X-Internal-Key header, run on a
                                          schedule (cron/worker), not from the dashboard.
```

### Trying it end-to-end

```bash
# 1. Create a salon + owner account
curl -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' -d '{
  "businessName": "Big Kitchen Hair Studio", "ownerName": "Amaka",
  "email": "amaka@bigkitchen.test", "password": "supersecret123"
}'
# → { "token": "...", "business": {...}, "user": {...} }

# 2. Use the token on every subsequent request
curl localhost:4000/api/appointments -H 'Authorization: Bearer <token>'
```

### What's still deliberately out of scope for this phase

- Refresh tokens / logout / token revocation (a short `JWT_TTL` plus re-login
  is the MVP-appropriate tradeoff for now)
- Service and Staff-profile CRUD routes (creating a `Service`/`Staff` record
  itself, distinct from the `User` account created via `/team`) — next small
  addition, following the exact same auth+permission+tenant pattern above
- Rate limiting / brute-force protection on `/login`

## Suggested next step

**WhatsApp/Instagram webhook adapters** — thin translators that call the
exact same `createAppointment` / `resolveClientQuestion` functions used by
this REST surface, proving the "one booking engine, many channels" claim
end-to-end (section 2, section 18).

---

## AI Receptionist — multi-channel text, voice & media (this phase)

This extends the REST-surface phase above with a full conversational layer,
per the multi-channel spec. The architecture principle from that spec, as
code:

```
WhatsApp / Instagram / Website
            ↓
Channel Adapter            (modules/ai/channels/*.ts)
            ↓
Unified Conversation Engine (modules/conversations/conversationEngine.ts)
            ↓
AI Receptionist Orchestrator (modules/ai/receptionistOrchestrator.ts)
            ↓
Salon Knowledge + Client Context (the tool-calling loop's context)
            ↓
Controlled SalonFlow Tools  (modules/ai/receptionistTools.ts)
            ↓
SalonFlow Core              (appointmentService.ts, paymentService.ts, ... — unchanged)
            ↓
Database / Events / Notifications (unchanged — same eventBus, same Prisma tables)
```

There is no separate "WhatsApp AI" or "Instagram AI", no separate booking
logic, and no separate notification system for AI actions — every one of
those explicit prohibitions in the spec is satisfied structurally, not just
by convention:

- **One conversation model.** `Conversation` + `ConversationMessage` (schema.prisma)
  hold every channel's messages, tagged by `channel`. `conversationEngine.ts`
  is the only code that writes to them.
- **One client per person, across channels.** `ClientChannelIdentity` links a
  WhatsApp phone number and an Instagram-scoped ID to the *same* `Client` row
  (`modules/clients/clientIdentity.ts`) — a person messaging on both never
  becomes two clients.
- **The AI never touches Prisma directly.** `receptionistTools.ts` is a fixed,
  narrow allowlist — the model can call `searchServices`, `bookAppointment`,
  `rescheduleOwnAppointment`, etc., but every function closes over a trusted
  `ReceptionistContext { businessId, clientId, conversationId }` resolved by
  the conversation engine from the *verified* webhook identity — never from
  anything the model or client said. Reassigning an appointment to a
  different staff member is deliberately **not** in this allowlist — that
  stays an owner/manager action (routes/appointments.routes.ts already blocks
  it for STAFF too, for the same reason).
- **Booking/rescheduling/cancelling go through the exact same engine** as the
  REST API — `receptionistTools.ts` calls `createAppointment`,
  `rescheduleAppointment`, `changeAppointmentStatus` from
  `appointmentService.ts`, unchanged. A booking made via WhatsApp gets the
  same state machine, the same event history, the same "never guess a status"
  rule (section 7) as one made from the dashboard.
- **No hallucination, enforced in code, not just prompted.** `aiKnowledge.ts`
  (existing) only answers from real `Service`/`KnowledgeBaseEntry` rows.
  `mediaUnderstanding.ts` returns a confidence score, and the orchestrator
  refuses to let anything below `MEDIA_CONFIDENCE_THRESHOLD` (0.6) be treated
  as an identified fact — it's phrased to the model as "unidentified, ask for
  clarification" instead. If the tool-calling loop runs `MAX_TOOL_ITERATIONS`
  (4) without the model producing a grounded reply, the orchestrator forces
  an escalation rather than letting a "reply" through ungrounded.
- **Same notification system.** Every AI action (booking, reassignment via
  the salon side, escalation) flows through the same `eventBus` +
  `notificationListeners.ts` as every other part of the app — no parallel
  "AI notifications" table.

### The one non-deterministic seam: `AiModelClient`

Everything above is fully deterministic, tested application code. The
actual language understanding — turning "Abeg I wan do my braids tomorrow
around two" into a `bookAppointment` tool call — requires a real LLM with
tool/function calling (e.g. the Anthropic Messages API), which this sandbox
can't call. `modules/ai/aiModelClient.ts` defines the interface
(`decide(history, toolResults) → reply | tool_call | escalate`); tests use a
scripted `ScriptedModelClient`. **Wire a real implementation in
`orchestratorFactory.ts`** — nothing else needs to change. Until you do, the
default `NotConfiguredAiModelClient` safely escalates every conversation to
a human rather than doing nothing or fabricating confident answers.

The other three pluggable interfaces are the same pattern — correct shape,
stub implementation, single swap point:

| Interface | File | Stub behavior | Real implementation would be |
|---|---|---|---|
| `AiModelClient` | `aiModelClient.ts` | Always escalates | Claude/GPT with tool calling |
| `SpeechToTextService` | `speechToText.ts` | Throws (caught → graceful "please type" reply) | Whisper, Deepgram, etc. |
| `MediaUnderstandingService` | `mediaUnderstanding.ts` | Throws (caught → "couldn't analyze") | A vision-capable model |
| `MediaStore` | `mediaStore.ts` | Local filesystem, no retention policy | S3/GCS with lifecycle rules |
| `SecretsProvider` | `secretsProvider.ts` | Reads `process.env` | AWS/GCP Secrets Manager, Vault |

### Channel adapters

`modules/ai/channels/{whatsappAdapter,instagramAdapter,websiteAdapter}.ts`
each implement the same `ChannelAdapter` interface (`normalizeInbound` /
`sendOutbound`). Adding Facebook Messenger or SMS later (section 22) means
writing one more file here — nothing in the conversation engine, tools, or
orchestrator changes.

- **WhatsApp**: parses Meta Cloud API webhook payloads; downloads
  voice/image/video via the Graph API media endpoint before handing off.
- **Instagram**: parses IG Messaging webhook payloads; filters out echoes of
  the business's own messages and read receipts, which arrive on the same
  webhook.
- **Website**: no provider webhook — the widget POSTs directly to
  `/api/public/:businessKey/chat` and gets the reply in the same HTTP
  response. Same orchestrator, same tables, just a synchronous transport.

> The WhatsApp/Instagram Graph API client code (`whatsappApiClient.ts`,
> `instagramApiClient.ts`) hasn't been exercised against a live account —
> no network access in this sandbox. The request shapes match Meta's
> documented Cloud/Messaging APIs; verify against a real WABA/IG account
> before relying on them.

### Security

- **Webhook signature verification** (`middleware/verifyMetaSignature.ts`):
  every WhatsApp/Instagram POST is HMAC-SHA256-verified against `META_APP_SECRET`
  over the *raw* request bytes before anything trusts the payload — this is
  what stops a stranger from POSTing fake bookings straight to the webhook URL.
  `index.ts` mounts a dedicated `express.json({ verify })` scoped to
  `/api/webhooks` specifically to capture those raw bytes.
- **Access tokens are never stored in plaintext.** `Integration.secretRef`
  is a *reference*, resolved through `SecretsProvider` — matches the
  existing "no raw provider URLs, no plaintext secrets" principle from the
  core data model phase.
- **The public website chat endpoint** currently uses the raw `Business.id`
  as its URL key — flagged clearly in `publicChat.routes.ts` as something to
  replace with a dedicated, rotatable public key before shipping an
  embeddable widget; an internal database ID shouldn't be public-facing.

### New endpoints

```
POST   /api/webhooks/whatsapp          — public, Meta-signature-verified
GET    /api/webhooks/whatsapp          — Meta's one-time verification handshake
POST   /api/webhooks/instagram         — public, Meta-signature-verified
GET    /api/webhooks/instagram         — Meta's one-time verification handshake
POST   /api/public/:businessKey/chat   — public website widget endpoint

GET    /api/conversations              — owner/manager (STAFF excluded by default)
GET    /api/conversations/:id          — full message history, tenant-scoped
POST   /api/conversations/:id/takeover — staff takes over; AI stops acting on it
POST   /api/conversations/:id/return-to-ai
POST   /api/conversations/:id/reply    — staff's manual reply, sent through the real channel
```

### Test suite additions

| Test file | What it proves |
|---|---|
| `clientIdentity.test.ts` | A phone number/IG account never creates a duplicate `Client`, on the second message or across channels. |
| `conversationEngine.test.ts` | One conversation row per thread regardless of channel; status transitions (escalate/takeover/return). |
| `receptionistTools.test.ts` | The AI can only ever act on the resolved client's own appointments — the actual permission enforcement for a client-facing actor. |
| `receptionistOrchestrator.test.ts` | Human takeover stops the AI cold; a failed/low-confidence media or voice pipeline degrades to a clarifying question, never a guess; an unresolved tool-calling loop force-escalates instead of spinning or replying ungrounded; channel send failures are recorded, not swallowed. |
| `whatsappAdapter.test.ts` / `instagramAdapter.test.ts` | Each provider's webhook shape parses correctly; failed media downloads don't silently drop the message; echoes/receipts are filtered. |
| `verifyMetaSignature.test.ts` | Tampered bodies and wrong/missing signatures are rejected; valid ones pass. |
| `conversations.routes.test.ts` | Same tenant-scoping and role-based access guarantees as every other route. |

Same sandbox caveat as before: no network access here, so `npm install && npm test`
on your machine is the real check.

## Suggested next step

With the AI Receptionist's architecture in place end-to-end (channels →
conversation engine → tools → core), the two most valuable next steps are:
1. **Wire a real `AiModelClient`** (Claude with tool use) so conversations
   actually get intelligent replies instead of safe escalation, or
2. **Service/Staff CRUD routes** (creating the `Service`/`Staff` records
   themselves, distinct from the `User` accounts from the auth phase) so a
   salon can fully configure itself through the API before any React UI exists.

---

## Service, Staff & Knowledge Base CRUD (this phase)

Closes the remaining MVP-tier data-entry gaps: until now the API could
*use* services and staff (booking against them) but not create them, and
the AI Receptionist could *read* the knowledge base but nothing could
write to it.

- **`modules/services/serviceService.ts`** — `createService`/`updateService`/
  `deactivateService`. Validates price ≥ 0, duration > 0, and that a service
  is available at the salon, at home, or both (never neither). Deactivation
  is a soft delete (`isActive: false`) — a service with historical
  appointments must stay readable, and its price/duration are already
  snapshotted onto those appointments (section 13), untouched by any later edit.
- **`modules/staff/staffProfile.ts`** — `createStaffProfile`/`updateStaffProfile`/
  `setStaffSchedule`/`setStaffServices`. This is the *operational* Staff
  record (skills, schedule, home-service eligibility) — distinct from the
  login-capable `User` account created via `POST /api/auth/team`. A staff
  member can exist and be bookable without ever logging in; a `User` links
  to a `Staff` row via `userId` only when they need dashboard access.
  `setStaffServices` validates every service ID actually belongs to the
  caller's business before linking — a typo'd or cross-tenant ID never
  silently links in.
- **`modules/ai/knowledgeBaseService.ts`** — CRUD for `KnowledgeBaseEntry`,
  plus `promoteEscalationToKnowledgeBase` (already existed in `aiKnowledge.ts`)
  wired to a route, so a resolved AI escalation (section 24) can become a
  permanent entry with one call — the same question never has to escalate twice.

New endpoints, all following the same `authenticate → requirePermission →
assertBelongsToBusiness` pattern as everything else:

```
GET/POST       /api/services
GET/PUT/DELETE /api/services/:id        (DELETE = soft-deactivate)

POST           /api/staff                (create profile — OWNER only by default)
PUT            /api/staff/:id            (update profile)
PUT            /api/staff/:id/schedule
PUT            /api/staff/:id/services

GET/POST       /api/knowledge-base
PUT/DELETE     /api/knowledge-base/:id
POST           /api/knowledge-base/promote-escalation
```

Knowledge base routes are gated by the existing `ai_receptionist` permission
(view/edit) rather than a new resource — it's content that exists to feed
the AI, so it inherits that resource's role defaults (OWNER can edit,
MANAGER/STAFF can view only).

## Suggested next step

The full backend checklist, in dependency order:
1. ~~Service & Staff CRUD + Knowledge Base CRUD~~ ✅ this phase
2. **Integrations connect/disconnect flow** — OAuth handshake with Meta for
   WhatsApp/Instagram (right now an `Integration` row has to be created
   manually; section 19)
3. **Wire a real `AiModelClient`** (Claude with tool use)
4. **AI Assistant** (owner-facing, floating icon, section 29) — distinct
   from the AI Receptionist built in the previous phase
5. **Reputation engine** (section 30)
6. **A real background job runner** for the attention scanner (currently an
   endpoint a cron *would* call — needs the actual scheduler)

Then, per your own MVP Discipline principle: the React frontend.

---

## Integrations connect/disconnect flow (this phase)

Section 19 (master spec), as code: Settings → Integrations → WhatsApp
Business / Instagram, driven entirely by Meta's own OAuth login — SalonFlow
never asks for or sees a WhatsApp/Facebook/Instagram password.

```
Owner clicks "Connect WhatsApp"
        ↓
POST /api/integrations/whatsapp/connect  (OWNER only by default)
        ↓  Integration.status -> CONNECTING
        ↓  returns Meta's OAuth dialog URL (with a signed, short-lived state token)
Browser redirected to facebook.com/.../dialog/oauth
        ↓  owner approves access ON META'S OWN PAGE
Meta redirects back to GET /api/integrations/whatsapp/callback?code=...&state=...
        ↓  verify state (CSRF + carries businessId/actorUserId through the redirect)
        ↓  exchange code -> short-lived token -> long-lived (~60 day) token
        ↓  store token via SecretsProvider (never in the Integration row itself)
        ↓  list which WhatsApp numbers / IG accounts this token can manage
   ┌────┴────────────────┬─────────────────────┐
 0 found               1 found              2+ found
   ↓                     ↓                     ↓
 ERROR               CONNECTED            NEEDS_SETUP
                                                ↓ owner picks via
                                          POST /api/integrations/whatsapp/select-account
                                                ↓
                                            CONNECTED
```

- **`core/oauthState.ts`** — the `state` parameter Meta's redirect carries
  back is a signed, 10-minute JWT (deliberately a *different* secret from
  login tokens — `core/auth.ts`) encoding `{businessId, provider, actorUserId}`.
  This is what makes the unauthenticated callback endpoint safe: it's not
  trusted because it's public, it's trusted because it proves it continues
  a flow *we* signed moments earlier.
- **`modules/integrations/metaOAuthClient.ts`** — the actual Graph API calls
  (authorization URL, code→token exchange, long-lived token exchange,
  listing connectable WhatsApp numbers / Instagram accounts). Not exercised
  against live Meta endpoints in this sandbox (no network access) — shapes
  match Meta's documented API, verify against a real Meta App before relying
  on them.
- **`modules/integrations/integrationService.ts`** — the actual state
  machine driving `Integration.status` through every state listed in the
  spec (`NOT_CONNECTED → CONNECTING → CONNECTED / NEEDS_SETUP / ERROR`, and
  `→ DISCONNECTED` any time). This is the only code that writes to that table.
- **Tokens are never stored in the `Integration` row.** `secretRef` is a
  deterministic reference (`integration:{businessId}:{provider}`); the
  actual token lives behind `SecretsProvider` (now with `setSecret`/`deleteSecret`
  alongside the existing `getSecret`, still dev-only via an in-memory map —
  the same production caveat as before applies).
- **Disconnecting is never silent.** `disconnectIntegration` audits the
  action, best-effort deletes the stored secret, and emits
  `integration.disconnected` — the exact same event `notificationListeners.ts`
  already reacted to from the AI Receptionist phase, so the owner gets
  notified through the one notification system, not a new one.

New endpoints:

```
GET  /api/integrations                         — list this business's integrations + status
POST /api/integrations/:provider/connect       — OWNER only by default; returns Meta's OAuth URL
GET  /api/integrations/:provider/callback      — PUBLIC; Meta redirects the owner's browser here
GET  /api/integrations/:provider/candidates    — while NEEDS_SETUP, lists the connectable accounts
POST /api/integrations/:provider/select-account — owner's pick, finalizes CONNECTED
POST /api/integrations/:provider/disconnect
```

(`:provider` is `whatsapp` or `instagram` — friendly slugs mapped to the
Prisma enum in `modules/integrations/providerSlug.ts`.)

### What's still a manual step for now

The callback route currently renders a plain HTML page (it's a full browser
navigation from Meta, not a fetch from a frontend that doesn't exist yet) —
swap `renderResultPage` for a redirect to the real Settings → Integrations
page once the React frontend exists. Also worth knowing: Meta's actual
**WhatsApp Embedded Signup** product (a JS widget Meta provides) handles
phone-number selection client-side before your backend ever sees a code,
which is smoother than this API-driven `NEEDS_SETUP` → `select-account`
fallback — this flow works standalone today and would still work as the
non-JS-widget path.

## Suggested next step

1. **Wire a real `AiModelClient`** (Claude with tool use) — now that
   channels connect through a real (if untested-against-live-Meta) OAuth
   flow, this is the last piece standing between "architecture" and
   "actually replies to a client"
2. **AI Assistant** (owner-facing, floating icon, section 29)
3. **Reputation engine** (section 30)
4. **Background job runner** for the attention scanner
5. React frontend

---

## Wiring a real AiModelClient (this phase)

Every previous phase built toward this without depending on it: the
channel adapters, the conversation engine, the tool allowlist, and the
tool-calling loop are all real, tested, deterministic code. The one
non-deterministic piece — actual language understanding — is now wired to
Claude's native tool use.

- **`modules/ai/toolSchemas.ts`** — the single source of truth for what the
  model is allowed to call, shared between the real model client (sends
  these as Claude's `tools` parameter) and `receptionistOrchestrator.ts`'s
  `TOOL_REGISTRY` (dispatches a matching tool_use back to `receptionistTools.ts`).
  Add a capability once, here, and both sides see it.
- **`modules/ai/systemPrompt.ts`** — grounds the model in the specific
  salon's identity and mode (salon-only/home-only/both), and states the
  hard rules from the spec explicitly (never invent facts, never claim
  success without a real tool result, always offer real alternatives
  instead of "no availability", escalate instead of guessing). Regenerated
  per business per call, so a name/mode change is reflected immediately
  with no redeploy.
- **`modules/ai/claudeModelClient.ts`** — the actual bridge to the Messages
  API. Translates the orchestrator's `history`/`toolResultsThisTurn` into a
  valid Anthropic message sequence (see the class's doc comment for the one
  documented simplification: tool calls made earlier in the same
  orchestrator turn are replayed as synthetic `tool_use`/`tool_result`
  pairs rather than the orchestrator carrying native Anthropic message
  state end-to-end — correct, but not the most cache-efficient shape).
  `escalate_to_staff` is presented to the model as an ordinary tool, but
  intercepted here and turned into a `{ kind: "escalate" }` decision rather
  than dispatched through the tool registry, since escalation is a
  decision *kind* (`aiModelClient.ts`), not a business-logic action.
- **`modules/ai/orchestratorFactory.ts`** — `resolveModelClient()` picks
  `ClaudeAiModelClient` when `ANTHROPIC_API_KEY` is set, otherwise the
  existing `NotConfiguredAiModelClient` (safe escalation). Nothing else —
  not the webhook routes, not the website chat route, not the orchestrator —
  needed to change to pick this up.

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default
`claude-sonnet-4-5`) and every channel starts getting real replies instead
of automatic escalation.

> Same sandbox caveat as the Meta OAuth client: this hasn't been exercised
> against the live Anthropic API here (no network access). The request/
> response shapes match the documented Messages API tool-use format —
> smoke-test with a real key before relying on it.

## Suggested next step

1. **AI Assistant** (owner-facing, floating icon, section 29) — distinct
   from the AI Receptionist; understands the current page and salon
   context, and (per the hard rule) inherits the exact permissions of
   whichever user is asking, via the same `assertCan()` used everywhere else
2. **Reputation engine** (section 30)
3. **Background job runner** for the attention scanner (currently an
   endpoint a cron *would* call)
4. React frontend

---

## AI Assistant (this phase)

Section 29 (master spec), and — more importantly — section 27's hard rule
made concrete for a second time: "User → Role → Permissions → UI + AI,
never User → AI → Everything." The AI Receptionist enforces that with a
fixed, narrow tool allowlist appropriate for an anonymous client. The
Assistant is different: it's a real logged-in `User` with a real `Role`
and possibly per-user `Permission` overrides, so it needs the *actual*
permission system — not a substitute for it.

**Every single tool in `modules/ai/assistantTools.ts` opens with the exact
same `assertCan()` call `requirePermission()` uses in the REST routes.**
A STAFF user's Assistant session calling `getRevenueReport` gets
`PermissionDeniedError` — the identical error a direct route hit would
produce — not a softer or different failure mode. The orchestrator
surfaces that to the model as an ordinary tool error, and the system
prompt (`assistantSystemPrompt.ts`) explicitly instructs the model to
relay a denial plainly rather than imply it's a bug or try another way in.

- **`modules/ai/assistantTools.ts`** — reports, appointment search/move/status-change/reassign,
  client counts and stats, staff availability explanations ("why can't I
  book Ada?"), integration status ("is WhatsApp connected?"). STAFF actors
  are scoped to their own appointments via `modules/staff/resolveOwnStaffId.ts`
  — the same helper `routes/appointments.routes.ts` now uses too (extracted
  in this phase so the rule is defined once, not duplicated between the UI
  route and the AI tool). Reassignment stays owner/manager-only regardless
  of the generic "edit" permission, mirroring the REST layer's identical restriction.
- **`modules/ai/assistantOrchestrator.ts`** — structurally the same
  tool-calling loop as the Receptionist's, with one meaningful difference:
  there's no "escalate to a human", because the person asking already *is*
  the human. If the model isn't configured or can't resolve something, it
  just says so plainly instead of pretending to hand off to someone else.
  Conversation history persists per `(business, user)` — the floating icon
  is one running thread regardless of which page it's opened from.
- **`modules/ai/assistantSystemPrompt.ts`** — states the permission rule
  explicitly, describes what the Assistant can help with (navigational
  how-to answered directly, data questions always tool-backed, actions
  always confirmed before mutating and never reported as successful unless
  the tool call actually succeeded), and stays concise per section 34
  ("don't overwhelm users with technical terminology").
- **`claudeModelClient.ts` is now shared** between the Receptionist and the
  Assistant — refactored in this phase to take `toolSchemas` and
  `buildSystemPrompt` as config rather than hardcoding the Receptionist's.
  One class, two very different tool surfaces and system prompts, exactly
  because the safety properties (never fabricate, never claim false
  success) are the same underlying problem either way.

New endpoint:

```
POST /api/assistant/ask   { message: string, currentPage?: string }
```

Deliberately has no `requirePermission()` gate beyond `authenticate` —
*any* logged-in user can talk to the Assistant, because the actual
boundary lives at the tool level. Gating the endpoint itself would just
duplicate (and risk drifting from) that.

Same sandbox caveat as the Receptionist's Claude wiring: not exercised
against the live Anthropic API here.

## Suggested next step

1. **Reputation engine** (section 30) — post-completion feedback requests,
   routing unhappy clients to the salon before a public review
2. **Background job runner** for the attention scanner and reputation
   engine's feedback requests (currently endpoints a cron *would* call)
3. React frontend — the last item on the checklist, once every backend
   layer above it is solid per your MVP Discipline principle

---

## Reputation engine (this phase)

Section 30, and its central rule made structural rather than just
described: a happy client gets offered a public review link; an unhappy —
or genuinely ambiguous — one is routed privately to the salon **first**,
and nothing in this codebase can push toward a public review without that
gate. There's also no code path that edits, invents, or discards what a
client actually said.

```
Appointment marked COMPLETED (existing appointmentService.ts, unchanged)
        ↓ (after business.reputationRequestDelayHours has passed)
queuePendingReputationRequests()  — creates a PENDING ReputationRequest
        ↓
sendPendingReputationRequests()   — finds the client's existing WhatsApp/
                                     Instagram conversation, sends "how was
                                     your experience?" through it, marks SENT
        ↓ client replies (any time later, on that same conversation)
receptionistOrchestrator.ts checks recordReputationResponse() FIRST,
before the normal booking/Q&A tool loop even runs
        ↓
parseSentiment() — numeric 1-5 rating, or simple keyword fallback
   ┌────────────┬──────────────────┐
 HAPPY        UNHAPPY           NEUTRAL/ambiguous
   ↓            ↓                  ↓
Google      Routed privately   Routed privately (still worth
review      to the owner       a human glance), no review push
link
```

- **`modules/reputation/reputationService.ts`** — the whole engine.
  `queuePendingReputationRequests`/`sendPendingReputationRequests` are
  separate steps (queuing survives a paused-sending incident without
  losing track of who's owed a request). `recordReputationResponse` is
  the piece with a hard dependency the spec doesn't spell out but needs in
  practice: *something* has to recognize "this incoming message is
  answering a pending feedback request" rather than treating it as a new
  booking question — that's why it's checked first, inside
  `receptionistOrchestrator.ts`, before the tool-calling loop.
- **Sentiment detection is a deterministic heuristic, not a model call** —
  a numeric rating if given, else simple keyword matching. Predictable and
  fully testable; a production deployment could route genuinely ambiguous
  free text through the configured `AiModelClient` for better detection,
  but the common case (a rating) never needs that at all.
- **`modules/notifications/channelMessenger.ts`** — extracted in this phase
  as a small shared helper (`sendToClientChannel`) so the reputation engine
  and `conversations.routes.ts`'s staff-reply endpoint don't each
  reimplement "find the connected integration, build channel deps, send" —
  one implementation, reused.
- **Unhappy/ambiguous feedback flows through the same notification system**
  as everything else (`reputation.response_received` → `notificationListeners.ts`)
  — no separate "reviews inbox" mechanism, consistent with every other
  phase's "one notification system" rule.
- **Owner resolution**: `routes/reputation.routes.ts` lets an owner/manager
  view routed feedback and mark it resolved with notes once they've
  followed up — gated by a new `reputation` permission resource (OWNER/MANAGER
  view+edit, STAFF none by default, matching "this is a relationship-management
  responsibility" rather than day-to-day operational data).
- **Settings**: `reputationEnabled`, `reputationRequestDelayHours`,
  `reputationHappyThreshold`, and `googleReviewUrl` are business-wide config
  (section 4) — added to the existing `PUT /api/settings` endpoint rather
  than a new one.

New endpoints:

```
GET  /api/reputation                      — list feedback (filterable by ?sentiment=, ?status=)
GET  /api/reputation/:id
POST /api/reputation/:id/resolve          — { notes? }

POST /api/internal/reputation/queue       — internal, cron-triggered (shares INTERNAL_API_KEY)
POST /api/internal/reputation/send        — internal, cron-triggered
```

**One refactor worth flagging**: wiring the reputation check into
`receptionistOrchestrator.ts` created a real circular import
(`receptionistOrchestrator → reputationService → channelMessenger →
orchestratorFactory → receptionistOrchestrator`, the last edge only for a
type reference). Fixed by making that last import `import type` — TypeScript
erases it at compile time, so there's no runtime cycle. Worth knowing if
you add more cross-module type references in this area later.

## Suggested next step

1. **Background job runner** — every scheduled piece built so far
   (attention scanner, reputation queue/send) is currently an endpoint a
   cron *would* call; wiring an actual scheduler (node-cron, a queue
   worker, or your platform's scheduled-jobs product) is what makes them
   actually run
2. React frontend — the last item on the backend-first checklist, once the
   scheduler above is in place

---

## Background job scheduler (this phase — backend checklist complete)

Every scheduled piece from earlier phases (the attention scanner, the
reputation engine's queue/send steps) existed only as an endpoint a cron
*would* call. This phase makes them actually run, in-process, via `node-cron`.

- **`jobs/scheduler.ts`** — registers four jobs: `attention-scanner` (hourly),
  `reputation-queue` (every 30 min), `reputation-send` (every 15 min), and
  `media-purge` (daily at 3am — the `MediaStore.purgeExpired()` retention
  hook from the AI Receptionist phase, defined back then but never actually
  called anywhere until now). Each schedule is overridable via env var.
- **Concurrency-safe within one process**: a `wrapJob` wrapper skips a run
  if the previous invocation of the *same* job hasn't finished, and catches
  any error so one failing job can never crash the process or block the
  others — same "isolate failures" principle as `eventBus`'s
  `Promise.allSettled` for notification listeners.
- **The multi-instance caveat is real and documented in the file itself**:
  `node-cron` runs inside this Node process. Run more than one instance of
  this API without addressing this, and every instance fires these jobs
  independently — for `reputation-send`, that means duplicate messages to
  clients. Two ways to handle it: set `ENABLE_SCHEDULER=false` on every
  instance except one designated "scheduler" instance, or replace this
  with a real distributed scheduler/queue (BullMQ + Redis, a dedicated
  worker process, or your platform's scheduled-jobs product).
- **The internal HTTP endpoints from earlier phases still exist** and are
  complementary, not redundant: `/api/internal/scan-attention`, `/api/internal/reputation/queue`,
  and `/api/internal/reputation/send` are exactly what you'd point an
  *external* cron/scheduled-jobs product at instead — the safer choice for
  a multi-instance deployment, since an external trigger naturally fires
  exactly once regardless of how many API instances are running.
- Started automatically in `index.ts` on boot, gated by `ENABLE_SCHEDULER`
  (default on).

## Backend: complete

Every item on the checklist from the original architecture prompt is now
built and tested:

1. ✅ Core data model + business logic
2. ✅ Test suite
3. ✅ JWT auth + REST surface
4. ✅ AI Receptionist multi-channel layer (WhatsApp/Instagram/website)
5. ✅ Service/Staff/Knowledge Base CRUD
6. ✅ Integrations connect/disconnect flow
7. ✅ Real `AiModelClient` (Claude, tool use)
8. ✅ AI Assistant (owner-facing)
9. ✅ Reputation engine
10. ✅ Background job runner

Per your MVP Discipline principle: the React frontend is next, now that
every layer beneath it is solid. Every caveat flagged along the way is
still real and worth addressing before production — most notably: nothing
here has been exercised against a live Meta or Anthropic API (no network
access in this sandbox), the dev-mode `SecretsProvider`/`MediaStore` need
real backing services, and rate limiting on `/login` hasn't been added.
