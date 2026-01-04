const path = require('path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const eventBus = require('../eventBus');
const {
  upsertMinecraftProfile,
  getMinecraftProfileByDiscordId,
  getMinecraftProfileByUsername,
  getAllowlistEntryByName,
  saveApplicationResponse,
  getApplicationResponses,
  getApplicationResponse,
  deleteApplicationResponse,
  setApplicationStatus,
  getApplication,
  resetApplication
} = require('../database/database');
const { loadCommands } = require('./loadCommands');
const { registerApplicationFlow } = require('./applicationFlow');
const botConfig = require('./botConfig.json');

const {
  EVENTS: { SERVER_LOG, SERVER_STATE, MINECRAFT_EVENT, DISCORD_EVENT }
} = eventBus;

require('dotenv').config({ path: path.join(__dirname, '../env') });

const SERVER_LOG_CHANNEL = '1441903391830970489';
const SERVER_ADMIN_CHANNEL = '757584678671876101';
const DISCORD_LOG_CHANNEL = '757597730666315837';
const JOIN_LEAVE_CHANNEL = botConfig?.channels?.joinLeave;
const WAITING_ROOM_CHANNEL = botConfig?.channels?.waitingRoom;
const APPLICATIONS_CHANNEL = botConfig?.channels?.applications;
const OUTSIDER_ROLE_ID = botConfig?.roles?.outsider;
const LIEGE_ROLE_ID = botConfig?.roles?.liege;
const ROLE_IDS = {
  DEVELOPER: '804258017670856705',
  ROYALTY: '757463635718176819',
  STAFF: '796252628837335040'
};

function formatUser(user) {
  return `${user.tag || user.user?.tag || user.displayName || user.id}`;
}

function memberHasRole(member, roleId) {
  return Boolean(member?.roles?.cache?.has(roleId));
}

async function ensureRole(interaction, roleIds, message) {
  const member = interaction.member;
  const allowed = roleIds.some((id) => memberHasRole(member, id));
  if (!allowed) {
    await interaction.reply({ content: message || 'You do not have permission to use this command.', ephemeral: true });
    return false;
  }
  return true;
}

async function sendToChannel(client, channelId, payload) {
  try {
    const channel = client.channels.cache.get(channelId) || (await client.channels.fetch(channelId));
    if (!channel || !channel.isTextBased()) return;
    await channel.send(payload);
  } catch (err) {
    console.error(`Failed to send message to channel ${channelId}:`, err.message);
  }
}

function buildAuditEmbed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

function registerDiscordAuditHandlers(client) {
  client.on('voiceStateUpdate', (oldState, newState) => {
    const user = formatUser(newState.member || oldState.member);
    const oldChannel = oldState.channel?.name || 'None';
    const newChannel = newState.channel?.name || 'None';

    let description;
    if (!oldState.channelId && newState.channelId) {
      description = `${user} joined voice channel **${newChannel}**.`;
    } else if (oldState.channelId && !newState.channelId) {
      description = `${user} left voice channel **${oldChannel}**.`;
    } else if (oldState.channelId !== newState.channelId) {
      description = `${user} moved from **${oldChannel}** to **${newChannel}**.`;
    }

    if (description) {
      const embed = buildAuditEmbed('Voice Channel Update', description, 0x5b9bd5);
      sendToChannel(client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
    }
  });

  client.on('messageDelete', async (message) => {
    if (message.partial) await message.fetch().catch(() => null);
    const author = message.author ? formatUser(message.author) : 'Unknown user';
    const content = message.content || '[no content captured]';
    const channelName = message.channel?.name || 'Unknown channel';
    const embed = buildAuditEmbed(
      'Message Deleted',
      `Author: **${author}**\nChannel: **${channelName}**\nContent: ${content}`,
      0xd9534f
    );
    sendToChannel(client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.partial) await oldMessage.fetch().catch(() => null);
    if (newMessage.partial) await newMessage.fetch().catch(() => null);

    const author = newMessage.author ? formatUser(newMessage.author) : 'Unknown user';
    const before = oldMessage.content || '[no content captured]';
    const after = newMessage.content || '[no content captured]';

    if (before === after) return;

    const embed = buildAuditEmbed(
      'Message Edited',
      `Author: **${author}**\nBefore: ${before}\nAfter: ${after}`,
      0xf0ad4e
    );
    sendToChannel(client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
  });

  client.on('guildMemberAdd', async (member) => {
    const embed = buildAuditEmbed('Member Joined', `${formatUser(member)} joined the server.`, 0x5cb85c);
    if (OUTSIDER_ROLE_ID && member.guild.roles.cache.has(OUTSIDER_ROLE_ID)) {
      await member.roles.add(OUTSIDER_ROLE_ID).catch(() => null);
    }

    const joinEmbed = new EmbedBuilder()
      .setTitle('Player Joined')
      .setDescription(`<@${member.id}> has joined the realm.`)
      .setColor(0x5cb85c)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }));

    sendToChannel(member.client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
    if (JOIN_LEAVE_CHANNEL) {
      sendToChannel(member.client, JOIN_LEAVE_CHANNEL, {
        content: `<@${member.id}>`,
        embeds: [joinEmbed],
        allowedMentions: { users: [member.id] }
      });
    }
  });

  client.on('guildMemberRemove', (member) => {
    const embed = buildAuditEmbed('Member Left', `${formatUser(member)} left the server.`, 0xd9534f);
    const leaveEmbed = new EmbedBuilder()
      .setTitle('Player Left')
      .setDescription(`<@${member.id}> has left the realm.`)
      .setColor(0xd9534f)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }));

    sendToChannel(member.client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
    if (JOIN_LEAVE_CHANNEL) {
      sendToChannel(member.client, JOIN_LEAVE_CHANNEL, {
        content: `<@${member.id}>`,
        embeds: [leaveEmbed],
        allowedMentions: { users: [member.id] }
      });
    }

  });

  client.on('guildMemberUpdate', (oldMember, newMember) => {
    const changes = [];
    if (oldMember.nickname !== newMember.nickname) {
      changes.push(`Nickname: **${oldMember.nickname || 'None'}** → **${newMember.nickname || 'None'}**`);
    }
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());
    const addedRoles = [...newRoles].filter((role) => !oldRoles.has(role));
    const removedRoles = [...oldRoles].filter((role) => !newRoles.has(role));
    if (addedRoles.length) {
      const added = addedRoles.map((id) => newMember.roles.cache.get(id)?.name || id).join(', ');
      changes.push(`Roles added: ${added}`);
    }
    if (removedRoles.length) {
      const removed = removedRoles.map((id) => oldMember.guild.roles.cache.get(id)?.name || id).join(', ');
      changes.push(`Roles removed: ${removed}`);
    }

    if (changes.length) {
      const embed = buildAuditEmbed('Member Updated', changes.join('\n'), 0x337ab7)
        .setAuthor({
          name: formatUser(newMember),
          iconURL: newMember.user?.displayAvatarURL?.({ size: 128 }) || null
        })
        .setThumbnail(newMember.user?.displayAvatarURL?.({ size: 256 }) || null);

      sendToChannel(newMember.client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
    }
  });
}

function registerServerEventHandlers(client) {
  eventBus.on(SERVER_LOG, ({ message, important }) => {
    if (!important) return;
    sendToChannel(client, SERVER_LOG_CHANNEL, `🪵 ${message}`);
  });

  eventBus.on(SERVER_STATE, ({ state, message }) => {
    const icon = state === 'running' ? '✅' : state === 'stopped' ? '🛑' : '⚙️';
    sendToChannel(client, SERVER_LOG_CHANNEL, `${icon} ${message}`);
  });

  eventBus.on(MINECRAFT_EVENT, ({ event, content }) => {
    switch (event) {
      case ("log"): {
        if (!content.discordLog) break;
        sendToChannel(client, SERVER_LOG_CHANNEL, `<a:grass_animated:923831993152729168> ${content.message}`);
        break;
      }
      case ("unwhitelist"): {
        sendToChannel(client, SERVER_ADMIN_CHANNEL, `⚠️ ${content.initiator || "Unknown"} Unwhitelisted ${content.target}!`)
        break;
      }
    }
  })
}

function buildCommandContext() {
  return {
    eventBus,
    events: eventBus.EVENTS,
    roleIds: ROLE_IDS,
    ensureRole,
    formatUser,
    upsertMinecraftProfile,
    getMinecraftProfileByDiscordId,
    getMinecraftProfileByUsername,
    getAllowlistEntryByName,
    saveApplicationResponse,
    getApplicationResponses,
    getApplicationResponse,
    deleteApplicationResponse,
    setApplicationStatus,
    getApplication,
    resetApplication,
    applicationQuestions: botConfig?.questions,
    applicationRoles: botConfig?.roles,
    applicationChannels: botConfig?.channels
  };
}

function registerCommandHandlers(client, commands) {
  const commandContext = buildCommandContext();

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, commandContext);
    } catch (err) {
      console.error(`Error executing command ${interaction.commandName}:`, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
      }
    }
  });
}


function createDiscordBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
  });

  const commands = loadCommands();

  client.on('ready', () => {
    console.log(`Sir Aldric is online as ${client.user.tag}`);
  });

  registerCommandHandlers(client, commands);
  registerDiscordAuditHandlers(client);
  registerApplicationFlow(client, {
    waitingRoomChannelId: WAITING_ROOM_CHANNEL,
    applicationsChannelId: APPLICATIONS_CHANNEL,
    questions: botConfig.questions
  }, {
    saveApplicationResponse,
    getApplicationResponses,
    getApplicationResponse,
    deleteApplicationResponse,
    setApplicationStatus,
    sendToChannel,
    ensureRole,
    roleIds: ROLE_IDS,
    rolesConfig: botConfig.roles
  });
  registerServerEventHandlers(client);

  return {
    client,
    async start() {
      const token = process.env.DISCORD_TOKEN;
      if (!token) {
        console.warn('DISCORD_TOKEN not provided. Bot will not connect.');
        return;
      }
      await client.login(token);
    }
  };
};

const {client, start} = createDiscordBot();


module.exports = {
  client,
  start,
  sendToChannel
}