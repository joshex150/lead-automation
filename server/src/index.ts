import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { integrationStatus } from "./config/runtime.js";
import { connectDbWithRetry, disconnectDb } from "./db/connect.js";
import { getSettings } from "./models/Settings.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { logger } from "./utils/logger.js";

/**
 * Process entry. Hardened for unattended operation:
 *  - the HTTP server starts immediately; MongoDB connects (and re-connects)
 *    in the background, so a slow/absent DB never crash-loops the service;
 *  - unhandled rejections / uncaught exceptions are logged, not fatal,
 *    a single bad request or background hiccup must never take down the
 *    whole outreach workflow;
 *  - SIGINT/SIGTERM drain cleanly.
 */

async function main(): Promise<void> {
  const app = createApp();
  // Bind to 0.0.0.0 explicitly so the container is reachable by the platform's
  // health check and router (some environments don't route to the default host).
  const server = app.listen(config.PORT, "0.0.0.0", () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, "HTTP server listening on 0.0.0.0");
    if (!config.API_KEY) {
      logger.warn("API_KEY is not set, the API is UNAUTHENTICATED. Set API_KEY before deploying.");
    }
  });

  // Connect (retrying forever); once up, seed settings + start the scheduler.
  void connectDbWithRetry(config.MONGODB_URI, {
    onConnected: () => {
      void (async () => {
        try {
          await getSettings(); // ensure the settings singleton exists
          await startScheduler();
          const status = await integrationStatus();
          logger.info(
            {
              integrations: {
                googlePlaces: status.googlePlaces.configured,
                ai: `${status.ai.provider}${status.ai.configured ? "" : " (unconfigured)"}`,
                email: `${status.email.provider}${status.email.configured ? "" : " (unconfigured)"}`,
                auth: status.authEnabled,
              },
            },
            "YEAN lead-automation server ready",
          );
        } catch (err) {
          logger.error({ err: String(err) }, "post-connect initialisation failed (will still serve requests)");
        }
      })();
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopScheduler();
    server.close(async () => {
      await disconnectDb().catch(() => undefined);
      process.exit(0);
    });
    // Force-exit if close hangs.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Last-resort guards: log and carry on. Individual requests/jobs already
  // have their own error handling; these catch anything that slips through.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason instanceof Error ? reason.stack : String(reason) }, "unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err: err.stack ?? String(err) }, "uncaught exception, continuing");
  });
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.stack : String(err) }, "fatal startup error");
  process.exit(1);
});
