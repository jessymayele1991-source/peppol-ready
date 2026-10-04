import { FixedWindowLimiter } from "./login-rate-limit";

/**
 * Assessment protection held in process memory, with the same limitation as the
 * sign-in counters in `login-rate-limit.ts`: state lives in one Node process, so
 * it resets on restart and each instance counts separately. Moving to a shared
 * store later only replaces FixedWindowLimiter; the route does not change.
 *
 * Recording an assessment is cheap for the caller and not cheap for us: one
 * assessment row, one row per control point, an audit row and a client update.
 * Two counters, because they bound different kinds of misuse — a member looping
 * over the whole portfolio, and a loop against one client that would bury its
 * history under identical assessments.
 */
const ONE_HOUR = 60 * 60 * 1000;

export const ASSESSMENT_LIMITS = {
  /** Assessments one user may record per hour, across all their clients. */
  perUser: 120,
  /** Assessments one client may receive per hour, from any user in the firm. */
  perCompany: 30,
  windowMs: ONE_HOUR,
} as const;

export const assessmentProtection = {
  user: new FixedWindowLimiter({
    limit: ASSESSMENT_LIMITS.perUser,
    windowMs: ASSESSMENT_LIMITS.windowMs,
  }),
  company: new FixedWindowLimiter({
    limit: ASSESSMENT_LIMITS.perCompany,
    windowMs: ASSESSMENT_LIMITS.windowMs,
  }),
};

/** Test hook: counters are process-global. */
export function resetAssessmentProtection(): void {
  assessmentProtection.user.clear();
  assessmentProtection.company.clear();
}
