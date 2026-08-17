'use strict';
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const authRequired = (req, res, next) => next();
const optionalAuth = (req, res, next) => next();
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const expose = status < 500;
  res.status(status).json({ error: err.code || 'server_error', message: expose ? err.message : 'Something went wrong.' });
}
module.exports = { asyncHandler, authRequired, optionalAuth, errorHandler };
