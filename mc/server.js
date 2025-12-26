const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const eventBus = require('../eventBus');
const {
  upsertAllowlistEntry: dbUpsertAllowlistEntry,
  removeAllowlistEntry: dbRemoveAllowlistEntry,
  upsertPermission: dbUpsertPermission,
  updateMinecraftProfileXuid: dbUpdateMinecraftProfileXuid,
  getAllowlistEntries,
  getServerPermissions
} = require('../database/database');

const {
  EVENTS: { SERVER_LOG, SERVER_STATE, SERVER_COMMAND, SERVER_BACKUP, MINECRAFT_EVENT }
} = eventBus;

const SERVER_ROOT = path.join(__dirname, 'bds');
const WORLD_NAME = 'Bedrock level';
const WORLD_PATH = path.join(SERVER_ROOT, 'worlds', WORLD_NAME);
const LINK_ADDON_PATH = path.join(__dirname, 'linkaddon');
const BEHAVIOR_ADDON_PATH = path.join(LINK_ADDON_PATH, 'behavior');
const RESOURCE_ADDON_PATH = path.join(LINK_ADDON_PATH, 'resource');
const BACKUP_PATH = path.join(__dirname, 'backups');
const SERVER_STATE_FOLDER = 'server state';
const DEFAULT_BINARY = path.join(
  SERVER_ROOT,
  process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'
);
const ALLOWLIST_PATH = path.join(SERVER_ROOT, 'allowlist.json');
const PERMISSIONS_PATH = path.join(SERVER_ROOT, 'permissions.json');
const SERVER_PROPERTIES_PATH = path.join(SERVER_ROOT, 'server.properties');
const SERVER_CONFIG_PATH = path.join(SERVER_ROOT, 'config');

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

function readPackEntry(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const packId = manifest?.header?.uuid;
    const version = manifest?.header?.version;
    if (packId && version) {
      return { pack_id: packId, version };
    }
  } catch (err) {
    eventBus.emit(SERVER_LOG, {
      level: 'error',
      message: `Failed to parse pack manifest ${manifestPath}: ${err.message}`
    });
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureParentDirectory(dest);
  fs.copyFileSync(src, dest);
}

function collectPackEntries(packRoot) {
  const packs = [];
  if (!fs.existsSync(packRoot)) return packs;

  for (const entry of fs.readdirSync(packRoot)) {
    const manifestPath = path.join(packRoot, entry, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const packEntry = readPackEntry(manifestPath);
    if (packEntry) {
      packs.push(packEntry);
    }
  }
  return packs;
}

function syncPackList(packRoot, fileName) {
  const filePath = path.join(WORLD_PATH, fileName);
  const installedPacks = collectPackEntries(packRoot);
  writeJson(filePath, installedPacks);
}

class BedrockServerController {
  constructor() {
    this.process = null;
    this.hasCrashed = false;
    this.lastLogLevel = 'info';
    eventBus.on(SERVER_COMMAND, (payload) =>
      this.handleExternalCommand(payload).catch((err) =>
        eventBus.emit(SERVER_LOG, { level: 'error', message: `Server command failed: ${err.message}` })
      )
    );
  }

  cleanLogMessage(message = '') {
    return message.replace(/^NO LOG FILE!\s*-\s*/i, '').replace(/^.*?INFO]\s*/i, '').trim();
  }

  waitForLogMatch(predicate, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        eventBus.off(SERVER_LOG, onLog);
        reject(new Error('Timed out waiting for server response'));
      }, timeout);

      const onLog = (payload = {}) => {
        try {
          const result = predicate(payload.message || '');
          if (result) {
            clearTimeout(timer);
            eventBus.off(SERVER_LOG, onLog);
            resolve(result);
          }
        } catch (err) {
          clearTimeout(timer);
          eventBus.off(SERVER_LOG, onLog);
          reject(err);
        }
      };

      eventBus.on(SERVER_LOG, onLog);
    });
  }

  parseBackupListing(line = '') {
    const cleaned = this.cleanLogMessage(line);
    return cleaned
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [filePath, length] = entry.split(':');
        return {
          filePath: filePath?.trim(),
          length: Number.parseInt(length?.trim(), 10)
        };
      })
      .filter((entry) => entry.filePath && Number.isFinite(entry.length));
  }

  async fetchBackupManifest() {
    const deadline = Date.now() + 20000;

    while (Date.now() < deadline) {
      this.sendCommand('save query');

      const listing = await this.waitForLogMatch((message) => {
        if (/files are now ready to be copied/i.test(this.cleanLogMessage(message))) {
          return null;
        }

        const parsed = this.parseBackupListing(message);
        return parsed.length ? parsed : null;
      }, Math.max(1000, deadline - Date.now())).catch(() => null);

      if (listing?.length) {
        return listing;
      }

      await delay(1000);
    }

    throw new Error('Timed out waiting for Bedrock backup manifest');
  }

  copyManifestFiles(manifest = [], destinationRoot) {
    fs.mkdirSync(destinationRoot, { recursive: true });

    for (const { filePath, length } of manifest) {
      const source = path.join(SERVER_ROOT, 'worlds', filePath);
      const destination = path.join(destinationRoot, filePath);

      if (!fs.existsSync(source)) {
        eventBus.emit(SERVER_LOG, {
          level: 'warn',
          message: `Backup file missing, skipping: ${filePath}`
        });
        continue;
      }

      ensureParentDirectory(destination);
      fs.copyFileSync(source, destination);
      if (Number.isFinite(length)) {
        fs.truncateSync(destination, length);
      }
    }
  }

  copyWorldExtras(destinationRoot) {
    const worldDestination = path.join(destinationRoot, WORLD_NAME);
    const worldSources = [
      path.join(WORLD_PATH, 'world_icon.jpeg'),
      path.join(WORLD_PATH, 'world_behavior_packs.json'),
      path.join(WORLD_PATH, 'world_resource_packs.json')
    ];

    for (const src of worldSources) {
      const dest = path.join(worldDestination, path.basename(src));
      copyIfExists(src, dest);
    }

    copyRecursive(path.join(WORLD_PATH, 'behavior_packs'), path.join(worldDestination, 'behavior_packs'));
    copyRecursive(path.join(WORLD_PATH, 'resource_packs'), path.join(worldDestination, 'resource_packs'));
  }

  copyServerState(destinationRoot) {
    const serverStatePath = path.join(destinationRoot, SERVER_STATE_FOLDER);
    copyIfExists(ALLOWLIST_PATH, path.join(serverStatePath, 'allowlist.json'));
    copyIfExists(PERMISSIONS_PATH, path.join(serverStatePath, 'permissions.json'));
    copyIfExists(SERVER_PROPERTIES_PATH, path.join(serverStatePath, 'server.properties'));
    copyRecursive(SERVER_CONFIG_PATH, path.join(serverStatePath, 'config'));
  }

  async performOnlineBackup(worldDestination) {
    this.sendCommand('save hold');
    try {
      const manifest = await this.fetchBackupManifest();
      this.copyManifestFiles(manifest, worldDestination);
    } finally {
      this.sendCommand('save resume');
    }
  }

  ensureDirectories() {
    fs.mkdirSync(WORLD_PATH, { recursive: true });
    fs.mkdirSync(BACKUP_PATH, { recursive: true });
  }

  ensureLinkAddon() {
    const worldAddonPath = path.join(WORLD_PATH, 'behavior_packs', 'linkaddon');
    const worldResourcePath = path.join(WORLD_PATH, 'resource_packs', 'linkaddon');
    copyRecursive(BEHAVIOR_ADDON_PATH, worldAddonPath);
    copyRecursive(RESOURCE_ADDON_PATH, worldResourcePath);

    syncPackList(path.join(WORLD_PATH, 'behavior_packs'), 'world_behavior_packs.json');
    syncPackList(path.join(WORLD_PATH, 'resource_packs'), 'world_resource_packs.json');
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

  async syncServerConfigFromDatabase() {
    try {
      const allowlistEntries = await getAllowlistEntries();
      const formattedAllowlist = allowlistEntries.map((entry) => ({
        name: entry.name,
        xuid: entry.xuid || undefined,
        ignoresPlayerLimit: Boolean(entry.ignores_player_limit)
      }));
      this.saveJson(ALLOWLIST_PATH, formattedAllowlist);

      const permissions = await getServerPermissions();
      const formattedPermissions = permissions.map(({ xuid, permission }) => ({ xuid, permission }));
      this.saveJson(PERMISSIONS_PATH, formattedPermissions);

      eventBus.emit(SERVER_LOG, {
        level: 'info',
        message: 'Synced allowlist and permissions from database before starting BDS.'
      });
    } catch (err) {
      eventBus.emit(SERVER_LOG, {
        level: 'error',
        message: `Failed to sync server config from database: ${err.message}`,
        important: true
      });
      throw err;
    }
  }

  async start(binaryPath = process.env.BDS_BINARY || DEFAULT_BINARY) {
    this.ensureDirectories();
    this.ensureLinkAddon();

    try {
      await this.syncServerConfigFromDatabase();
    } catch (err) {
      eventBus.emit(SERVER_STATE, {
        state: 'error',
        message: 'Unable to start BDS because configuration sync failed.',
        important: true
      });
      return;
    }

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
      return Promise.resolve();
    }

    const currentProcess = this.process;
    let stopTimeout;
    const awaitExit = new Promise((resolve) => {
      currentProcess.once('exit', () => {
        clearTimeout(stopTimeout);
        resolve();
      });
    });

    eventBus.emit(SERVER_STATE, { state: 'stopping', message: 'Stopping Bedrock server', important: true });

    // Ask the server to stop gracefully first to ensure worlds are saved.
    this.sendCommand('stop');

    stopTimeout = setTimeout(() => {
      eventBus.emit(SERVER_LOG, {
        level: 'warn',
        message: 'Graceful stop timed out; force killing Bedrock server'
      });
      currentProcess.kill('SIGKILL');
    }, 10000);

    return awaitExit;
  }

  forceStop() {
    if (!this.process) {
      eventBus.emit(SERVER_STATE, { state: 'stopped', message: 'Server not running' });
      return Promise.resolve();
    }

    const currentProcess = this.process;
    const awaitExit = new Promise((resolve) => {
      currentProcess.once('exit', () => resolve());
    });

    eventBus.emit(SERVER_STATE, { state: 'stopping', message: 'Force stopping Bedrock server', important: true });
    currentProcess.kill('SIGKILL');

    return awaitExit;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async backup() {
    this.ensureDirectories();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(BACKUP_PATH, `backup-${timestamp}`);
    const worldDestination = path.join(destination, 'worlds');

    fs.mkdirSync(destination, { recursive: true });

    try {
      if (this.process) {
        await this.performOnlineBackup(worldDestination);
      } else {
        copyRecursive(WORLD_PATH, path.join(worldDestination, WORLD_NAME));
      }
    } catch (err) {
      eventBus.emit(SERVER_LOG, {
        level: 'error',
        message: `Online backup failed (${err.message}). Falling back to offline copy.`,
        important: true
      });
      copyRecursive(WORLD_PATH, path.join(worldDestination, WORLD_NAME));
    }

    this.copyWorldExtras(worldDestination);
    this.copyServerState(destination);

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

  parseJsonPayload(normalized = '') {
    const jsonMatch = normalized.match(/\{.*\}$/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      eventBus.emit(SERVER_LOG, {
        level: 'warn',
        message: `Failed to parse JSON from log line: ${err.message} | ${normalized}`
      });
      return null;
    }
  }

  handleLogLine(line, level = 'info') {
    const raw = (line || '').trim();
    if (!raw) return;

    console.log(`[BDS] ${raw}`);

    const timestampMatch = raw.match(/^\[BDS\]\s*\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}:\d{3})\s+([A-Z]+)\]\s*(.*)$/);

    let normalized;
    let derivedLevel = level;

    if (timestampMatch) {
      const [, , severity, rest] = timestampMatch;
      normalized = rest.trim();
      derivedLevel = (severity || '').toLowerCase() || level;
      this.lastLogLevel = derivedLevel;
    } else {
      normalized = raw.replace(/^\[BDS\]\s*/i, '').trim();
      derivedLevel = this.lastLogLevel || level;
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
    eventBus.emit(SERVER_LOG, { level: derivedLevel, message: normalized, important });

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

    if (normalized.startsWith('INFO] [Scripting] [MCLINK] [Chat Sent]')) {
      const payload = this.parseJsonPayload(normalized.replace('INFO] [Scripting] [MCLINK] [Chat Sent]', ''));
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'chatSent', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [PLAYER GAMEMODE CHANGE]')) {
      const payload = this.parseJsonPayload(
        normalized.replace('INFO] [Scripting] [MCLINK] [PLAYER GAMEMODE CHANGE]', '')
      );
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'playerGamemodeChange', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [PLAYER PLACE BLOCK]')) {
      const payload = this.parseJsonPayload(
        normalized.replace('INFO] [Scripting] [MCLINK] [PLAYER PLACE BLOCK]', '')
      );
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'playerPlaceBlock', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [PLAYER BREAK BLOCK]')) {
      const payload = this.parseJsonPayload(
        normalized.replace('INFO] [Scripting] [MCLINK] [PLAYER BREAK BLOCK]', '')
      );
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'playerBreakBlock', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK][EFFECT ADDED]')) {
      const payload = this.parseJsonPayload(normalized.replace('INFO] [Scripting] [MCLINK][EFFECT ADDED]', ''));
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'effectAdded', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [GAMERULE CHANGED]')) {
      const payload = this.parseJsonPayload(normalized.replace('INFO] [Scripting] [MCLINK] [GAMERULE CHANGED]', ''));
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'gameruleChanged', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [PLAYER DIMENSION CHANGE]')) {
      const payload = this.parseJsonPayload(
        normalized.replace('INFO] [Scripting] [MCLINK] [PLAYER DIMENSION CHANGE]', '')
      );
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'playerDimensionChange', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [ENTITY DIED]')) {
      const payload = this.parseJsonPayload(normalized.replace('INFO] [Scripting] [MCLINK] [ENTITY DIED]', ''));
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'entityDied', content: payload, raw: normalized });
      }
    } else if (normalized.startsWith('INFO] [Scripting] [MCLINK] [PLAYER LIST]')) {
      const payload = this.parseJsonPayload(normalized.replace('INFO] [Scripting] [MCLINK] [PLAYER LIST]', ''));
      if (payload) {
        eventBus.emit(MINECRAFT_EVENT, { event: 'playerList', content: payload, raw: normalized });
      }
    }
  }

  async handleExternalCommand(payload = {}) {
    const { action, command } = payload;
    switch (action) {
      case 'restart':
        return this.restart();
      case 'stop':
        return this.stop();
      case 'forceStop':
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
