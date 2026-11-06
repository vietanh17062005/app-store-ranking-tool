const axios = require('axios');
const pool = require('../db');
const config = require('../config');
const { normalizeCmsPayload } = require('../utils/cms-normalizer');

async function syncApps() {
  const response = await axios.get(config.cmsAppsUrl, {
    timeout: config.requestTimeoutMs,
    headers: { Accept: 'application/json' }
  });
  const apps = normalizeCmsPayload(response.data);
  const connection = await pool.getConnection();
  let synced = 0;
  try {
    await connection.beginTransaction();
    for (const app of apps) {
      // Upsert on stable CMS key if available; otherwise update by known store ID.
      const [existing] = await connection.execute(
        `SELECT id FROM ung_dung WHERE
          (? IS NOT NULL AND ma_cms = ?) OR
          (? IS NOT NULL AND id_google = ?) OR
          (? IS NOT NULL AND id_apple = ?)
         LIMIT 1`,
        [app.cmsKey, app.cmsKey, app.googlePlayId, app.googlePlayId, app.appStoreId, app.appStoreId]
      );
      const keywords = app.keywords ? JSON.stringify(app.keywords) : null;
      if (existing.length) {
        await connection.execute(
          `UPDATE ung_dung SET ma_cms=?, ten=?, id_google=?, id_apple=?,
           goi_apple=?, tu_khoa=?, du_lieu_cms=?, kich_hoat=1 WHERE id=?`,
          [
            app.cmsKey,
            app.appName,
            app.googlePlayId,
            app.appStoreId,
            app.appStoreBundleId,
            keywords,
            JSON.stringify(app.raw),
            existing[0].id
          ]
        );
      } else {
        await connection.execute(
          `INSERT INTO ung_dung (ma_cms, ten, id_google, id_apple, goi_apple, tu_khoa, du_lieu_cms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            app.cmsKey,
            app.appName,
            app.googlePlayId,
            app.appStoreId,
            app.appStoreBundleId,
            keywords,
            JSON.stringify(app.raw)
          ]
        );
      }
      synced++;
    }
    await connection.commit();
    return { synced, cmsItems: apps.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
module.exports = { syncApps };
