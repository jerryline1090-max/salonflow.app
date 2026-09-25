import { Request, Response, NextFunction } from "express";
import { assertCan, PermissionDeniedError, Resource, Action } from "../core/permissions";

/**
 * `requirePermission(resource, action)` is attached to every mutating and
 * every sensitive read route (see routes/*.ts). It calls the exact same
 * `assertCan` that the AI Assistant's tool layer calls before performing an
 * action on a user's behalf — one authority, two callers.
 */
export function requirePermission(resource: Resource, action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      await assertCan(req.actor, resource, action);
      next();
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return res.status(403).json({ error: err.message });
      }
      next(err);
    }
  };
}
