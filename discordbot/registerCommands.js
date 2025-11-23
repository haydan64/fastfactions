const path = require('path');
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./loadCommands');

async function registerCommands(commands) {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    console.warn('Missing Discord token, client ID, or guild ID. Commands will not be registered.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const payload = Array.from(commands.values()).map((cmd) => cmd.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const commands = loadCommands();
  await registerCommands(commands);
}

main().catch((err) => {
  console.error('Failed to register commands:', err);
  process.exitCode = 1;
});
