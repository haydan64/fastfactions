const createDiscordBot = require('./discordbot/bot');
const createServer = require('./mc/server');
const eventBus = require('./eventBus');
const { runMigrations } = require('./database/database');

async function bootstrap() {
  const server = createServer();
  const bot = createDiscordBot();

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
