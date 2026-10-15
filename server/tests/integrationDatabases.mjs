import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

// Only these dedicated fixtures may be cleaned up. Never enumerate or remove
// databases from the cluster; the configured application database is refused.
export const integrationDatabases = {
  'embed-dropin.mjs': 'chatconnect_t_embeddrop',
  'embed-host-example.mjs': 'chatconnect_t_embedhost',
  'platform.mjs': 'chatconnect_t_platform',
  'platform-calls.mjs': 'chatconnect_t_pcalls',
  'embed-1to1-signalling.mjs': 'chatconnect_t_embed1to1',
  'meeting-room-realtime.mjs': 'chatconnect_t_mtgrt',
  'security-embed-origins.mjs': 'chatconnect_t_secorigin',
};
export async function cleanupIntegrationDatabase(suite) {
  const name = integrationDatabases[suite];
  if (!name) throw new Error('Unknown integration test database.');
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  const configured = process.env.MONGO_URI;
  if (!configured) throw new Error('MONGO_URI is required.');
  if (configured.includes('+srv')) dns.setServers(['8.8.8.8', '1.1.1.1']);
  const uri = new URL(configured);
  if (decodeURIComponent(uri.pathname.replace(/^\//, '')) === name) throw new Error('Refusing to delete the configured application database.');
  uri.pathname = '/' + name;
  const connection = await mongoose.createConnection(uri.href, { serverSelectionTimeoutMS: 20000 }).asPromise();
  try {
    if (connection.name !== name) throw new Error('Resolved database does not match the isolated fixture.');
    await connection.dropDatabase();
  } finally { await connection.close(); }
}
