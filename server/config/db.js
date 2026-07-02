import mongoose from 'mongoose';
import dns from 'dns';

/**
 * Connect to MongoDB. The app will still boot without a DB connection
 * (useful for exploring the API surface / running the frontend in demo mode),
 * but real persistence requires a reachable MONGO_URI.
 */
export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn('⚠️  MONGO_URI not set — running without a database connection.');
    return null;
  }

  // Some networks (corporate / restrictive) run a DNS resolver that REFUSES the
  // SRV lookups that `mongodb+srv://` requires, producing `querySrv ECONNREFUSED`.
  // Point Node's resolver at public DNS that supports SRV. Override via DNS_SERVERS.
  if (uri.includes('+srv')) {
    const servers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      dns.setServers(servers);
    } catch {
      /* ignore — fall back to system DNS */
    }
  }

  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20000,
    });
    console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`❌ MongoDB connection error: ${err.message}`);
    console.error('   The server will keep running, but DB-backed routes will fail.');
    return null;
  }
}
