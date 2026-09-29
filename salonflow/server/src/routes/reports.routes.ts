import { Router } from "express";
import { requirePermission } from "../middleware/authorize";
import {
  getRevenueReport,
  getAppointmentOutcomeReport,
  getPopularServicesReport,
  getStaffPerformanceReport,
  getClientRetentionReport,
} from "../modules/reports/reportService";
import { InvalidReportRangeError, resolveReportRange } from "../modules/reports/reportRange";
import { asyncHandler } from "../middleware/asyncHandler";

export const reportsRouter = Router();

// All report endpoints are tenant-scoped implicitly: businessId is always
// taken from req.actor, never from a query param, so there is no way to
// request another salon's numbers by editing the URL.

async function withRange(req: any, res: any, getReport: (businessId: string, from: Date, to: Date) => Promise<unknown>) {
  try {
    const businessId = req.actor!.businessId!;
    const { from, to } = await resolveReportRange(businessId, req.query);
    res.json(await getReport(businessId, from, to));
  } catch (err: any) {
    if (err instanceof InvalidReportRangeError) return res.status(400).json({ error: err.message });
    throw err;
  }
}

reportsRouter.get("/revenue", requirePermission("reports", "view"), asyncHandler(async (req, res) => {
  await withRange(req, res, getRevenueReport);
}));

reportsRouter.get("/outcomes", requirePermission("reports", "view"), asyncHandler(async (req, res) => {
  await withRange(req, res, getAppointmentOutcomeReport);
}));

reportsRouter.get("/popular-services", requirePermission("reports", "view"), asyncHandler(async (req, res) => {
  await withRange(req, res, getPopularServicesReport);
}));

reportsRouter.get("/staff-performance", requirePermission("reports", "view"), asyncHandler(async (req, res) => {
  await withRange(req, res, getStaffPerformanceReport);
}));

reportsRouter.get("/client-retention", requirePermission("reports", "view"), asyncHandler(async (req, res) => {
  res.json(await getClientRetentionReport(req.actor!.businessId!));
}));
