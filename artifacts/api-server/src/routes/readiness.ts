import { Router, type IRouter } from "express";
import {
  CalculateCompanyReadinessBody,
  CalculateCompanyReadinessParams,
  CalculateCompanyReadinessResponse,
  GetCompanyAssessmentParams,
  GetCompanyAssessmentResponse,
  GetLatestCompanyAssessmentParams,
  GetLatestCompanyAssessmentResponse,
  GetReadinessDashboardResponse,
  ListCompanyAssessmentsParams,
  ListCompanyAssessmentsQueryParams,
  ListCompanyAssessmentsResponse,
} from "@workspace/api-zod";
import {
  calculateAndPersistCompanyReadiness,
  getCompanyAssessment,
  getLatestCompanyAssessment,
  listCompanyAssessments,
  getReadinessDashboard,
} from "../lib/readiness-service";
import { assessmentProtection } from "../lib/assessment-rate-limit";
import { CompanyArchivedError } from "../lib/company-service";
import {
  badRequest,
  conflict,
  notFound,
  tooManyRequests,
  unauthorized,
} from "../lib/errors";
import { requireAuth } from "../middlewares/require-auth";
import { requireCapability } from "../middlewares/require-capability";

const TOO_MANY_ASSESSMENTS =
  "Too many readiness assessments were recorded. Try again later.";

const router: IRouter = Router();

router.get("/readiness/dashboard", requireAuth, requireCapability("clients.view"), async (req, res) => {
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

    // Recording an assessment writes an assessment, its control points, an
    // audit event and the client row. Counted per user and per client, so
    // neither a loop over the portfolio nor a loop against one client can bury
    // its history. Peeked before the work and only counted once it is allowed.
    const { companyId } = params.data;
    const user = assessmentProtection.user.peek(req.auth.userId);
    if (!user.allowed) throw tooManyRequests(user.retryAfterSeconds, TOO_MANY_ASSESSMENTS);
    const company = assessmentProtection.company.peek(companyId);
    if (!company.allowed) throw tooManyRequests(company.retryAfterSeconds, TOO_MANY_ASSESSMENTS);
    assessmentProtection.user.consume(req.auth.userId);
    assessmentProtection.company.consume(companyId);

    const { evidence, ...answers } = body.data;

    let assessment: Awaited<ReturnType<typeof calculateAndPersistCompanyReadiness>>;
    try {
      assessment = await calculateAndPersistCompanyReadiness(
        companyId,
        answers,
        req.auth,
        undefined,
        evidence ?? {},
      );
    } catch (error) {
      if (error instanceof CompanyArchivedError) throw conflict(error.message);
      throw error;
    }
    // Also the answer for a company in another organization: a client must not
    // be able to tell "not yours" apart from "does not exist".
    if (!assessment) throw notFound("Company not found.");

    res.json(CalculateCompanyReadinessResponse.parse(assessment));
  },
);

router.get(
  "/companies/:companyId/readiness/latest",
  requireAuth,
  requireCapability("clients.view"),
  async (req, res) => {
    if (!req.auth) throw unauthorized();

    const params = GetLatestCompanyAssessmentParams.safeParse(req.params);
    // An unusable id cannot name a client of this organization, so it answers
    // the same as one that belongs to another firm.
    if (!params.success) throw notFound("Company not found.");

    const result = await getLatestCompanyAssessment(req.auth, params.data.companyId);
    if (!result.found) throw notFound("Company not found.");
    // Never assessed is not an error: the client exists and has no assessment.
    if (!result.assessment) {
      res.status(204).end();
      return;
    }

    res.json(GetLatestCompanyAssessmentResponse.parse(result.assessment));
  },
);

router.get(
  "/companies/:companyId/readiness/assessments",
  requireAuth,
  requireCapability("clients.view"),
  async (req, res) => {
    if (!req.auth) throw unauthorized();

    const params = ListCompanyAssessmentsParams.safeParse(req.params);
    if (!params.success) throw notFound("Company not found.");
    const query = ListCompanyAssessmentsQueryParams.safeParse(req.query);
    if (!query.success) throw badRequest("The assessment query is invalid.");
    if (
      !Number.isInteger(query.data.page ?? 1) ||
      !Number.isInteger(query.data.pageSize ?? 1)
    ) {
      throw badRequest("Page and page size must be whole numbers.");
    }

    const result = await listCompanyAssessments(req.auth, params.data.companyId, query.data);
    if (!result.found) throw notFound("Company not found.");

    res.json(ListCompanyAssessmentsResponse.parse(result.page));
  },
);

router.get(
  "/companies/:companyId/readiness/assessments/:assessmentId",
  requireAuth,
  requireCapability("clients.view"),
  async (req, res) => {
    if (!req.auth) throw unauthorized();

    const params = GetCompanyAssessmentParams.safeParse(req.params);
    // An unusable id cannot name an assessment of this organization, so it
    // answers the same as one that belongs to another firm.
    if (!params.success) throw notFound("Assessment not found.");

    const assessment = await getCompanyAssessment(
      req.auth,
      params.data.companyId,
      params.data.assessmentId,
    );
    if (!assessment) throw notFound("Assessment not found.");

    res.json(GetCompanyAssessmentResponse.parse(assessment));
  },
);

export default router;
