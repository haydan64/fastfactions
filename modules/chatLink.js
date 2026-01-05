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

function buildTellrawMessage(name, nameColor, message) {
  const safeName = (name || 'Unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeMessage = (message || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .trim();
  return `tellraw @a {"rawtext":[{"text":"${nameColor}<${safeName}>§r ${safeMessage}"}]}`;
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

function decamelize(str) {
  return str
    // split lower→upper and number→letter
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // split letter→number
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    // normalize spacing & lowercase
    .toLowerCase()
    .trim();
}


function formatDeathMessage(content = {}) {
  const name = content.entityName || content.entityType || content.entity || 'An entity';
  let killer = content.damagingEntityName || content.damagingEntityType || content.damagingEntity;
  if(killer?.includes(":")) killer = decamelize(killer.split(":")[1]);
  const cause = content.cause ? decamelize(String(content.cause)) : null;

  const causeDescriptions = {
    entityattack: 'was slain',
    projectile: 'was shot',
    fallback: 'was killed'
  };

  const action = cause ? causeDescriptions[cause] || causeDescriptions.fallback : causeDescriptions.fallback;
  let killerText = '';
  if (killer) killerText += ` by ${killer}`;
  if (killer && cause) killerText += ` using ${cause}`;
  if (!killer && cause) killerText = ` by ${cause}`;

  return `**${name}** ${action}${killerText}.`.trim();
}

module.exports = function registerChatLinkModule({ client }) {

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event === 'chatSent' && content?.sender) {
      try {
        const { displayName, avatarUrl } = await resolveDiscordIdentity(client, content.sender);
        const message = content.message || '';

        await sendWebhookMessage({
          username: displayName,
          avatar_url: avatarUrl || undefined,
          content: message ? `${message}` : `(${content.sender})`,
          allowed_mentions: { parse: [] }
        });
      } catch (err) {
        console.error('Failed to relay Minecraft chat to Discord:', err.message);
      }
    }
    if (event === 'playerJoin' && content?.username) {
      try {
        const { displayName, avatarUrl } = await resolveDiscordIdentity(client, content.username);

        await sendWebhookMessage({
          embeds: [
            {
              author: {
                name: displayName,
                icon_url: avatarUrl || undefined
              },
              description: `**${displayName}** joined the game.`,
              color: 0x57F287, // Discord "success" green
              timestamp: new Date().toISOString()
            }
          ],
          allowed_mentions: { parse: [] }
        });
      } catch (err) {
        console.error('Failed to relay Minecraft join message to Discord:', err.message);
      }
    }
    if (event === 'playerLeave' && content?.username) {
      try {
        const { displayName, avatarUrl } = await resolveDiscordIdentity(client, content.username);

        await sendWebhookMessage({
          embeds: [
            {
              author: {
                name: displayName,
                icon_url: avatarUrl || undefined
              },
              description: `**${displayName}** left the game.`,
              color: 0xFEE75C, // Discord "warning" yellow
              timestamp: new Date().toISOString()
            }
          ],
          allowed_mentions: { parse: [] }
        });
      } catch (err) {
        console.error('Failed to relay Minecraft join message to Discord:', err.message);
      }
    }
    if (event === 'entityDied' && content) {
      if(content?.entityType !== "minecraft:player") return;
      try {
        const description = formatDeathMessage(content);


        await sendWebhookMessage({
          embeds: [
            {
              description,
              color: 0xED4245, // Discord "danger" red
              timestamp: new Date().toISOString(),
            }
          ],
          allowed_mentions: { parse: [] }
        });
      } catch (err) {
        console.error('Failed to relay Minecraft death message to Discord:', err.message);
      }
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
      const profile = await getMinecraftProfileByDiscordId(message.author.id).catch(() => null);
      const minecraftName = profile?.username || message.author.username || 'Unknown';
      const content = collectDiscordMessageContent(message);
      if (!content) return;

      const member = message.member;

      let nameColor = "";

      if (member?.roles?.cache?.has("757462916688511087")) nameColor = "§v§l"; // Emperor
      else if (member?.roles?.cache?.has("757463635718176819")) nameColor = "§5"; // Royalty
      else if (member?.roles?.cache?.has("796252628837335040")) nameColor = "§9"; // Whiteguard
      else if (member?.roles?.cache?.has("788944083971473468")) nameColor = "§4"; // Warrior
      else if (member?.roles?.cache?.has("948367202514501702")) nameColor = "§3"; // Legion of the Sea
      else if (member?.roles?.cache?.has("1072300824522403930")) nameColor = "§g"; // Kamereon Kazoku
      else if (member?.roles?.cache?.has("789173632420544552")) nameColor = "§2"; // Mercenary

      const command = buildTellrawMessage(minecraftName, nameColor, content);
      eventBus.emit(SERVER_COMMAND, { action: 'internal', command });
    } catch (err) {
      console.error('Failed to relay Discord message to Minecraft:', err.message);
    }
  });
};
