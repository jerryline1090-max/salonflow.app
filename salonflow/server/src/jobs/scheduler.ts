import cron, { ScheduledTask } from "node-cron";
import { scanForAppointmentsNeedingAttention } from "../modules/appointments/attentionScanner";
import { queuePendingReputationRequests, sendPendingReputationRequests } from "../modules/reputation/reputationService";
import { mediaStore } from "../modules/ai/orchestratorFactory";

/**
 * Every scheduled piece built in earlier phases (the attention scanner,
 * the reputation engine's queue/send steps, media retention) existed only
 * as an endpoint a cron *would* call. This file is what actually calls
 * them, in-process, on a schedule - no separate infrastructure required
 * for a single-instance deployment.
 *
 * IMPORTANT - multi-instance deployments: node-cron runs entirely inside
 * this Node process. If you run more than one instance of this API (for
 * horizontal scaling, zero-downtime deploys, etc.), EVERY instance would
 * fire these jobs independently, multiplying the work (and, for something
 * like sendPendingReputationRequests, sending duplicate messages to
 * clients). Either:
 *   (a) run the scheduler in exactly one designated instance
 *       (ENABLE_SCHEDULER=false everywhere else), or
 *   (b) replace this with a real distributed scheduler/queue (e.g. a
 *       dedicated worker process, BullMQ + Redis, or your platform's
 *       scheduled-jobs product) that guarantees single execution.
 * The concurrency guard below only protects against a single job
 * overlapping ITSELF within one process - it does nothing across instances.
 */

interface ScheduledJob {
  name: string;
  schedule: string; // cron expression
  run: () => Promise<Record<string, unknown> | void>;
}

function buildJobs(): ScheduledJob[] {
  return [
    {
      name: "attention-scanner",
      // Hourly by default - section 7: flags stale pending/confirmed
      // appointments for the owner; never auto-resolves anything itself.
      schedule: process.env.CRON_ATTENTION_SCANNER ?? "0 * * * *",
      run: () => scanForAppointmentsNeedingAttention(),
    },
    {
      name: "reputation-queue",
      // Every 30 min - finds newly-eligible COMPLETED appointments and
      // creates a PENDING ReputationRequest for each.
      schedule: process.env.CRON_REPUTATION_QUEUE ?? "*/30 * * * *",
      run: () => queuePendingReputationRequests(),
    },
    {
      name: "reputation-send",
      // Every 15 min - actually delivers PENDING requests; split from
      // queuing so a delivery incident doesn't lose track of who's owed one.
      schedule: process.env.CRON_REPUTATION_SEND ?? "*/15 * * * *",
      run: () => sendPendingReputationRequests(),
    },
    {
      name: "media-purge",
      // Daily at 3am - enforces retention on stored WhatsApp/Instagram
      // media (section 12: don't keep every media file forever).
      schedule: process.env.CRON_MEDIA_PURGE ?? "0 3 * * *",
      run: () => mediaStore.purgeExpired(),
    },
  ];
}

const runningJobs = new Set<string>();

function wrapJob(job: ScheduledJob) {
  return async () => {
    if (runningJobs.has(job.name)) {
      console.warn(`[scheduler] Skipping "${job.name}" - a previous run is still in progress`);
      return;
    }
    runningJobs.add(job.name);
    const startedAt = Date.now();
    try {
      const result = await job.run();
      console.log(`[scheduler] "${job.name}" completed in ${Date.now() - startedAt}ms`, result ?? "");
    } catch (err) {
      // A single job failing must never crash the process or block the
      // other jobs - logged and swallowed, same principle as
      // eventBus.emit's Promise.allSettled for notification listeners.
      console.error(`[scheduler] "${job.name}" failed:`, err);
    } finally {
      runningJobs.delete(job.name);
    }
  };
}

let tasks: ScheduledTask[] = [];
let started = false;

/** Idempotent - safe to call more than once (e.g. accidentally in tests); only registers once. */
export function startScheduledJobs(): void {
  if (started) return;
  started = true;

  for (const job of buildJobs()) {
    if (!cron.validate(job.schedule)) {
      console.error(`[scheduler] Invalid cron expression for "${job.name}": "${job.schedule}" - job NOT scheduled`);
      continue;
    }
    tasks.push(cron.schedule(job.schedule, wrapJob(job)));
    console.log(`[scheduler] Registered "${job.name}" on schedule "${job.schedule}"`);
  }
}

/** For graceful shutdown / tests - stops every registered task and resets state. */
export function stopScheduledJobs(): void {
  for (const task of tasks) task.stop();
  tasks = [];
  started = false;
  runningJobs.clear();
}

// Exported for direct unit testing without needing to fake node-cron's
// internal scheduling - see __tests__/scheduler.test.ts.
export const __testing = { buildJobs, wrapJob };
