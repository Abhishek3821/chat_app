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

  if (process.env.NODE_ENV !== 'production' && statusCode >= 500) {
    console.error('💥', err.stack);
  }

  res.status(statusCode || 500).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}
