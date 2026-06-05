const fs = require('fs');
const path = require('path');
const api = require("./api/web");
const { client, start } = require('./discordbot/bot');
const createServer = require('./mc/server');
const eventBus = require('./eventBus');
const { runMigrations } = require('./database/database');
require('dotenv').config();

function loadModules(context) {
  const modulesDir = path.join(__dirname, 'modules');
  if (!fs.existsSync(modulesDir)) return;

  for (const entry of fs.readdirSync(modulesDir)) {
    const fullPath = path.join(modulesDir, entry);
    if (path.extname(entry) !== '.js' || !fs.statSync(fullPath).isFile()) continue;

    const mod = require(fullPath);
    if (typeof mod === 'function') {
      mod(context);
    }
  }
}

async function bootstrap() {
  const server = createServer();

  loadModules({ server, client });

  await runMigrations();
  await start();
  await server.start();

  async function gracefulShutdown(reason, err) {
    if (err) {
      console.error(reason, err);
    }
    if (server.process) {
      eventBus.on(eventBus.EVENTS.SERVER_STATE, ({ state, message }) => {
        if (state === "stopped" && message === "Bedrock server stopped") {
          process.exit(0);
        }
      });
      console.log("Waiting for server to shut down correctly...")
      setTimeout(() => {
        console.log("Shutdown Timeout: Forcing Shutdown...")
        process.exit(0);
      }, 15000);
      await eventBus.request(eventBus.EVENTS.SERVER_COMMAND, { action: 'stop' }).catch((requestErr) => {
        console.error(`Shutdown stop request failed: ${requestErr.message}`);
      });
    } else {
      process.exit(0);
    }
  }

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on("uncaughtException", (err) => gracefulShutdown("uncaughtException", err));
  process.on("unhandledRejection", (reason) =>
    gracefulShutdown("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)))
  );
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
