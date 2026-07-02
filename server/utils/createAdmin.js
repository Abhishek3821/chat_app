/**
 * Create (or promote) an ADMIN account — the sanctioned way to get an admin
 * without running the destructive seed script. Never exposed over HTTP.
 *
 * Usage (from /server, uses MONGO_URI from .env):
 *   node utils/createAdmin.js <email> <password> [name]
 *   node utils/createAdmin.js admin@chatconnect.app "StrongPass123!" "Site Admin"
 *
 * If the email already exists, the account is promoted to admin and the
 * password is reset to the one you passed (all old sessions are revoked).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

const [email, password, name = 'Admin'] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node utils/createAdmin.js <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

async function run() {
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ Could not connect to MongoDB. Check MONGO_URI in server/.env.');
    process.exit(1);
  }

  const existing = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (existing) {
    existing.role = 'admin';
    existing.password = password; // re-hashed by the pre-save hook
    existing.isVerified = true;
    existing.accountStatus = 'active';
    existing.tokenVersion = (existing.tokenVersion || 0) + 1; // revoke old sessions
    await existing.save();
    console.log(`✅ Existing account ${existing.email} promoted to ADMIN (password reset).`);
  } else {
    const username = `admin${Math.floor(1000 + Math.random() * 9000)}`;
    const user = await User.create({
      name,
      username,
      email,
      password, // hashed by the pre-save hook (bcrypt)
      role: 'admin',
      isVerified: true,
      avatar: `https://api.dicebear.com/9.x/glass/svg?seed=${username}`,
    });
    console.log(`✅ Admin account created: ${user.email} (username: ${user.username})`);
  }
  console.log('   Log in with this email + the password you just set, then change it in Settings if needed.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
