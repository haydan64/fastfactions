const eventBus = require('../eventBus');

const MAX_LOGS = 5000;
const logs = [];
const state = {
  bds: {
    state: 'unknown',
    message: 'No server state event has been received yet.',
    updatedAt: null
  },
  bot: {
    ready: false,
    tag: null,
    id: null,
    guilds: 0,
    updatedAt: null
  }
};

function now() {
  return new Date().toISOString();
}

function cleanPayload(payload) {
  if (payload instanceof Error) {
    return { name: payload.name, message: payload.message, stack: payload.stack };
  }
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return String(payload);
  }
}

function summarize(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (payload.message) return String(payload.message);
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function inferCategory(source, event, message, payload) {
  const text = `${event || ''} ${message || ''}`.toLowerCase();
  if (text.includes('[enclave_home]')) return 'home';
  if (source === 'discord' || text.includes('discord')) return 'discord';
  if (event === 'entityDied') return 'death';
  if (source === 'minecraft') return 'minecraft';
  if (source === 'server-state') return 'status';
  if (text.includes('faction')) return 'faction';
  if (payload?.important) return 'important';
  return source || 'system';
}

function addLog({ source, event, level = 'info', message, payload, raw }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: now(),
    source,
    event: event || null,
    category: inferCategory(source, event, message, payload),
    level,
    message: message || summarize(payload) || raw || '',
    payload: cleanPayload(payload),
    raw: raw || null
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  return entry;
}

function patchConsole() {
  if (console.__fastFactionsLogStorePatched) return;
  console.__fastFactionsLogStorePatched = true;

  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      addLog({
        source: 'console',
        level,
        message: args.map((arg) => typeof arg === 'string' ? arg : summarize(cleanPayload(arg))).join(' '),
        payload: args.map(cleanPayload)
      });
    };
  }
}

function registerEventListeners() {
  eventBus.on(eventBus.EVENTS.SERVER_LOG, (payload = {}) => {
    addLog({
      source: 'server',
      event: 'SERVER_LOG',
      level: payload.level || 'info',
      message: payload.message,
      payload
    });
  });

  eventBus.on(eventBus.EVENTS.SERVER_STATE, (payload = {}) => {
    state.bds = {
      state: payload.state || 'unknown',
      message: payload.message || '',
      updatedAt: now()
    };
    addLog({
      source: 'server-state',
      event: 'SERVER_STATE',
      level: payload.state === 'error' ? 'error' : 'info',
      message: payload.message,
      payload
    });
  });

  eventBus.on(eventBus.EVENTS.MINECRAFT_EVENT, ({ event, content, raw } = {}) => {
    addLog({
      source: 'minecraft',
      event,
      message: summarize(content) || event,
      payload: content,
      raw
    });
  });

  eventBus.on(eventBus.EVENTS.DISCORD_EVENT, ({ event, content } = {}) => {
    addLog({
      source: 'discord',
      event,
      message: summarize(content) || event,
      payload: content
    });
  });
}

function updateBotStatus(client) {
  state.bot = {
    ready: Boolean(client?.isReady?.()),
    tag: client?.user?.tag || null,
    id: client?.user?.id || null,
    guilds: client?.guilds?.cache?.size || 0,
    updatedAt: now()
  };
}

function getStatus() {
  return {
    ...state,
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
    },
    logs: {
      count: logs.length,
      max: MAX_LOGS
    }
  };
}

function textMatches(entry, terms) {
  if (!terms.length) return true;
  const haystack = [
    entry.message,
    entry.source,
    entry.event,
    entry.category,
    JSON.stringify(entry.payload || {})
  ].join(' ').toLowerCase();

  return terms.some((term) => haystack.includes(term));
}

function parseMultiFilter(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== 'all');
}

function includesOrAll(values, actual) {
  return !values.length || values.includes(actual);
}

function queryLogs({ category, level, source, q, limit = 250 } = {}) {
  const terms = String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const categories = parseMultiFilter(category);
  const levels = parseMultiFilter(level);
  const sources = parseMultiFilter(source);
  const max = Math.max(1, Math.min(1000, Number(limit) || 250));
  return logs
    .filter((entry) => includesOrAll(categories, entry.category))
    .filter((entry) => includesOrAll(levels, entry.level))
    .filter((entry) => includesOrAll(sources, entry.source))
    .filter((entry) => textMatches(entry, terms))
    .slice(-max)
    .reverse();
}

patchConsole();
registerEventListeners();

module.exports = {
  addLog,
  getStatus,
  queryLogs,
  updateBotStatus
};
