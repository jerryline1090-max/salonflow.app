/**
 * `assertCan` (core/permissions.ts) answers "is this ROLE allowed to do this
 * KIND of thing". It says nothing about whether the specific appointment,
 * client, or staff record being touched actually belongs to the caller's
 * own business. That's a separate, mandatory check — a valid, authenticated
 * OWNER at Salon A must never be able to read or mutate Salon B's data just
 * because they guessed an ID. Every route that loads a resource by ID calls
 * this immediately after the fetch, before doing anything else with it.
 */
export class ForbiddenError extends Error {
  constructor(resourceName: string) {
    super(`This ${resourceName} does not belong to your business`);
    this.name = "ForbiddenError";
  }
}

export function assertBelongsToBusiness(
  actor: { businessId?: string },
  resourceBusinessId: string,
  resourceName: string
) {
  if (!actor.businessId || actor.businessId !== resourceBusinessId) {
    throw new ForbiddenError(resourceName);
  }
}
