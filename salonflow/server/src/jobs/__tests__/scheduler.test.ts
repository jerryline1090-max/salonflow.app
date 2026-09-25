jest.mock("node-cron", () => ({
  validate: jest.fn(() => true),
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));
jest.mock("../../modules/appointments/attentionScanner");
jest.mock("../../modules/reputation/reputationService");
jest.mock("../../modules/ai/orchestratorFactory", () => ({
  mediaStore: { purgeExpired: jest.fn().mockResolvedValue({ purgedCount: 0 }) },
}));

import cron from "node-cron";
import { scanForAppointmentsNeedingAttention } from "../../modules/appointments/attentionScanner";
import { queuePendingReputationRequests, sendPendingReputationRequests } from "../../modules/reputation/reputationService";
import { mediaStore } from "../../modules/ai/orchestratorFactory";
import { startScheduledJobs, stopScheduledJobs, __testing } from "../scheduler";

const { buildJobs, wrapJob } = __testing;

beforeEach(() => {
  stopScheduledJobs();
  jest.clearAllMocks();
  // clearAllMocks() clears recorded calls but NOT a custom mockImplementation
  // set by an earlier test (e.g. the invalid-cron-expression test below) —
  // reset it explicitly so tests don't leak state into each other.
  (cron.validate as jest.Mock).mockImplementation(() => true);
});

describe("buildJobs", () => {
  it("registers a job for every scheduled piece built in earlier phases", () => {
    const jobs = buildJobs();
    const names = jobs.map((j) => j.name);

    expect(names).toEqual(
      expect.arrayContaining(["attention-scanner", "reputation-queue", "reputation-send", "media-purge"])
    );
  });

  it("each job actually calls the real underlying function", async () => {
    (scanForAppointmentsNeedingAttention as jest.Mock).mockResolvedValue({ flaggedCount: 0 });
    (queuePendingReputationRequests as jest.Mock).mockResolvedValue({ queued: 0 });
    (sendPendingReputationRequests as jest.Mock).mockResolvedValue({ sent: 0, skipped: 0 });

    const jobs = buildJobs();
    for (const job of jobs) {
      await job.run();
    }

    expect(scanForAppointmentsNeedingAttention).toHaveBeenCalled();
    expect(queuePendingReputationRequests).toHaveBeenCalled();
    expect(sendPendingReputationRequests).toHaveBeenCalled();
    expect(mediaStore.purgeExpired).toHaveBeenCalled();
  });
});

describe("wrapJob", () => {
  it("does not throw when the underlying job rejects — a failing job must not crash the process", async () => {
    const job = { name: "test-job", schedule: "* * * * *", run: jest.fn().mockRejectedValue(new Error("boom")) };

    await expect(wrapJob(job)()).resolves.toBeUndefined();
    expect(job.run).toHaveBeenCalledTimes(1);
  });

  it("skips a run if the previous invocation of the same job is still in progress", async () => {
    let resolveFirst!: () => void;
    const firstRunPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const run = jest.fn().mockReturnValueOnce(firstRunPromise).mockResolvedValueOnce(undefined);
    const job = { name: "slow-job", schedule: "* * * * *", run };
    const wrapped = wrapJob(job);

    const firstInvocation = wrapped(); // starts, doesn't resolve yet
    const secondInvocation = wrapped(); // should be skipped immediately

    await secondInvocation;
    expect(run).toHaveBeenCalledTimes(1); // second invocation never called run()

    resolveFirst();
    await firstInvocation;
  });

  it("allows a fresh run once the previous one has completed", async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const job = { name: "sequential-job", schedule: "* * * * *", run };
    const wrapped = wrapJob(job);

    await wrapped();
    await wrapped();

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("startScheduledJobs", () => {
  it("registers every valid job with node-cron using its configured schedule", () => {
    startScheduledJobs();

    expect(cron.schedule).toHaveBeenCalledTimes(buildJobs().length);
  });

  it("is idempotent — calling it twice does not double-register", () => {
    startScheduledJobs();
    startScheduledJobs();

    expect(cron.schedule).toHaveBeenCalledTimes(buildJobs().length);
  });

  it("skips a job with an invalid cron expression rather than crashing the whole registration", () => {
    (cron.validate as jest.Mock).mockImplementation((expr: string) => expr !== "0 * * * *");

    startScheduledJobs();

    // One job (attention-scanner, using the default "0 * * * *") is skipped; the rest register.
    expect(cron.schedule).toHaveBeenCalledTimes(buildJobs().length - 1);
  });
});

describe("stopScheduledJobs", () => {
  it("stops every registered task and allows re-registration afterward", () => {
    startScheduledJobs();
    const scheduledTask = (cron.schedule as jest.Mock).mock.results[0].value;

    stopScheduledJobs();

    expect(scheduledTask.stop).toHaveBeenCalled();

    startScheduledJobs();
    expect(cron.schedule).toHaveBeenCalledTimes(buildJobs().length * 2);
  });
});
