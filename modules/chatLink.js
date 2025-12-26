const eventBus = require('../eventBus');
const {
  getMinecraftProfileByUsername,
  getMinecraftProfileByDiscordId
} = require('../database/database');

const {
  EVENTS: { MINECRAFT_EVENT, SERVER_COMMAND }
} = eventBus;

const LINKED_CHANNEL_ID = '1132587130472890448';
const CHAT_WEBHOOK_URL = process.env.CHAT_LINK_WEBHOOK_URL;

function ensureFetch() {
  if (typeof fetch === 'function') return fetch;
  return null;
}

async function sendWebhookMessage(payload = {}) {
  const fetchImpl = ensureFetch();
  if (!fetchImpl) {
    console.warn('Fetch API not available. Cannot send webhook messages.');
    return;
  }

  if (!CHAT_WEBHOOK_URL) {
    console.warn('CHAT_LINK_WEBHOOK_URL is not configured. Skipping Discord relay.');
    return;
  }

  await fetchImpl(CHAT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } })
  }).catch((err) => console.error('Failed to send webhook message:', err.message));
}

async function resolveDiscordIdentity(client, minecraftName) {
  const profile = await getMinecraftProfileByUsername(minecraftName).catch(() => null);
  if (!profile?.discord_id || !client) {
    return { profile, displayName: minecraftName, avatarUrl: null };
  }

  const user = await client.users.fetch(profile.discord_id).catch(() => null);
  if (!user) {
    return { profile, displayName: minecraftName, avatarUrl: null };
  }

  return {
    profile,
    displayName: user.globalName || user.username || minecraftName,
    avatarUrl: user.displayAvatarURL?.({ size: 256 }) || null
  };
}

function buildTellrawMessage(name, message) {
  const safeName = (name || 'Unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeMessage = (message || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .trim();
  return `tellraw @a {"rawtext":[{"text":"<${safeName}> ${safeMessage}"}]}`;
}

function collectDiscordMessageContent(message) {
  const parts = [];
  if (message.content) parts.push(message.content.trim());
  if (message.attachments?.size) {
    const attachments = [...message.attachments.values()].map((attachment) => attachment.url).join(' ');
    if (attachments) parts.push(attachments);
  }
  return parts.join(' ').trim();
}

module.exports = function registerChatLinkModule({ bot }) {
  const client = bot?.client;

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event !== 'chatSent' || !content?.sender) return;

    try {
      const { displayName, avatarUrl } = await resolveDiscordIdentity(client, content.sender);
      const message = content.message || '';

      await sendWebhookMessage({
        username: displayName,
        avatar_url: avatarUrl || undefined,
        content: message ? `(${content.sender}) ${message}` : `(${content.sender})`
      });
    } catch (err) {
      console.error('Failed to relay Minecraft chat to Discord:', err.message);
    }
  });

  if (!client) {
    console.warn('Discord client unavailable. Chat relay from Discord to Minecraft will be disabled.');
    return;
  }

  client.on('messageCreate', async (message) => {
    if (message.channelId !== LINKED_CHANNEL_ID) return;
    if (message.author?.bot || message.webhookId) return;

    try {
      const profile = await getMinecraftProfileByDiscordId(message.author?.id).catch(() => null);
      const minecraftName = profile?.username || message.author?.username || 'Unknown';
      const content = collectDiscordMessageContent(message);
      if (!content) return;

      const command = buildTellrawMessage(minecraftName, content);
      eventBus.emit(SERVER_COMMAND, { action: 'command', command });
    } catch (err) {
      console.error('Failed to relay Discord message to Minecraft:', err.message);
    }
  });
};
