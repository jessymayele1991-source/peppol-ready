import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, fromBodyParserError, notFound } from "../lib/errors";

/**
 * Terminal 404 for unmatched API paths. Mount after every router so unknown
 * routes produce the same envelope as every other failure.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound("The requested endpoint does not exist."));
};

/**
 * Single exit point for every failure. Express 5 forwards rejected promises
 * from async handlers here automatically, so routes never need their own
 * try/catch to produce a well-formed response.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError =
    error instanceof AppError ? error : fromBodyParserError(error);

  if (appError) {
    // Client mistakes and expected refusals: info, never error, so a stream of
    // malformed requests cannot flood error alerting.
    req.log?.info(
      { code: appError.code, statusCode: appError.statusCode },
      appError.message,
    );
    if (appError.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(appError.retryAfterSeconds));
    }
    res.status(appError.statusCode).json({
      error: { code: appError.code, message: appError.message },
    });
    return;
  }

  req.log?.error({ err: error }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong while handling the request.",
    },
  });
};
