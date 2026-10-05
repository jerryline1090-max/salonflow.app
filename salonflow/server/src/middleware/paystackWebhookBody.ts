import express, { RequestHandler } from "express";
import { PAYSTACK_JSON_LIMIT_BYTES } from "../modules/billing/paystack/paystackJson";

const readRaw = express.raw({ type: "application/json", inflate: false, limit: PAYSTACK_JSON_LIMIT_BYTES });

/** Route-local collector: no decoding, inflation, parsing or reconstruction before HMAC. */
export const paystackWebhookBody: RequestHandler = (req, res, next) => {
  const encoding = req.header("content-encoding");
  if ((encoding && encoding.toLowerCase() !== "identity") || !req.is("application/json")) {
    res.status(415).json({ error: "Unsupported webhook encoding or content type" });
    return;
  }
  readRaw(req, res, error => {
    if (error) {
      res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid webhook body" });
      return;
    }
    (req as any).rawBody = req.body;
    next();
  });
};
