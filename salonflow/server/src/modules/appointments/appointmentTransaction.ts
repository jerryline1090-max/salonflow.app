import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export class AppointmentConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = "This time is no longer available. Please refresh and try again.") {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

/** All availability reads and appointment/history/audit writes share this snapshot.
 * Only serialization/deadlock P2034 errors retry: three attempts, two retries.
 * Callers must keep external side effects outside the callback.
 */
export async function appointmentTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
      if (attempt === 2) throw new AppointmentConflictError();
    }
  }
  throw new AppointmentConflictError();
}
