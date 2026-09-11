/**
 * Error codes travel to the client inside the shared ApiError envelope and are
 * part of the OpenAPI contract. Add a code here and in openapi.yaml together.
 */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "internal_error";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, "bad_request", message);
}

export function unauthorized(
  message = "Authentication is required.",
): AppError {
  return new AppError(401, "unauthorized", message);
}

export function forbidden(
  message = "You do not have access to this resource.",
): AppError {
  return new AppError(403, "forbidden", message);
}

export function notFound(message: string): AppError {
  return new AppError(404, "not_found", message);
}
