// Docker HEALTHCHECK for MongoDB (run with mongosh as root).
// 1. On first run the replica set is not initiated yet: initiate it, report unhealthy.
// 2. Report healthy only when this node is a writable PRIMARY, so the API never
//    starts against a database that cannot accept transactions.
try {
  rs.status();
} catch (e) {
  if (e.codeName === 'NotYetInitialized') {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: process.env.MONGO_REPLICA_HOST || 'mongo:27017' }] });
  }
  quit(1);
}
quit(db.hello().isWritablePrimary ? 0 : 1);
