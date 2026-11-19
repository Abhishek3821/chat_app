/**
 * Drop the throwaway databases the DB-backed test suites leave behind.
 *
 * Every suite derives an isolated `chatconnect_t_<name>` database from
 * MONGO_URI and drops it when it STARTS — but not when it ends. With ~30 suites
 * at ~22 collections each that is ~660 collections, past the 500-collection cap
 * of a shared/free Atlas cluster. The production database lives on the same
 * cluster, so once the cap is hit production can no longer create a collection
 * either ("cannot create a new collection -- already using 501 of 500").
 *
 * Run after the suites (CI does, with `if: always()`), or any time by hand:
 *   node tests/cleanup-test-dbs.mjs                 # every chatconnect_t_* db
 *   node tests/cleanup-test-dbs.mjs mtgmesh e2e     # just these
 *
 * Only names matching /^chatconnect_t_[a-z0-9]+$/ are ever touched, and the
 * database named in MONGO_URI itself is refused outright.
 */
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGO_URI || '';
if (!uri) {
  console.log('MONGO_URI not set — nothing to clean.');
  process.exit(0);
}
const TEST_DB = /^chatconnect_t_[a-z0-9]+$/;
const mainDb = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1] || '';
const only = process.argv.slice(2).map((n) => (n.startsWith('chatconnect_t_') ? n : `chatconnect_t_${n}`));

if (uri.includes('+srv')) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    /* noop */
  }
}

const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 20000 }).asPromise();
try {
  const { databases } = await conn.db.admin().listDatabases();
  const targets = databases
    .map((d) => d.name)
    .filter((n) => TEST_DB.test(n) && n !== mainDb && (!only.length || only.includes(n)));
  for (const name of targets) {
    await conn.useDb(name).dropDatabase();
    console.log(`  dropped ${name}`);
  }
  console.log(`${targets.length} test database(s) dropped.`);
} finally {
  await conn.close();
}
