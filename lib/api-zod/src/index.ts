export * from "./generated/api";
export * from "./generated/types";

/**
 * Disambiguation, not a re-export for convenience.
 *
 * For an operation with both path and query parameters, orval emits the path
 * parameters as `<Operation>Params` in `generated/api` and the operation's query
 * parameter type as `<Operation>Params` in `generated/types`. Two star exports
 * carrying one name is ambiguous (TS2308); an explicit export resolves it, and
 * the schema is what server code validates `req.params` with.
 *
 * Add a line here when the contract gains another such operation — the library
 * build fails until you do.
 */
export { ListCompanyAssessmentsParams } from "./generated/api";
