// Dashboard và các endpoint cũ chạy không cần token (chế độ nội bộ/XAMPP).
// Hãy giữ app trong mạng tin cậy hoặc đặt reverse proxy phía trước.
module.exports = function auth(_req, _res, next) {
  next();
};

// Bảo vệ API tích hợp (/api/v1). Nếu API_TOKEN được đặt thì bắt buộc
// `Authorization: Bearer <token>` hoặc header `X-API-Key: <token>`.
// Nếu API_TOKEN để trống thì cho qua (giống hành vi cũ) và log cảnh báo một lần.
const crypto = require('node:crypto');
const config = require('../config');
let warned = false;
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
module.exports.requireApiToken = function requireApiToken(req, res, next) {
  if (!config.apiToken) {
    if (!warned) { warned = true; console.warn('[api/v1] API_TOKEN chưa được đặt: API tích hợp đang mở không xác thực.'); }
    return next();
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  const provided = bearer ? bearer[1].trim() : (req.get('x-api-key') || '');
  if (provided && safeEqual(provided, config.apiToken)) return next();
  res.set('WWW-Authenticate', 'Bearer');
  return res.status(401).json({ error: 'unauthorized', message: 'Thiếu hoặc sai API token.' });
};
