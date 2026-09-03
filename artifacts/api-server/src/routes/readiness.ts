import { Router, type IRouter } from "express";
import {
  CalculateCompanyReadinessBody,
  CalculateCompanyReadinessParams,
  CalculateCompanyReadinessResponse,
  GetReadinessDashboardQueryParams,
  GetReadinessDashboardResponse,
} from "@workspace/api-zod";
import {
  calculateAndPersistCompanyReadiness,
  getReadinessDashboard,
} from "../lib/readiness-service";

const router: IRouter = Router();

router.get("/readiness/dashboard", async (req, res) => {
  const query = GetReadinessDashboardQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "A valid organizationId is required." });
    return;
  }

  try {
    const dashboard = await getReadinessDashboard(query.data.organizationId);
    if (!dashboard) {
      res.status(404).json({ error: "Organization not found." });
      return;
    }

    res.json(GetReadinessDashboardResponse.parse(dashboard));
  } catch (error) {
    req.log.error({ err: error }, "Failed to build readiness dashboard");
    res.status(500).json({ error: "Unable to build readiness dashboard." });
  }
});

router.post(
  "/companies/:companyId/readiness/calculate",
  async (req, res) => {
    const params = CalculateCompanyReadinessParams.safeParse(req.params);
    const body = CalculateCompanyReadinessBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "The readiness assessment is invalid." });
      return;
    }

    try {
      const assessment = await calculateAndPersistCompanyReadiness(
        params.data.companyId,
        body.data,
      );
      if (!assessment) {
        res.status(404).json({ error: "Company not found." });
        return;
      }

      res.json(CalculateCompanyReadinessResponse.parse(assessment));
    } catch (error) {
      req.log.error({ err: error }, "Failed to calculate company readiness");
      res.status(500).json({ error: "Unable to calculate readiness." });
    }
  },
);

export default router;