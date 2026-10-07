// Do not load the developer's .env or initialize application dependencies.
jest.mock("dotenv/config", () => ({}));
jest.mock("express", () => jest.fn());
jest.mock("../../jobs/scheduler", () => ({ startScheduledJobs: jest.fn(), stopScheduledJobs: jest.fn() }));
jest.mock("../../modules/notifications/notificationListeners", () => ({ registerNotificationListeners: jest.fn() }));

describe("fail-closed startup ordering", () => {
  const previous = process.env;
  afterEach(() => { process.env = previous; });
  it.each(["JWT_SECRET", "OAUTH_STATE_SECRET"])("invalid %s stops the real entrypoint before app/listen and all scheduler registration", (name) => {
    process.env = { ...previous, NODE_ENV: "production", JWT_SECRET: "unit-jwt-fixture", OAUTH_STATE_SECRET: "unit-state-fixture", ENABLE_SCHEDULER: "true", ENABLE_COMMERCIAL_LIFECYCLE_JOBS: "true" };
    delete process.env[name];
    jest.isolateModules(() => {
      const express = require("express");
      const scheduler = require("../../jobs/scheduler");
      const listeners = require("../../modules/notifications/notificationListeners");
      expect(() => require("../../index")).toThrow(`Invalid production configuration: ${name}`);
      expect(express).not.toHaveBeenCalled();
      expect(scheduler.startScheduledJobs).not.toHaveBeenCalled();
      expect(listeners.registerNotificationListeners).not.toHaveBeenCalled();
    });
  });
});
