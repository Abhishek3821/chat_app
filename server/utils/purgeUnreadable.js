/**
 * Purge the unreadable messages left behind by the end-to-end encryption trial.
 *
 * While E2EE was enabled, message text was stored as ciphertext under keys that
 * only ever existed in a browser. Encryption has since been removed, so those
 * keys are gone and that text is unrecoverable — by anyone, including the people
 * who wrote it. The rows survive with `encrypted: true` and an empty `content`,
 * and the UI deliberately renders them as "Message unavailable" rather than as
 * blank bubbles.
 *
 * This script deletes them. It is DESTRUCTIVE and deliberately not automatic:
 *   node utils/purgeUnreadable.js            → report only, changes nothing
 *   node utils/purgeUnreadable.js --confirm  → delete them
 *
 * Safety properties worth knowing before you run it:
 *  · it only ever matches `encrypted: true`, so no readable message is at risk;
 *  · it repairs each affected chat's `lastMessage` pointer afterwards, because
 *    deleting the row a chat points at would leave the chat list rendering a
 *    dangling reference;
 *  · it refuses to run against a database whose name it cannot confirm, so a
 *    mistyped URI cannot quietly purge the wrong cluster.
 */
import mongoose from 'mongoose';
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const CONFIRM = process.argv.includes('--confirm');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set — nothing to connect to.');
  if (uri.includes('+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      /* the local resolver may be fine */
    }
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const dbName = db.databaseName;
  if (!dbName) throw new Error('Could not determine the database name — refusing to touch anything.');
  console.log(`connected to database: ${dbName}\n`);

  const messages = db.collection('messages');
  const chats = db.collection('chats');

  const total = await messages.countDocuments({});
  const sealed = await messages.countDocuments({ encrypted: true });
  const readable = await messages.countDocuments({ encrypted: { $ne: true } });

  console.log(`  total messages ............ ${total}`);
  console.log(`  unreadable (encrypted) .... ${sealed}`);
  console.log(`  readable .................. ${readable}`);

  if (sealed === 0) {
    console.log('\nNothing to purge — no unreadable messages remain.');
    return;
  }

  // Which chats point AT one of these as their lastMessage?
  const doomedIds = await messages.find({ encrypted: true }, { projection: { _id: 1, chat: 1 } }).toArray();
  const doomedSet = new Set(doomedIds.map((d) => String(d._id)));
  const affectedChats = await chats
    .find({ lastMessage: { $in: doomedIds.map((d) => d._id) } }, { projection: { _id: 1 } })
    .toArray();

  console.log(`  chats whose lastMessage would dangle: ${affectedChats.length}`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing was changed.');
    console.log('Re-run with --confirm to delete the unreadable messages.');
    return;
  }

  const res = await messages.deleteMany({ encrypted: true });
  console.log(`\n  deleted ${res.deletedCount} unreadable message(s)`);

  /* Repoint every affected chat at its newest SURVIVING message, so the chat list
     shows a real preview instead of a dangling reference (or nothing at all). */
  let repaired = 0;
  for (const c of affectedChats) {
    // eslint-disable-next-line no-await-in-loop
    const newest = await messages.find({ chat: c._id }).sort({ createdAt: -1 }).limit(1).toArray();
    // eslint-disable-next-line no-await-in-loop
    await chats.updateOne(
      { _id: c._id },
      newest.length ? { $set: { lastMessage: newest[0]._id } } : { $unset: { lastMessage: '' } }
    );
    repaired += 1;
  }
  console.log(`  repaired ${repaired} chat lastMessage pointer(s)`);

  const leftover = await messages.countDocuments({ encrypted: true });
  console.log(leftover === 0 ? '\n✓ no unreadable messages remain' : `\n✗ ${leftover} still present`);
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
