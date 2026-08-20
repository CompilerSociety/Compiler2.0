// lib/db/mongo.mjs
// Shared MongoDB connection for every Node entry point: the Vercel serverless
// functions in api/ and the Action scripts in scripts/.
//
// Why a cached client: a serverless function is frozen and thawed, not torn
// down, so a fresh MongoClient per invocation would leak a connection pool on
// every cold path and exhaust an Atlas M0's 500-connection cap within a day.
// The client promise is stashed on globalThis - module scope alone is not
// enough, because a bundler can instantiate the module more than once - and
// every warm invocation reuses the pool that is already open.
//
// Env:
//   MONGODB_URI  - Atlas connection string (required to use Mongo at all)
//   MONGODB_DB   - database name (optional, default "compiler2")
//
// If MONGODB_URI is unset, isEnabled() is false and callers decide what that
// means for them - see the failure policy at the top of repos.mjs. There is no
// JSON fallback any more: db/*.json was deleted and Mongo is the only store.

import { MongoClient } from 'mongodb';

const DEFAULT_DB = 'compiler2';

// A single symbol-keyed slot so two copies of this module still share one pool.
const CACHE_KEY = Symbol.for('compiler2.mongo.client');

export function isEnabled() {
  return Boolean(process.env.MONGODB_URI);
}

export function dbName() {
  return process.env.MONGODB_DB || DEFAULT_DB;
}

function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri, {
    // Fail fast instead of hanging a serverless request for 30s. Callers treat
    // a timeout as "Mongo unavailable" and fall back to JSON, so a slow
    // cluster degrades the site instead of stalling it.
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    // An M0 shared cluster allows 500 connections across ALL clients. Vercel
    // can hold many warm instances at once, so each keeps a small pool.
    maxPoolSize: 10,
    minPoolSize: 0,
    retryWrites: true,
  });
  return client.connect();
}

// Returns the connected Db, reusing the cached pool. Throws if MONGODB_URI is
// unset or the cluster cannot be reached - callers decide whether to fall back.
export async function getDb() {
  if (!globalThis[CACHE_KEY]) {
    globalThis[CACHE_KEY] = connect().catch((err) => {
      // Do not cache a failed connection: a transient DNS/network blip would
      // otherwise poison this instance until it is recycled.
      globalThis[CACHE_KEY] = null;
      throw err;
    });
  }
  const client = await globalThis[CACHE_KEY];
  return client.db(dbName());
}

// Convenience: getDb().collection(name), with the same failure semantics.
export async function collection(name) {
  const db = await getDb();
  return db.collection(name);
}

// Closes the pool. ONLY for short-lived scripts (migrations, Action jobs);
// serverless functions must never call this or they drop the warm pool.
export async function closeMongo() {
  const pending = globalThis[CACHE_KEY];
  if (!pending) return;
  globalThis[CACHE_KEY] = null;
  try {
    const client = await pending;
    await client.close();
  } catch { /* already closed or never opened */ }
}
