/**
 * Error codes travel to the client inside the shared ApiError envelope and are
 * part of the OpenAPI contract. Add a code here and in openapi.yaml together.
 */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "too_many_requests"
  | "internal_error";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  /** Sent as the Retry-After header by the error handler when present. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
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

export function conflict(message: string): AppError {
  return new AppError(409, "conflict", message);
}

export function payloadTooLarge(
  message = "The request body is too large.",
): AppError {
  return new AppError(413, "payload_too_large", message);
}

export function tooManyRequests(
  retryAfterSeconds: number,
  message = "Too many attempts. Try again later.",
): AppError {
  return new AppError(429, "too_many_requests", message, retryAfterSeconds);
}

/**
 * body-parser rejects bodies before any route runs, with http-errors that
 * carry a `type` and a client status. They are client mistakes, not server
 * faults, so they are translated here instead of surfacing as a 500.
 */
export function fromBodyParserError(error: unknown): AppError | null {
  if (typeof error !== "object" || error === null) return null;

  const { type, status } = error as { type?: unknown; status?: unknown };
  if (typeof type !== "string") return null;

  if (type === "entity.parse.failed") {
    return badRequest("The request body is not valid JSON.");
  }
  if (type === "entity.too.large") {
    return payloadTooLarge();
  }

  // Remaining body-parser failures (unsupported charset or encoding, aborted
  // or truncated bodies) keep their own 4xx status.
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new AppError(status, "bad_request", "The request body could not be read.");
  }

  return null;
}
