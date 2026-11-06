const pool = require('../db');

async function getCountries(codes = null, { enabledOnly = true } = {}) {
  if (codes !== null && !codes.length) return [];
  const conditions = [];
  const values = [];
  if (enabledOnly) conditions.push('kich_hoat=1');
  if (codes?.length) {
    conditions.push('ma IN (?)');
    values.push([...new Set(codes.map(code => String(code).toUpperCase()))]);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT ma AS country_code, ten AS country_name,
            ma_vi_tri_google AS google_location_code,
            ma_cua_hang_apple AS apple_storefront,
            ngon_ngu AS language_code, kich_hoat AS enabled,
            tao_luc AS created_at, sua_luc AS updated_at
     FROM quoc_gia ${where} ORDER BY ten`,
    values
  );
  return rows;
}

module.exports = { getCountries };
