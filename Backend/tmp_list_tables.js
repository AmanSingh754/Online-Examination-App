const db = require('./db');

db.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name", ['public'])
  .then(([rows]) => {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
