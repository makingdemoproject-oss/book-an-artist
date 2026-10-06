'use strict';

const config = require('./config/env');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { pingMysql, closeMysql } = require('./db/sequelize');
require('./models/sql'); // register Sequelize models + associations at boot
const { connectMongo, disconnectMongo } = require('./db/mongo');

let server = null;
let shuttingDown = false;

/**
 * Graceful shutdown:
 *  1. flip readiness to 503 so the load balancer stops sending new traffic,
 *  2. stop accepting connections and let in-flight requests finish,
 *  3. close idle keep-alive sockets,
 *  4. close DB pools,
 *  5. exit — or force-exit if draining exceeds SHUTDOWN_TIMEOUT_MS.
 * Idempotent: a second signal while draining is ignored.
 */
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'shutdown started');

  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: config.server.shutdownTimeoutMs }, 'shutdown timed out, forcing exit');
    process.exit(1);
  }, config.server.shutdownTimeoutMs);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) logger.warn({ err }, 'error while closing HTTP server');
          resolve();
        });
        server.closeIdleConnections();
      });
      logger.info('HTTP server closed, in-flight requests drained');
    }

    const results = await Promise.allSettled([closeMysql(), disconnectMongo()]);
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => logger.warn({ err: r.reason }, 'error while closing a database connection'));
    logger.info('database connections closed');
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    exitCode = 1; // eslint-disable-line no-param-reassign
  } finally {
    clearTimeout(forceExit);
    logger.info({ exitCode }, 'shutdown complete');
    process.exit(exitCode);
  }
}

// ── Process-level safety nets ───────────────────────────────────
// An unhandled rejection or uncaught exception means a bug left the process in an unknown state.
// We log it with full context, then shut down gracefully and exit non-zero so the supervisor
// (PM2 / Docker / Kubernetes) starts a fresh instance — rather than limping on with corrupted state.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandledRejection');
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin }, 'uncaughtException');
  shutdown('uncaughtException', 1);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  // Fail fast if either database is unreachable.
  await pingMysql();
  await connectMongo();

  const app = createApp({ isShuttingDown: () => shuttingDown });
  server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'book-an-artist API listening');
  });

  // Slow-client protection and keep-alive tuning (keepAlive must exceed the LB's idle timeout).
  server.requestTimeout = config.server.requestTimeoutMs;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;

  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    shutdown('serverError', 1);
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  shutdown('startupFailure', 1);
});
