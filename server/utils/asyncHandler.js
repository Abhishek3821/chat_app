/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error-handling middleware instead of crashing the process.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Small helper to throw HTTP-aware errors from controllers. */
export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    // Deliberately-thrown errors carry messages written for end users, so the
    // error handler may show them even for 5xx (unlike unexpected internals).
    this.isOperational = true;
  }
}
