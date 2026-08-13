/**
 * Rename an account's email IN PLACE (used to move the admin off the old brand).
 *
 * Deliberately an in-place update rather than `createAdmin.js` with the new
 * address: that would create a SECOND admin and leave the old one live. Changing
 * the email keeps the same account — its role, chats, contacts, password and
 * sessions — and only changes the login identifier.
 *
 *   node utils/renameAdminEmail.js                       → report only
 *   node utils/renameAdminEmail.js --confirm             → apply
 *   node utils/renameAdminEmail.js --from a@b --to c@d   → explicit addresses
 *
 * Safety: refuses if the target address already belongs to a different account
 * (email is uniquely indexed, so the write would fail anyway — better to say why),
 * and never prints a password hash.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const FROM = (flag('--from') || 'admin@chatconnect.app').toLowerCase();
const TO = (flag('--to') || 'admin@chatkonect.app').toLowerCase();
const CONFIRM = argv.includes('--confirm');

const EMAIL_RE = /^\S+@\S+\.\S+$/;

async function run() {
  if (!EMAIL_RE.test(TO)) {
    console.error(`❌ "${TO}" is not a valid email address.`);
    process.exit(1);
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ Could not connect to MongoDB. Check MONGO_URI in server/.env.');
    process.exit(1);
  }
  console.log(`database: ${mongoose.connection.db.databaseName}\n`);

  const account = await User.findOne({ email: FROM }).select('name username email role accountStatus createdAt');
  if (!account) {
    console.log(`No account found with ${FROM}.`);
    // List admins so the operator can see what actually exists.
    const admins = await User.find({ role: 'admin' }).select('email username name').lean();
    if (admins.length) {
      console.log('\nAdmin accounts present:');
      for (const a of admins) console.log(`  · ${a.email}  (username: ${a.username}, name: ${a.name})`);
    } else {
      console.log('\nThere are no admin accounts at all — use utils/createAdmin.js to make one.');
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('Found:');
  console.log(`  name ......... ${account.name}`);
  console.log(`  username ..... ${account.username}`);
  console.log(`  email ........ ${account.email}`);
  console.log(`  role ......... ${account.role}`);
  console.log(`  status ....... ${account.accountStatus}`);

  const clash = await User.findOne({ email: TO }).select('_id username');
  if (clash && String(clash._id) !== String(account._id)) {
    console.error(`\n❌ ${TO} is already used by another account (username: ${clash.username}).`);
    console.error('   Email is uniquely indexed — resolve that account first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  if (clash) {
    console.log(`\nAlready ${TO} — nothing to do.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\n  ${FROM}  →  ${TO}`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --confirm to apply.');
    await mongoose.disconnect();
    process.exit(0);
  }

  account.email = TO;
  /* The password is NOT touched, so the admin signs in with the new address and
     their existing password. Sessions are left alone too: `protect` validates the
     session id, not the email, so nobody is logged out by this. */
  await account.save({ validateBeforeSave: false });

  const after = await User.findById(account._id).select('email role');
  console.log(`\n✅ Updated. Login email is now ${after.email} (role: ${after.role}).`);
  console.log('   Password unchanged; existing sessions remain valid.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('❌', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  process.exit(1);
});
