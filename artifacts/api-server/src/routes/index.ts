import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import readinessRouter from "./readiness";

const router: IRouter = Router();

// Public: the deployment health check must not require a session.
router.use(healthRouter);
router.use(authRouter);
router.use(readinessRouter);

export default router;
