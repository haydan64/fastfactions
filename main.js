const fs = require('fs');
const path = require('path');
const createDiscordBot = require('./discordbot/bot');
const createServer = require('./mc/server');
const eventBus = require('./eventBus');
const { runMigrations } = require('./database/database');

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
  const bot = createDiscordBot();

  loadModules({ server, bot, eventBus });

  await runMigrations();
  await bot.start();
  await server.start();

  process.on('SIGINT', () => {
    eventBus.emit(eventBus.EVENTS.SERVER_COMMAND, { action: 'stop' });
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
