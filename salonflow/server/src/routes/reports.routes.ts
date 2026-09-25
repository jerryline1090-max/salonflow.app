import { Router } from "express";
import { requirePermission } from "../middleware/authorize";
import {
  getRevenueReport,
  getAppointmentOutcomeReport,
  getPopularServicesReport,
  getStaffPerformanceReport,
  getClientRetentionReport,
} from "../modules/reports/reportService";

export const reportsRouter = Router();

// All report endpoints are tenant-scoped implicitly: businessId is always
// taken from req.actor, never from a query param, so there is no way to
// request another salon's numbers by editing the URL.

function parseRange(req: any) {
  const from = req.query.from ? new Date(req.query.from) : new Date(new Date().setDate(new Date().getDate() - 30));
  const to = req.query.to ? new Date(req.query.to) : new Date();
  return { from, to };
}

reportsRouter.get("/revenue", requirePermission("reports", "view"), async (req, res) => {
  const { from, to } = parseRange(req);
  res.json(await getRevenueReport(req.actor!.businessId!, from, to));
});

reportsRouter.get("/outcomes", requirePermission("reports", "view"), async (req, res) => {
  const { from, to } = parseRange(req);
  res.json(await getAppointmentOutcomeReport(req.actor!.businessId!, from, to));
});

reportsRouter.get("/popular-services", requirePermission("reports", "view"), async (req, res) => {
  const { from, to } = parseRange(req);
  res.json(await getPopularServicesReport(req.actor!.businessId!, from, to));
});

reportsRouter.get("/staff-performance", requirePermission("reports", "view"), async (req, res) => {
  const { from, to } = parseRange(req);
  res.json(await getStaffPerformanceReport(req.actor!.businessId!, from, to));
});

reportsRouter.get("/client-retention", requirePermission("reports", "view"), async (req, res) => {
  res.json(await getClientRetentionReport(req.actor!.businessId!));
});
