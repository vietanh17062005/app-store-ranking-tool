const pool = require('../db');

async function ensureCustomKeywordColumn() {
  const [columns] = await pool.query("SHOW COLUMNS FROM ung_dung LIKE 'tu_khoa_tuy_chinh'");
  if (!columns.length) {
    await pool.query('ALTER TABLE ung_dung ADD COLUMN tu_khoa_tuy_chinh JSON NULL AFTER tu_khoa');
  }
}

module.exports = { ensureCustomKeywordColumn };
