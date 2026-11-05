const mysql = require('mysql2/promise');
const config = require('./config');

const dbOptions = { ...config.db };
if (dbOptions.ssl) {
  // TiDB Cloud requires TLS. mysql2 uses Node.js trusted CA certificates.
  dbOptions.ssl = { minVersion: 'TLSv1.2' };
}

const pool = mysql.createPool({
  ...dbOptions,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true
});

module.exports = pool;
