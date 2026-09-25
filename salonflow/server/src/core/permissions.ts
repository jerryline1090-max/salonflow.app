import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Section 27–28: permissions operate at two levels — page access and action
 * access — and the AI must inherit exactly the same permissions as the
 * human it's acting on behalf of. There is only ONE permission check in the
 * whole system (this file). The UI calls it. The AI Assistant calls it.
 * The AI Receptionist (acting as "CLIENT", a separate actor type with its
 * own narrow allowlist) calls it. Nobody re-implements access rules locally.
 */

export type Resource =
  | "dashboard"
  | "appointments"
  | "calendar"
  | "clients"
  | "services"
  | "staff"
  | "payments"
  | "reports"
  | "settings"
  | "ai_receptionist"
  | "integrations"
  | "conversations"
  | "reputation";

export type Action = "view" | "create" | "edit" | "delete";

// Sensible role defaults. Explicit rows in the Permission table override
// these per-user (e.g. a specific staff member granted payments:view).
const ROLE_DEFAULTS: Record<Role, Partial<Record<Resource, Action[]>>> = {
  OWNER: {
    dashboard: ["view"],
    appointments: ["view", "create", "edit", "delete"],
    calendar: ["view", "create", "edit"],
    clients: ["view", "create", "edit", "delete"],
    services: ["view", "create", "edit", "delete"],
    staff: ["view", "create", "edit", "delete"],
    payments: ["view", "create", "edit", "delete"],
    reports: ["view"],
    settings: ["view", "edit"],
    ai_receptionist: ["view", "edit"],
    integrations: ["view", "edit"],
    conversations: ["view", "edit"],
    reputation: ["view", "edit"],
  },
  MANAGER: {
    dashboard: ["view"],
    appointments: ["view", "create", "edit"],
    calendar: ["view", "create", "edit"],
    clients: ["view", "create", "edit"],
    services: ["view", "edit"],
    staff: ["view", "edit"],
    payments: ["view", "create"],
    reports: ["view"],
    settings: ["view"],
    ai_receptionist: ["view"],
    integrations: ["view"],
    conversations: ["view", "edit"],
    reputation: ["view", "edit"],
  },
  STAFF: {
    dashboard: ["view"],
    appointments: ["view", "edit"], // typically limited to own appointments — enforced in service layer
    calendar: ["view"],
    clients: ["view"],
    services: ["view"],
    staff: [],
    payments: [],
    reports: [],
    settings: [],
    ai_receptionist: ["view"],
    integrations: [],
    conversations: [], // staff don't see the raw AI Receptionist inbox by default; owner/manager can override per-user
    reputation: [], // feedback resolution is an owner/manager responsibility by default
  },
};

export interface ActorContext {
  userId: string;
  role: Role;
  // Populated for authenticated HTTP/AI requests (see middleware/authenticate.ts).
  // Optional here so existing unit tests that only care about role-based
  // access can keep constructing a minimal actor without this field.
  businessId?: string;
}

/**
 * The single authority for "can this actor do this?".
 * `actingAs` lets AI Assistant calls pass through the user it's helping,
 * rather than an implicit "AI can do anything" bypass (section 27, hard rule).
 */
export async function can(
  actor: ActorContext,
  resource: Resource,
  action: Action
): Promise<boolean> {
  const override = await prisma.permission.findUnique({
    where: { userId_resource: { userId: actor.userId, resource } },
  });

  if (override) {
    switch (action) {
      case "view":
        return override.canView;
      case "create":
        return override.canCreate;
      case "edit":
        return override.canEdit;
      case "delete":
        return override.canDelete;
    }
  }

  const defaults = ROLE_DEFAULTS[actor.role][resource] ?? [];
  return defaults.includes(action);
}

export class PermissionDeniedError extends Error {
  constructor(resource: Resource, action: Action) {
    super(`Actor lacks '${action}' permission on '${resource}'`);
    this.name = "PermissionDeniedError";
  }
}

/** Throws if the actor may not perform the action — use at the top of every mutating service call. */
export async function assertCan(actor: ActorContext, resource: Resource, action: Action) {
  const allowed = await can(actor, resource, action);
  if (!allowed) throw new PermissionDeniedError(resource, action);
}
