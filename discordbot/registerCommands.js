const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

function getCommandFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolvedPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getCommandFiles(resolvedPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(resolvedPath);
    }
  }
  return files;
}

function loadCommands(commandsPath = path.join(__dirname, 'commands')) {
  const commandFiles = getCommandFiles(commandsPath);
  const commands = new Map();

  for (const file of commandFiles) {
    const command = require(file);
    if (!command?.data || !command?.execute) continue;
    const name = command.data.name;
    if (commands.has(name)) {
      console.warn(`Duplicate command name detected: ${name}. Using definition from ${file}.`);
    }
    commands.set(name, command);
  }

  return commands;
}

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

module.exports = { loadCommands, registerCommands };
