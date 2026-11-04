c
onst fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();
const config = require('../config');

// Split SQL only on semicolons outside quoted strings and comments.
function splitSql(source) {
  source = source.replace(/\/\*!\d*([\s\S]*?)\*\//g, '$1');
  const out = [];
  let buf = '', quote = null, lineComment = false, blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === '\n') { lineComment = false; buf += '\n'; } continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      buf += c;
      if (c === '\\' && i + 1 < source.length) { buf += source[++i]; continue; }
      if (c === quote) { if (source[i + 1] === quote) { buf += source[++i]; } else quote = null; }
      continue;
    }
    if (c === '-' && n === '-' && (i + 2 >= source.length || /\s/.test(source[i + 2]))) { lineComment = true; i++; continue; }
    if (c === '#') { lineComment = true; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; buf += c; continue; }
    if (c === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function main() {
  const sqlPath = path.resolve('database/xep_hang_app.sql');
  if (!fs.existsSync(sqlPath)) throw new Error(`Không tìm thấy file SQL: ${sqlPath}`);
  const options = {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
    connectTimeout: 20000
  };
  if (config.db.ssl) {
    const caPath = path.resolve(process.env.DB_CA_PATH || './certs/ca.pem');
    if (!fs.existsSync(caPath)) throw new Error(`Không tìm thấy CA certificate: ${caPath}`);
    options.ssl = { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }
  const conn = await mysql.createConnection(options);
  try {
    // Restore this dump from a clean state; remove leftovers from previous failed imports.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['thu_hang', 'lan_chay', 'quoc_gia', 'ung_dung']) {
      await conn.query('DROP TABLE IF EXISTS `' + table + '`');
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const raw = fs.readFileSync(sqlPath, 'utf8');
    const statements = splitSql(raw).filter(s => {
      const t = s.trim();
      return !/^(SET\s+|START\s+TRANSACTION|COMMIT\b|ROLLBACK\b|CREATE\s+DATABASE\b|USE\s+)/i.test(t);
    });
    let done = 0;
    for (const statement of statements) {
      // TiDB may reject MariaDB's table options; remove only nonessential dump options.
      const sql = statement
        .replace(/\s+COLLATE=utf8mb4_unicode_ci/ig, '')
        .replace(/\s+COLLATE\s+utf8mb4_unicode_ci/ig, '')
        .replace(/\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/ig, '');
      try {
        await conn.query(sql);
        done++;
      } catch (err) {
        err.message = `Lỗi ở câu SQL ${done + 1}: ${err.message}\nCâu SQL bắt đầu: ${sql.slice(0, 180).replace(/\s+/g, ' ')}`;
        throw err;
      }
    }
    console.log(`Đã thực thi ${done} câu SQL.`);
    for (const table of ['ung_dung', 'quoc_gia', 'lan_chay', 'thu_hang']) {
      try {
        const [rows] = await conn.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
        console.log(`${table}: ${rows[0].total} bản ghi`);
      } catch (e) { console.log(`${table}: chưa đọc được (${e.message})`); }
    }
  } finally { await conn.end(); }
}
main().catch(e => { console.error('Import thất bại:', e.message); process.exit(1); });
