import { Router, type IRouter } from "express";
import {
  CalculateCompanyReadinessBody,
  CalculateCompanyReadinessParams,
  CalculateCompanyReadinessResponse,
  GetReadinessDashboardResponse,
} from "@workspace/api-zod";
import {
  calculateAndPersistCompanyReadiness,
  getReadinessDashboard,
} from "../lib/readiness-service";
import { badRequest, notFound, unauthorized } from "../lib/errors";
import { requireAuth } from "../middlewares/require-auth";
import { requireCapability } from "../middlewares/require-capability";

const router: IRouter = Router();

router.get("/readiness/dashboard", requireAuth, async (req, res) => {
  if (!req.auth) throw unauthorized();

  const dashboard = await getReadinessDashboard(req.auth.organizationId);
  // requireAuth already confirmed the membership, so a missing organization
  // here means the record was deleted mid-session.
  if (!dashboard) throw unauthorized("Your session is no longer valid.");

  res.json(GetReadinessDashboardResponse.parse(dashboard));
});

router.post(
  "/companies/:companyId/readiness/calculate",
  requireAuth,
  requireCapability("scans.write"),
  async (req, res) => {
    if (!req.auth) throw unauthorized();

    const params = CalculateCompanyReadinessParams.safeParse(req.params);
    const body = CalculateCompanyReadinessBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw badRequest("The readiness assessment is invalid.");
    }

    const assessment = await calculateAndPersistCompanyReadiness(
      params.data.companyId,
      body.data,
      req.auth,
    );
    // Also the answer for a company in another organization: a client must not
    // be able to tell "not yours" apart from "does not exist".
    if (!assessment) throw notFound("Company not found.");

    res.json(CalculateCompanyReadinessResponse.parse(assessment));
  },
);

export default router;
