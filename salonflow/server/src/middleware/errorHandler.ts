import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";

const DATABASE_UNAVAILABLE_MESSAGE = "SalonFlow is temporarily unavailable. Please try again shortly.";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientRustPanicError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1008", "P1009", "P1017"].includes(error.code);
  }
  return false;
}

/** Lets route-local validation handlers preserve their 4xx contracts while
 * allowing infrastructure failures to reach the central 503 classifier. */
export function rethrowIfDatabaseUnavailable(error: unknown): void {
  if (isDatabaseUnavailable(error)) throw error;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;

  if (isDatabaseUnavailable(error)) {
    console.error("Database unavailable", { name: error.name, code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined });
    res.status(503).json({ error: DATABASE_UNAVAILABLE_MESSAGE });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error("Unhandled request error", { name: error instanceof Error ? error.name : "UnknownError" });
  res.status(500).json({ error: "Internal server error" });
};

export { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailable };
