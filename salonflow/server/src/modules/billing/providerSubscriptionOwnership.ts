import { Prisma } from "@prisma/client";

/** Read-only deployment gate. Never repair/merge/delete duplicate ownership. */
export async function checkProviderSubscriptionOwnership(db: Prisma.TransactionClient) {
  const duplicates = await db.subscription.groupBy({
    by: ["provider", "providerSubscriptionId"],
    where: { provider: { not: null }, providerSubscriptionId: { not: null } },
    having: { providerSubscriptionId: { _count: { gt: 1 } } },
    _count: { _all: true },
  });
  return { safeToMigrate: duplicates.length === 0, duplicates };
}
