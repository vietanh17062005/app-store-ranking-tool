const { syncApps } = require('../services/app-sync-service');
const pool = require('../db');
syncApps().then(result => console.log(result)).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
