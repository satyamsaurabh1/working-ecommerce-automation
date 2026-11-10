// Prints {"collection": count, ...} for the app database as one JSON line.
// Used by backup.ps1 (manifest) and restore.ps1 (verification).
const target = db.getSiblingDB(process.env.MONGO_APP_DATABASE || 'ecommerce');
const counts = {};
for (const name of target.getCollectionNames().sort()) counts[name] = target.getCollection(name).countDocuments();
print(JSON.stringify(counts));
