import type { RequestHandler, Router } from "express";

/** Makes rejected async route work reach Express's central error middleware. */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Existing routers contain a mix of synchronous middleware and async route
 * callbacks. Express 4 does not forward a rejected promise from either form,
 * so normalize every registered route callback at application assembly time.
 */
export function protectRouterAsyncHandlers(...routers: Router[]): void {
  for (const router of routers) {
    for (const layer of (router as any).stack ?? []) {
      if (!layer.route) continue;
      for (const routeLayer of layer.route.stack ?? []) {
        const handler = routeLayer.handle as RequestHandler;
        if (!handler || handler.length === 4 || (handler as any).__salonflowAsyncProtected) continue;
        const protectedHandler: RequestHandler = (req, res, next) => {
          Promise.resolve(handler(req, res, next)).catch(next);
        };
        (protectedHandler as any).__salonflowAsyncProtected = true;
        routeLayer.handle = protectedHandler;
      }
    }
  }
}
