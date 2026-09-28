import "dotenv/config";
import express from "express";
import cors from "cors";
import { registerNotificationListeners } from "./modules/notifications/notificationListeners";
import { scanForAppointmentsNeedingAttention } from "./modules/appointments/attentionScanner";
import { authenticate } from "./middleware/authenticate";
import { requireInternalKey } from "./middleware/internalOnly";
import { authRouter } from "./routes/auth.routes";
import { appointmentsRouter } from "./routes/appointments.routes";
import { staffRouter } from "./routes/staff.routes";
import { clientsRouter } from "./routes/clients.routes";
import { paymentsRouter } from "./routes/payments.routes";
import { reportsRouter } from "./routes/reports.routes";
import { settingsRouter } from "./routes/settings.routes";
import { servicesRouter } from "./routes/services.routes";
import { knowledgeBaseRouter } from "./routes/knowledgeBase.routes";
import { conversationsRouter } from "./routes/conversations.routes";
import { assistantRouter } from "./routes/assistant.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { publicChatRouter } from "./routes/publicChat.routes";
import { integrationsCallbackRouter } from "./routes/integrationsCallback.routes";
import { integrationsRouter } from "./routes/integrations.routes";
import { reputationRouter } from "./routes/reputation.routes";
import { notificationsRouter } from "./routes/notifications.routes";
import { onboardingRouter } from "./routes/onboarding.routes";
import { queuePendingReputationRequests, sendPendingReputationRequests } from "./modules/reputation/reputationService";
import { startScheduledJobs } from "./jobs/scheduler";

// Wire every event listener once, at boot. This is the only place
// side-effects (notifications, etc.) get attached to core domain events.
registerNotificationListeners();

const app = express();
const productionOrigins = ["https://app.salonflow.com"];
const developmentOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = process.env.NODE_ENV === "production" ? productionOrigins : [...productionOrigins, ...developmentOrigins];
app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients such as provider webhooks do not send Origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: false,
  })
);

// ── Channel webhooks (WhatsApp/Instagram) need the RAW request body to
//    verify Meta's signature before anything trusts the payload — this
//    dedicated JSON parser stashes the raw bytes. It's scoped to this path
//    prefix only; every other route uses the plain parser below.
app.use(
  "/api/webhooks",
  express.json({
    verify: (req: any, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  }),
  webhooksRouter
);

app.use(express.json());

// ── Public endpoints: no user JWT. Webhooks are gated by Meta's signature
//    (see verifyMetaSignature.ts); the website widget is gated by its own
//    public key in the URL (see publicChat.routes.ts's caveat about that).
app.use("/api/public", publicChatRouter);
// Meta's OAuth redirect lands here unauthenticated (a browser navigation,
// not a fetch from our own frontend) — protected by the signed state
// parameter (core/oauthState.ts), not a JWT.
app.use("/api/integrations", integrationsCallbackRouter);
app.use("/api/auth", authRouter);

// ── Everything mounted after this line requires a valid JWT.
app.use("/api", authenticate);

app.use("/api/appointments", appointmentsRouter);
app.use("/api/staff", staffRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/services", servicesRouter);
app.use("/api/knowledge-base", knowledgeBaseRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/reputation", reputationRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/onboarding", onboardingRouter);

// ── Internal/system endpoints: no human actor, gated by a shared secret
//    instead of a user JWT. Run this on a schedule (cron/worker), not from
//    the dashboard. It only ever flags — see attentionScanner.ts (section 7).
app.post("/api/internal/scan-attention", requireInternalKey, async (_req, res) => {
  res.json(await scanForAppointmentsNeedingAttention());
});

// Section 30: run on a schedule too (e.g. hourly). Split into two steps so
// queuing (who's owed a request) and sending (actually reaching them) can
// be observed/retried independently.
app.post("/api/internal/reputation/queue", requireInternalKey, async (_req, res) => {
  res.json(await queuePendingReputationRequests());
});
app.post("/api/internal/reputation/send", requireInternalKey, async (_req, res) => {
  res.json(await sendPendingReputationRequests());
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`SalonFlow API listening on port ${port}`);

  // See jobs/scheduler.ts for the multi-instance caveat — set
  // ENABLE_SCHEDULER=false on every instance except one designated
  // "scheduler" instance if you run more than one copy of this API.
  if (process.env.ENABLE_SCHEDULER !== "false") {
    startScheduledJobs();
  } else {
    console.log("[scheduler] Disabled via ENABLE_SCHEDULER=false");
  }
});
