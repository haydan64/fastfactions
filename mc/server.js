const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const eventBus = require('../eventBus');
const {
  upsertAllowlistEntry: dbUpsertAllowlistEntry,
  removeAllowlistEntry: dbRemoveAllowlistEntry,
  upsertPermission: dbUpsertPermission,
  updateMinecraftProfileXuid: dbUpdateMinecraftProfileXuid,
  getAllowlistEntries: dbGetAllowlistEntries,
  getServerPermissions: dbGetServerPermissions
} = require('../database/database');

const {
  EVENTS: { SERVER_LOG, SERVER_STATE, SERVER_COMMAND, SERVER_BACKUP }
} = eventBus;

const SERVER_ROOT = path.join(__dirname, 'bds');
const WORLD_NAME = 'Bedrock level';
const WORLD_PATH = path.join(SERVER_ROOT, 'worlds', WORLD_NAME);
const LINK_ADDON_PATH = path.join(__dirname, 'linkaddon');
const BEHAVIOR_ADDON_PATH = path.join(LINK_ADDON_PATH, 'behavior');
const RESOURCE_ADDON_PATH = path.join(LINK_ADDON_PATH, 'resource');
const BACKUP_PATH = path.join(__dirname, 'backups');
const DEFAULT_BINARY = path.join(
  SERVER_ROOT,
  process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'
);
const ALLOWLIST_PATH = path.join(SERVER_ROOT, 'allowlist.json');
const PERMISSIONS_PATH = path.join(SERVER_ROOT, 'permissions.json');

function safeJsonParse(filePath) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(contents);
  } catch (err) {
    return [];
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function updatePackList(manifest, fileName) {
  const filePath = path.join(WORLD_PATH, fileName);
  const packs = Array.isArray(safeJsonParse(filePath)) ? safeJsonParse(filePath) : [];
  const packId = manifest?.header?.uuid;
  const version = manifest?.header?.version;
  if (!packId || !version) return;

  const exists = packs.some((pack) => pack.pack_id === packId);
  if (!exists) {
    packs.push({ pack_id: packId, version });
  }
  writeJson(filePath, packs);
}

class BedrockServerController {
  constructor() {
    this.process = null;
    this.hasCrashed = false;
    eventBus.on(SERVER_COMMAND, (payload) =>
      this.handleExternalCommand(payload).catch((err) =>
        eventBus.emit(SERVER_LOG, { level: 'error', message: `Server command failed: ${err.message}` })
      )
    );
  }

  ensureDirectories() {
    fs.mkdirSync(WORLD_PATH, { recursive: true });
    fs.mkdirSync(BACKUP_PATH, { recursive: true });
  }

  async rebuildAllowlistFromDatabase() {
    try {
      const entries = await dbGetAllowlistEntries();
      const payload = entries.map((entry) => ({
        name: entry.name,
        xuid: entry.xuid || undefined,
        ignoresPlayerLimit: Boolean(entry.ignoresPlayerLimit)
      }));
      this.saveJson(ALLOWLIST_PATH, payload);
      eventBus.emit(SERVER_LOG, { level: 'info', message: 'Allowlist rebuilt from database.' });
    } catch (err) {
      eventBus.emit(SERVER_LOG, {
        level: 'error',
        message: `Failed to rebuild allowlist from database: ${err.message}`,
        important: true
      });
    }
  }

  async rebuildPermissionsFromDatabase() {
    try {
      const permissions = await dbGetServerPermissions();
      const payload = permissions.map((entry) => ({ xuid: entry.xuid, permission: entry.permission }));
      this.saveJson(PERMISSIONS_PATH, payload);
      eventBus.emit(SERVER_LOG, { level: 'info', message: 'Permissions rebuilt from database.' });
    } catch (err) {
      eventBus.emit(SERVER_LOG, {
        level: 'error',
        message: `Failed to rebuild permissions from database: ${err.message}`,
        important: true
      });
    }
  }

  ensureLinkAddon() {
    const behaviorManifestPath = path.join(BEHAVIOR_ADDON_PATH, 'manifest.json');
    const resourceManifestPath = path.join(RESOURCE_ADDON_PATH, 'manifest.json');
    const behaviorManifest = fs.existsSync(behaviorManifestPath)
      ? JSON.parse(fs.readFileSync(behaviorManifestPath, 'utf8'))
      : null;
    const resourceManifest = fs.existsSync(resourceManifestPath)
      ? JSON.parse(fs.readFileSync(resourceManifestPath, 'utf8'))
      : null;

    const worldAddonPath = path.join(WORLD_PATH, 'behavior_packs', 'linkaddon');
    const worldResourcePath = path.join(WORLD_PATH, 'resource_packs', 'linkaddon');
    copyRecursive(BEHAVIOR_ADDON_PATH, worldAddonPath);
    copyRecursive(RESOURCE_ADDON_PATH, worldResourcePath);

    if (behaviorManifest) {
      updatePackList(behaviorManifest, 'world_behavior_packs.json');
    }
    if (resourceManifest) {
      updatePackList(resourceManifest, 'world_resource_packs.json');
    }
  }

  loadJson(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      eventBus.emit(SERVER_LOG, { level: 'error', message: `Failed to parse ${filePath}: ${err.message}` });
      return fallback;
    }
  }

  saveJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  async updateAllowlist({ name, xuid, ignoresPlayerLimit = false }) {
    if (!name) return;
    const existing = this.loadJson(ALLOWLIST_PATH, []);
    const withoutName = existing.filter((entry) => entry.name?.toLowerCase() !== name.toLowerCase());
    const updated = [
      ...withoutName,
      { name, xuid: xuid || undefined, ignoresPlayerLimit: Boolean(ignoresPlayerLimit) }
    ];
    this.saveJson(ALLOWLIST_PATH, updated);
    await dbUpsertAllowlistEntry({ name, xuid, ignoresPlayerLimit });
    if (this.process) {
      this.sendCommand('allowlist reload');
    }
    eventBus.emit(SERVER_LOG, { level: 'info', message: `Allowlist updated for ${name}`, important: true });
  }

  async removeAllowlist(name) {
    if (!name) return;
    const existing = this.loadJson(ALLOWLIST_PATH, []);
    const filtered = existing.filter((entry) => entry.name?.toLowerCase() !== name.toLowerCase());
    this.saveJson(ALLOWLIST_PATH, filtered);
    await dbRemoveAllowlistEntry(name);
    if (this.process) {
      this.sendCommand('allowlist reload');
    }
    eventBus.emit(SERVER_LOG, { level: 'info', message: `Allowlist entry removed for ${name}`, important: true });
  }

  async setPermission({ xuid, permission }) {
    const valid = ['operator', 'member', 'visitor'];
    if (!xuid || !valid.includes(permission)) {
      eventBus.emit(SERVER_LOG, {
        level: 'warn',
        message: `Invalid permission payload (xuid=${xuid}, permission=${permission})`
      });
      return;
    }
    const existing = this.loadJson(PERMISSIONS_PATH, []);
    const without = existing.filter((entry) => entry.xuid !== xuid);
    const updated = [...without, { xuid, permission }];
    this.saveJson(PERMISSIONS_PATH, updated);
    await dbUpsertPermission({ xuid, permission });
    if (this.process) {
      this.sendCommand('permission reload');
    }
    eventBus.emit(SERVER_LOG, {
      level: 'info',
      message: `Permissions updated for XUID ${xuid} -> ${permission}`,
      important: true
    });
  }

  async start(binaryPath = process.env.BDS_BINARY || DEFAULT_BINARY) {
    this.ensureDirectories();
    this.ensureLinkAddon();
    await this.rebuildAllowlistFromDatabase();
    await this.rebuildPermissionsFromDatabase();

    if (!fs.existsSync(binaryPath)) {
      const message = `Bedrock server binary missing at ${binaryPath}`;
      eventBus.emit(SERVER_STATE, { state: 'missing', message, important: true });
      return;
    }

    if (this.process) {
      eventBus.emit(SERVER_STATE, { state: 'running', message: 'Server already running' });
      return;
    }

    eventBus.emit(SERVER_STATE, { state: 'starting', message: 'Starting Bedrock server', important: true });

    const spawnEnv = { ...process.env };
    if (process.platform !== 'win32') {
      spawnEnv.LD_LIBRARY_PATH = SERVER_ROOT;
    }
    const spawnOptions = { cwd: SERVER_ROOT, env: spawnEnv };
    if (process.platform === 'win32') {
      spawnOptions.shell = true;
    }

    const command = process.platform === 'win32' ? `"${binaryPath}"` : binaryPath;
    this.process = spawn(command, [], spawnOptions);

    this.process.stdout.on('data', (data) => {
      data
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => this.handleLogLine(line));
    });

    this.process.stderr.on('data', (data) => {
      const line = data.toString();
      this.handleLogLine(line, 'error');
    });

    this.process.on('error', (err) => {
      eventBus.emit(SERVER_STATE, {
        state: 'error',
        message: `Bedrock server failed to launch: ${err.message}`,
        important: true
      });
      this.process = null;
    });

    this.process.on('exit', (code, signal) => {
      const crashed = code !== 0 && signal !== 'SIGTERM';
      const message = crashed
        ? `Bedrock server crashed with code ${code || 'unknown'}`
        : 'Bedrock server stopped';
      eventBus.emit(SERVER_STATE, { state: 'stopped', message, important: true });
      if (crashed) {
        eventBus.emit(SERVER_LOG, { level: 'error', message, important: true });
      }
      this.process = null;
    });
  }

  stop() {
    if (!this.process) {
      eventBus.emit(SERVER_STATE, { state: 'stopped', message: 'Server not running' });
      return;
    }
    eventBus.emit(SERVER_STATE, { state: 'stopping', message: 'Stopping Bedrock server', important: true });
    this.process.kill('SIGTERM');
  }

  forceStop() {
    if (!this.process) {
      eventBus.emit(SERVER_STATE, { state: 'stopped', message: 'Server not running' });
      return;
    }
    eventBus.emit(SERVER_STATE, { state: 'stopping', message: 'Force-stopping Bedrock server', important: true });
    this.process.kill('SIGKILL');
  }

  async restart() {
    this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return this.start();
  }

  async backup() {
    this.ensureDirectories();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(BACKUP_PATH, `backup-${timestamp}`);
    copyRecursive(WORLD_PATH, destination);
    const message = `World backup created at ${destination}`;
    eventBus.emit(SERVER_BACKUP, { path: destination, message, important: true });
    eventBus.emit(SERVER_LOG, { level: 'info', message });
  }

  async update(details = 'Manual update triggered') {
    eventBus.emit(SERVER_LOG, { level: 'info', message: `Update requested: ${details}` });
  }

  sendCommand(command) {
    if (!this.process) {
      eventBus.emit(SERVER_LOG, { level: 'warn', message: `Cannot send command, server offline: ${command}` });
      return;
    }
    this.process.stdin.write(`${command}\n`);
    eventBus.emit(SERVER_LOG, { level: 'info', message: `Sent command: ${command}` });
  }

  handleLogLine(line, level = 'info') {
    const normalized = line.trim();
    if (normalized) {
      console.log(`[BDS] ${normalized}`);
    }
    const importantPatterns = [
      { regex: /server (start|starting)/i, reason: 'Server starting' },
      { regex: /server stop/i, reason: 'Server stopping' },
      { regex: /crash/i, reason: 'Server crash detected' },
      { regex: /whitelist/i, reason: 'Whitelist change' },
      { regex: /opped/i, reason: 'Operator change' },
      { regex: /de-?opped/i, reason: 'Operator removed' }
    ];

    const important = importantPatterns.some((pattern) => pattern.regex.test(normalized));
    eventBus.emit(SERVER_LOG, { level, message: normalized, important });

    const playerJoinMatch = normalized.match(/Player connected:\s*([^,]+),\s*xuid:\s*([\w-]+)/i);
    if (playerJoinMatch) {
      const [, username, xuid] = playerJoinMatch;
      dbUpdateMinecraftProfileXuid(username, xuid).catch((err) => {
        console.error(`Failed to update XUID for ${username}: ${err.message}`);
      });
    }

    if (/server (start|started)/i.test(normalized)) {
      eventBus.emit(SERVER_STATE, { state: 'running', message: 'Bedrock server is online', important: true });
    }
    if (/server stop/i.test(normalized)) {
      eventBus.emit(SERVER_STATE, { state: 'stopping', message: 'Bedrock server stopping', important: true });
    }
    if (/crash/i.test(normalized)) {
      eventBus.emit(SERVER_STATE, { state: 'crashed', message: normalized, important: true });
    }
  }

  async handleExternalCommand(payload = {}) {
    const { action, command } = payload;
    switch (action) {
      case 'restart':
        return this.restart();
      case 'stop':
        return this.stop();
      case 'force-stop':
        return this.forceStop();
      case 'start':
        return this.start();
      case 'backup':
        return this.backup();
      case 'update':
        return this.update(payload.details);
      case 'command':
        return this.sendCommand(command);
      case 'allowlist:add':
        return this.updateAllowlist(payload);
      case 'allowlist:remove':
        return this.removeAllowlist(payload.name);
      case 'permission:set':
        return this.setPermission(payload);
      default:
        eventBus.emit(SERVER_LOG, { level: 'warn', message: `Unknown server command: ${action}` });
    }
  }
}

module.exports = function createServer() {
  return new BedrockServerController();
};
