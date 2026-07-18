/** 404 handler for unmatched routes. */
export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Route not found: ${req.originalUrl}`));
}

/** Central error handler — normalises Mongoose / JWT / custom errors. */
export function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
  let message = err.message || 'Server error';

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }
  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `That ${field} is already taken.`;
  }
  // Mongoose validation
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }

  const isProd = process.env.NODE_ENV === 'production';
  // Always log server-side faults (helps monitoring); only 500s are noisy internals.
  if (statusCode >= 500) console.error('💥', err.stack || err.message);

  // Don't disclose internal error text to clients in production for 5xx — those
  // messages (DB driver, Redis host, etc.) can leak infrastructure detail.
  // Deliberate ApiErrors are exempt: their messages are written for end users.
  const clientMessage =
    isProd && statusCode >= 500 && !err.isOperational ? 'Something went wrong. Please try again.' : message;

  res.status(statusCode || 500).json({
    success: false,
    message: clientMessage,
    ...(!isProd && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}
