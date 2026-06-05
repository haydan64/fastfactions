const {
  getMinecraftProfileByDiscordId,
  getMinecraftProfileByUsername
} = require('./database/database');

const FACTION_ROLES = {
  mercs: {
    name: 'Mercenary',
    roleId: '789173632420544552',
    tag: 'merc'
  },
  kams: {
    name: 'Kamereon Kazoku',
    roleId: '1072300824522403930',
    tag: 'kam'
  },
  legion: {
    name: 'Legion of the Sea',
    roleId: '948367202514501702',
    tag: 'leg'
  },
  warriors: {
    name: 'Warrior',
    roleId: '788944083971473468',
    tag: 'war'
  }
};

const FACTION_ROLE_IDS = Object.values(FACTION_ROLES).map((faction) => faction.roleId);
const FACTION_TAGS = Object.values(FACTION_ROLES).map((faction) => faction.tag);
const FACTION_CACHE_TTL_MS = 60000;
const factionStateCache = new Map();

async function getGuild(client) {
  if (!client?.guilds) return null;

  if (process.env.DISCORD_GUILD_ID) {
    return client.guilds.cache.get(process.env.DISCORD_GUILD_ID)
      || client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
  }

  if (client.guilds.cache.size === 1) {
    return client.guilds.cache.first();
  }

  return null;
}

function formatResult(ok, message, data = {}) {
  return { ok, message, data };
}

function getFactionTagsFromMember(member) {
  return Object.values(FACTION_ROLES)
    .filter((faction) => member.roles.cache.has(faction.roleId))
    .map((faction) => faction.tag);
}

function getFactionTagFromMember(member) {
  return getFactionTagsFromMember(member)[0] || null;
}

function clearFactionStateCacheForDiscordId(discordId) {
  if (!discordId) return;
  for (const [key, entry] of factionStateCache.entries()) {
    if (entry.discordId === discordId) {
      factionStateCache.delete(key);
    }
  }
}

function clearFactionStateCacheForMinecraftUsername(minecraftUsername) {
  if (!minecraftUsername) return;
  factionStateCache.delete(String(minecraftUsername).trim().toLowerCase());
}

async function resolveMemberByMinecraftUsername(client, minecraftUsername) {
  const username = String(minecraftUsername || '').trim();
  if (!username) {
    return formatResult(false, 'Minecraft username was missing from the faction event.');
  }

  const profile = await getMinecraftProfileByUsername(username);
  if (!profile?.discord_id) {
    return formatResult(false, `No Discord profile is linked to Minecraft username "${username}".`);
  }

  const guild = await getGuild(client);
  if (!guild) {
    return formatResult(false, 'Discord guild was not available for faction role sync.');
  }

  const member = guild.members.cache.get(profile.discord_id)
    || await guild.members.fetch(profile.discord_id).catch(() => null);
  if (!member) {
    return formatResult(false, `Discord member ${profile.discord_id} could not be found for "${username}".`);
  }

  return formatResult(true, 'Resolved Discord member.', { username, profile, guild, member });
}

async function resolveMemberByDiscordId(client, discordId) {
  if (!discordId) {
    return formatResult(false, 'Discord user ID was missing.');
  }

  const profile = await getMinecraftProfileByDiscordId(discordId);
  if (!profile?.username) {
    return formatResult(false, `No Minecraft profile is linked to Discord user ${discordId}.`);
  }

  const guild = await getGuild(client);
  if (!guild) {
    return formatResult(false, 'Discord guild was not available for faction role sync.');
  }

  const member = guild.members.cache.get(discordId)
    || await guild.members.fetch(discordId).catch(() => null);
  if (!member) {
    return formatResult(false, `Discord member ${discordId} could not be found.`);
  }

  return formatResult(true, 'Resolved Discord member.', { username: profile.username, profile, guild, member });
}

async function setFactionRole(client, minecraftUsername, factionKey) {
  const faction = FACTION_ROLES[factionKey];
  if (!faction) {
    return formatResult(false, `Unknown faction "${factionKey}".`);
  }

  const resolved = await resolveMemberByMinecraftUsername(client, minecraftUsername);
  if (!resolved.ok) return resolved;

  const { username, member } = resolved.data;
  const rolesToRemove = FACTION_ROLE_IDS.filter((roleId) => roleId !== faction.roleId && member.roles.cache.has(roleId));

  try {
    if (rolesToRemove.length) {
      await member.roles.remove(rolesToRemove, `Minecraft faction selection: ${username} joined ${faction.name}`);
    }

    if (!member.roles.cache.has(faction.roleId)) {
      await member.roles.add(faction.roleId, `Minecraft faction selection: ${username} joined ${faction.name}`);
    }
  } catch (err) {
    return formatResult(false, `Failed to sync ${username} to ${faction.name}: ${err.message}`, {
      faction,
      username
    });
  }

  clearFactionStateCacheForMinecraftUsername(username);
  clearFactionStateCacheForDiscordId(resolved.data.profile.discord_id);

  return formatResult(true, `${username} synced to ${faction.name}.`, {
    faction,
    username,
    discordId: resolved.data.profile.discord_id
  });
}

async function setMemberFactionRole(member, factionKey, reason = 'Faction role changed by command') {
  const faction = FACTION_ROLES[factionKey];
  if (!faction) {
    return formatResult(false, `Unknown faction "${factionKey}".`);
  }

  const rolesToRemove = FACTION_ROLE_IDS.filter((roleId) => roleId !== faction.roleId && member.roles.cache.has(roleId));

  try {
    if (rolesToRemove.length) {
      await member.roles.remove(rolesToRemove, reason);
    }

    if (!member.roles.cache.has(faction.roleId)) {
      await member.roles.add(faction.roleId, reason);
    }
  } catch (err) {
    return formatResult(false, `Failed to set faction to ${faction.name}: ${err.message}`, { faction });
  }

  clearFactionStateCacheForDiscordId(member.id);

  return formatResult(true, `Faction set to ${faction.name}.`, { faction });
}

async function clearMemberFactionRoles(member, reason = 'Faction roles cleared by command') {
  const rolesToRemove = FACTION_ROLE_IDS.filter((roleId) => member.roles.cache.has(roleId));

  try {
    if (rolesToRemove.length) {
      await member.roles.remove(rolesToRemove, reason);
    }
  } catch (err) {
    return formatResult(false, `Failed to clear faction roles: ${err.message}`);
  }

  clearFactionStateCacheForDiscordId(member.id);

  return formatResult(true, 'Faction roles cleared.');
}

async function getDiscordFactionStateForMinecraftUsername(client, minecraftUsername, options = {}) {
  const username = String(minecraftUsername || '').trim();
  if (!username) {
    return formatResult(false, 'Minecraft username was missing.');
  }

  const cacheKey = username.toLowerCase();
  const cached = factionStateCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return formatResult(true, 'Resolved faction state from cache.', cached);
  }

  const resolved = await resolveMemberByMinecraftUsername(client, username);
  if (!resolved.ok) return resolved;

  const data = {
    username: resolved.data.username,
    discordId: resolved.data.profile.discord_id,
    tag: getFactionTagFromMember(resolved.data.member),
    tags: getFactionTagsFromMember(resolved.data.member)
  };

  factionStateCache.set(cacheKey, {
    ...data,
    expiresAt: Date.now() + (options.ttlMs || FACTION_CACHE_TTL_MS)
  });

  return formatResult(true, 'Resolved faction state from Discord.', data);
}

async function getDiscordFactionStateForDiscordId(client, discordId) {
  const resolved = await resolveMemberByDiscordId(client, discordId);
  if (!resolved.ok) return resolved;

  clearFactionStateCacheForMinecraftUsername(resolved.data.username);

  return formatResult(true, 'Resolved faction state from Discord.', {
    username: resolved.data.username,
    discordId,
    tag: getFactionTagFromMember(resolved.data.member),
    tags: getFactionTagsFromMember(resolved.data.member)
  });
}

async function joinMercs(client, minecraftUsername) {
  return setFactionRole(client, minecraftUsername, 'mercs');
}

async function joinKams(client, minecraftUsername) {
  return setFactionRole(client, minecraftUsername, 'kams');
}

async function joinLegion(client, minecraftUsername) {
  return setFactionRole(client, minecraftUsername, 'legion');
}

async function joinWarriors(client, minecraftUsername) {
  return setFactionRole(client, minecraftUsername, 'warriors');
}

async function defectFromFaction(client, minecraftUsername) {
  return joinMercs(client, minecraftUsername);
}

async function banishFromFaction(client, minecraftUsername) {
  return joinMercs(client, minecraftUsername);
}

module.exports = {
  FACTION_ROLES,
  FACTION_ROLE_IDS,
  FACTION_TAGS,
  joinMercs,
  joinKams,
  joinLegion,
  joinWarriors,
  defectFromFaction,
  banishFromFaction,
  setFactionRole,
  setMemberFactionRole,
  clearMemberFactionRoles,
  getDiscordFactionStateForMinecraftUsername,
  getDiscordFactionStateForDiscordId,
  clearFactionStateCacheForDiscordId,
  clearFactionStateCacheForMinecraftUsername,
  getFactionTagFromMember,
  getFactionTagsFromMember
};
