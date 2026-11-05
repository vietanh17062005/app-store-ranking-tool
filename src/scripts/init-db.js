const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();
const config = require('../config');
const { ensureCustomKeywordColumn } = require('../services/schema-service');

async function main() {
  // Connect without a database so the schema script can create it.
  const connectionOptions = {
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, multipleStatements: true
  };
  if (config.db.ssl) connectionOptions.ssl = { minVersion: 'TLSv1.2' };
  const connection = await mysql.createConnection(connectionOptions);
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
    await connection.query(sql);
    await ensureCustomKeywordColumn();
    console.log('Database schema initialized.');
  } finally { await connection.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
