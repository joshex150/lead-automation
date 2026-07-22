import mongoose from "mongoose";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Resilient MongoDB connection.
 *
 * - `connectDb`, one attempt (used by tests and the retry loop).
 * - `connectDbWithRetry`, keeps trying forever with capped backoff, so the
 *   API can boot (and serve /health + a 503 for data routes) while the
 *   database is still coming up, instead of crash-looping.
 * - The driver auto-reconnects after transient outages; `dbReady()` reports
 *   live state so routes can answer 503 instead of hanging or crashing.
 */

mongoose.set("strictQuery", true);
// Fail queries fast when disconnected (default is 10s of buffering).
mongoose.set("bufferTimeoutMS", 4000);

let connectedOnce = false;

mongoose.connection.on("disconnected", () => {
  if (connectedOnce) logger.warn("MongoDB disconnected, driver will keep retrying in the background");
});
mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectDb(uri: string = config.MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    // Detect a dead/frozen server quickly so readyState flips and data routes
    // fast-fail with 503 instead of hanging on a stuck socket.
    heartbeatFrequencyMS: 5000,
    socketTimeoutMS: 20000,
  });
  connectedOnce = true;
  logger.info({ db: conn.connection.name }, "MongoDB connected");
  return conn;
}

export async function connectDbWithRetry(
  uri: string = config.MONGODB_URI,
  opts: { maxDelayMs?: number; onConnected?: () => void } = {},
): Promise<void> {
  const maxDelay = opts.maxDelayMs ?? 30000;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await connectDb(uri);
      opts.onConnected?.();
      return;
    } catch (err) {
      attempt++;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), maxDelay);
      logger.error(
        { err: err instanceof Error ? err.message : String(err), attempt, retryInMs: delay },
        "MongoDB connection failed, retrying",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
