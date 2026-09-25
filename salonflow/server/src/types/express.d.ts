import { ActorContext } from "../core/permissions";

declare global {
  namespace Express {
    interface Request {
      // Set by middleware/authenticate.ts once the JWT is verified.
      // Every downstream route reads the actor from HERE — never from
      // req.body — so a client can't just claim to be a different user
      // or a different business by editing the request payload.
      actor?: ActorContext;
    }
  }
}

export {};
