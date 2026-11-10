'use strict';

const { MongoMemoryReplSet } = require('mongodb-memory-server');

/**
 * Starts ONE real mongod as a single-node replica set for the whole test run.
 * A replica set is required because checkout uses multi-document transactions.
 * (Set MONGOMS_SYSTEM_BINARY to use an already-installed mongod.)
 */
module.exports = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.TEST_MONGO_URI = replSet.getUri();
};
