const fs = require('fs');
const path = require('path');

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

module.exports = { loadCommands };
