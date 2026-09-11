export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
// Exported as values so consumers can narrow a caught error with instanceof;
// the generated ErrorType alias only describes the shape.
export { ApiError, ResponseParseError } from "./custom-fetch";
