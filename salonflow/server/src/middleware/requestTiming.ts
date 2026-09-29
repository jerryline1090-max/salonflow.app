import type { RequestHandler } from "express";

/** Concise production-safe request telemetry: no bodies, tokens, or query values. */
export const requestTiming: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();
  res.on("finish", () => {
    console.info("request", { method: req.method, route: normalizePath(req.path), status: res.statusCode, durationMs: Math.round(performance.now() - startedAt) });
  });
  next();
};

function normalizePath(path: string): string {
  return path.split("/").map((segment) => (/^(?:c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(segment) ? ":id" : segment)).join("/");
}
