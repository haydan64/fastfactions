const eventBus = require('../eventBus');
const {
  joinMercs,
  joinKams,
  joinWarriors,
  joinLegion,
  defectFromFaction,
  banishFromFaction,
  FACTION_TAGS,
  getDiscordFactionStateForDiscordId,
  getDiscordFactionStateForMinecraftUsername
} = require('../factionManager');

const {
  EVENTS: { DISCORD_EVENT, MINECRAFT_EVENT, SERVER_COMMAND }
} = eventBus;

const WARNING_TTL_MS = 60000;
const warningCache = new Map();
let factionTagSyncInProgress = false;

function quoteMinecraftTarget(name) {
  return `"${String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function warnThrottled(key, message) {
  const now = Date.now();
  const expiresAt = warningCache.get(key) || 0;
  if (expiresAt > now) return;

  warningCache.set(key, now + WARNING_TTL_MS);
  console.warn(message);
}

async function handleFactionEvent(client, content = {}) {
  const message = String(content.message || '').trim();
  const [command, rawTarget] = message.split(';');
  const initiatorMinecraftUsername = String(content.initiator || '').trim();
  const targetMinecraftUsername = String(rawTarget || '').trim();
  const minecraftUsername = targetMinecraftUsername || initiatorMinecraftUsername;

  switch (command) {
    case 'join_mercs':
      return joinMercs(client, minecraftUsername);
    case 'join_kams':
      return joinKams(client, minecraftUsername);
    case 'join_warriors':
      return joinWarriors(client, minecraftUsername);
    case 'join_legion':
      return joinLegion(client, minecraftUsername);
    case 'defect_from_faction':
      return defectFromFaction(client, minecraftUsername);
    case 'banish_from_faction':
      return banishFromFaction(client, targetMinecraftUsername);
    default:
      return null;
  }
}

function buildFactionFunctionCommand(username, factionTag) {
  const target = quoteMinecraftTarget(username);
  const functionName = factionTag ? `faction_set_${factionTag}` : 'faction_clear';
  return `execute as ${target} run function ${functionName}`;
}

function playerFactionMatches(player, expectedTag) {
  const currentTags = new Set(Array.isArray(player?.tags) ? player.tags : []);
  const currentFactionTags = FACTION_TAGS.filter((tag) => currentTags.has(tag));

  if (!expectedTag) {
    return currentFactionTags.length === 0;
  }

  return currentFactionTags.length === 1 && currentFactionTags[0] === expectedTag;
}

function buildFactionSyncCommandForPlayer(player, expectedTag) {
  const playerName = String(player?.name || '').trim();
  if (!playerName || playerFactionMatches(player, expectedTag)) return null;
  return buildFactionFunctionCommand(playerName, expectedTag);
}

async function sendInternalCommand(command) {
  return eventBus.request(SERVER_COMMAND, { action: 'internal', command }, { timeoutMs: 5000 });
}

async function syncPlayerFactionTags(client, player) {
  const playerName = String(player?.name || '').trim();
  if (!playerName) return;

  const discordFactionState = await getDiscordFactionStateForMinecraftUsername(client, playerName);
  if (!discordFactionState.ok) {
    warnThrottled(
      `resolve:${playerName.toLowerCase()}`,
      `[FactionLink] Could not resolve Discord faction for ${playerName}: ${discordFactionState.message}`
    );
    return;
  }

  const command = buildFactionSyncCommandForPlayer(player, discordFactionState.data.tag);
  if (!command) return;

  const result = await sendInternalCommand(command);
  if (!result?.ok) {
    console.warn(`[FactionLink] Failed to sync Minecraft faction tag for ${playerName}: ${result?.message || 'unknown error'}`);
    return;
  }

  console.log(`[FactionLink] Synced Minecraft faction tags for ${playerName}: ${command}`);
}

async function syncOnlinePlayerFactionTags(client, players = []) {
  if (factionTagSyncInProgress) return;
  factionTagSyncInProgress = true;

  try {
    for (const player of players) {
      await syncPlayerFactionTags(client, player);
    }
  } catch (err) {
    console.error('Failed to sync online player faction tags:', err.message);
  } finally {
    factionTagSyncInProgress = false;
  }
}

async function syncMinecraftFactionForDiscordId(client, discordId) {
  const discordFactionState = await getDiscordFactionStateForDiscordId(client, discordId);
  if (!discordFactionState.ok) {
    warnThrottled(
      `discord-role-sync:${discordId}`,
      `[FactionLink] Could not sync Minecraft faction tags after Discord role change: ${discordFactionState.message}`
    );
    return;
  }

  const { username, tag } = discordFactionState.data;
  const command = buildFactionFunctionCommand(username, tag);
  const result = await sendInternalCommand(command);
  if (!result?.ok) {
    console.warn(`[FactionLink] Failed to send Discord faction sync for ${username}: ${result?.message || 'unknown error'}`);
    return;
  }

  console.log(`[FactionLink] Sent Discord faction sync for ${username}: ${command}`);
}

module.exports = function registerFactionLinkModule({ client }) {
  eventBus.on(DISCORD_EVENT, async ({ event, content }) => {
    if (event !== 'memberFactionRolesChanged' || !content?.memberId) return;

    try {
      await syncMinecraftFactionForDiscordId(client, content.memberId);
    } catch (err) {
      console.error('Failed to handle Discord faction role change:', err.message);
    }
  });

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event === 'playerList' && Array.isArray(content?.players)) {
      await syncOnlinePlayerFactionTags(client, content.players);
      return;
    }

    if (event !== 'event' || content?.id !== 'mclink:event' || !content?.initiator) return;

    try {
      const result = await handleFactionEvent(client, content);
      if (!result) return;

      if (result.ok) {
        console.log(`[FactionLink] ${result.message}`);
      } else {
        console.warn(`[FactionLink] ${result.message}`);
      }
    } catch (err) {
      console.error('Failed to handle Minecraft faction event:', err.message);
    }
  });
};
