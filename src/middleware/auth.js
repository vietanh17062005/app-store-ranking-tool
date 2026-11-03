// Local XAMPP mode: no Bearer token is required.
// Keep this app bound to localhost; do not expose the API directly to the Internet.
module.exports = function auth(_req, _res, next) {
  next();
};
