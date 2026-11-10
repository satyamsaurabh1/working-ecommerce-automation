// Runs ONCE, on the first start with an empty data volume, via the official
// image's /docker-entrypoint-initdb.d mechanism (as the root user).
// Least privilege: the API and the backup job each get only what they need.
const appDb = process.env.MONGO_APP_DATABASE;

db.getSiblingDB(appDb).createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: appDb }],
});

db.getSiblingDB('admin').createUser({
  user: process.env.MONGO_BACKUP_USERNAME,
  pwd: process.env.MONGO_BACKUP_PASSWORD,
  roles: [
    { role: 'backup', db: 'admin' },
    { role: 'restore', db: 'admin' },
  ],
});

print(`init-users: created ${process.env.MONGO_APP_USERNAME} (readWrite on ${appDb}) and ${process.env.MONGO_BACKUP_USERNAME} (backup/restore)`);
