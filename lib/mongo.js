// Cached MongoDB connection, shared by the API functions and the CLI sync.
import { MongoClient } from 'mongodb';
import dns from 'dns';

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

let client = null;

// Same rule as the pharmacy app: MONGODB_DB if set, else the database named in
// the connection string, else formial-pharmacy.
export function dbNameFor(uri) {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : 'formial-pharmacy';
}

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
  }
  return client.db(dbNameFor(uri));
}

export async function closeDb() {
  if (client) await client.close();
  client = null;
}
