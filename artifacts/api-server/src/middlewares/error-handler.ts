import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, notFound } from "../lib/errors";

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

  if (error instanceof AppError) {
    // Expected outcomes: log at info so they stay visible without paging anyone.
    req.log?.info(
      { code: error.code, statusCode: error.statusCode },
      error.message,
    );
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
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
