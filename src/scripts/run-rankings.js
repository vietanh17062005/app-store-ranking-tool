const { runRankings } = require('../services/ranking-service');
const pool = require('../db');
runRankings({ triggerType: 'manual' }).then(result => console.log(result)).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
