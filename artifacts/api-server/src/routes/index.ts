import { Router, type IRouter } from "express";
import healthRouter from "./health";
import readinessRouter from "./readiness";

const router: IRouter = Router();

router.use(healthRouter);
router.use(readinessRouter);

export default router;
