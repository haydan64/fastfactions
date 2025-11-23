const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');
const eventBus = require('../eventBus');
const {
  setMinecraftUsername,
  getPlayerByDiscordId
} = require('../database/database');

const {
  EVENTS: { SERVER_LOG, SERVER_STATE, SERVER_COMMAND }
} = eventBus;

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SERVER_LOG_CHANNEL = '1441903391830970489';
const DISCORD_LOG_CHANNEL = '757597730666315837';
const ROLE_DEVELOPER = process.env.DEVELOPER_ROLE || 'Developer';
const ROLE_STAFF = process.env.STAFF_ROLE || 'Staff';
const ROLE_ROYALTY = process.env.ROYALTY_ROLE || 'Royalty';

function buildCommands() {
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Ping Sir Aldric'),
    new SlashCommandBuilder()
      .setName('sendmessage')
      .setDescription('Send a message as Sir Aldric')
      .addStringOption((opt) => opt.setName('message').setDescription('Message to send').setRequired(true))
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel to send to').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('setminecraftusername')
      .setDescription('Set your Minecraft username')
      .addStringOption((opt) => opt.setName('username').setDescription('Minecraft username').setRequired(true)),
    new SlashCommandBuilder()
      .setName('changeplayerusername')
      .setDescription('Change another player\'s Minecraft username')
      .addUserOption((opt) => opt.setName('user').setDescription('Target Discord user').setRequired(true))
      .addStringOption((opt) => opt.setName('username').setDescription('New Minecraft username').setRequired(true)),
    new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('Whitelist a player on the Bedrock server')
      .addUserOption((opt) => opt.setName('user').setDescription('Target Discord user').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unwhitelist')
      .setDescription('Remove a player from the Bedrock allowlist')
      .addUserOption((opt) => opt.setName('user').setDescription('Target Discord user').setRequired(true))
  ];

  return commands
    .map((cmd) => cmd.setDMPermission(false))
    .map((cmd) => cmd.toJSON());
}

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    console.warn('Missing Discord token, client ID, or guild ID. Commands will not be registered.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = buildCommands();
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}

function formatUser(user) {
  return `${user.tag || user.user?.tag || user.displayName || user.id}`;
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

  client.on('guildMemberAdd', (member) => {
    const embed = buildAuditEmbed('Member Joined', `${formatUser(member)} joined the server.`, 0x5cb85c);
    sendToChannel(member.client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
  });

  client.on('guildMemberRemove', (member) => {
    const embed = buildAuditEmbed('Member Left', `${formatUser(member)} left the server.`, 0xd9534f);
    sendToChannel(member.client, DISCORD_LOG_CHANNEL, { embeds: [embed] });
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
      const embed = buildAuditEmbed('Member Updated', changes.join('\n'), 0x337ab7);
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
}

function memberHasRole(member, roleName) {
  return Boolean(member?.roles?.cache?.some((role) => role.name.toLowerCase() === roleName.toLowerCase()));
}

async function requireRole(interaction, roleName) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return false;
  }
  const member = interaction.member;
  if (memberHasRole(member, roleName)) return true;
  await interaction.reply({ content: `You need the **${roleName}** role to use this command.`, ephemeral: true });
  return false;
}

async function handlePing(interaction) {
  const allowed = await requireRole(interaction, ROLE_DEVELOPER);
  if (!allowed) return;
  const sent = await interaction.reply({ content: 'Pong!', ephemeral: true, fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  await interaction.followUp({ content: `Round-trip latency: ${latency}ms`, ephemeral: true });
}

async function handleSendMessage(interaction) {
  const allowed = await requireRole(interaction, ROLE_ROYALTY);
  if (!allowed) return;
  const message = interaction.options.getString('message', true);
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  await channel.send({ content: message });
  await interaction.reply({ content: `Message sent to ${channel}.`, ephemeral: true });
}

async function handleSetMinecraftUsername(interaction) {
  const username = interaction.options.getString('username', true);
  await setMinecraftUsername({ discordId: interaction.user.id, username });
  await interaction.reply({
    content: `Saved Minecraft username **${username}**. Your XUID will be linked on first server join.`,
    ephemeral: true
  });
}

async function handleChangePlayerUsername(interaction) {
  const allowed = await requireRole(interaction, ROLE_ROYALTY);
  if (!allowed) return;
  const user = interaction.options.getUser('user', true);
  const username = interaction.options.getString('username', true);
  await setMinecraftUsername({ discordId: user.id, username });
  await interaction.reply({
    content:
      `Updated ${formatUser(user)} to Minecraft username **${username}**. If this player uses a different Microsoft account, run /unbindXUID for them and re-add them to the whitelist.`,
    ephemeral: true
  });
}

async function handleWhitelist(interaction) {
  const allowed = await requireRole(interaction, ROLE_STAFF);
  if (!allowed) return;
  const user = interaction.options.getUser('user', true);
  const profile = await getPlayerByDiscordId(user.id);
  if (!profile?.minecraft_username) {
    await interaction.reply({
      content: `${formatUser(user)} has not set a Minecraft username. Ask them to run /setMinecraftUsername first.`,
      ephemeral: true
    });
    return;
  }
  eventBus.emit(SERVER_COMMAND, {
    action: 'allowlist:add',
    name: profile.minecraft_username,
    xuid: profile.xuid,
    ignoresPlayerLimit: false
  });
  await interaction.reply({
    content: `Queued allowlist entry for **${profile.minecraft_username}** (requested by ${formatUser(interaction.user)}).`,
    ephemeral: true
  });
}

async function handleUnwhitelist(interaction) {
  const allowed = await requireRole(interaction, ROLE_STAFF);
  if (!allowed) return;
  const user = interaction.options.getUser('user', true);
  const profile = await getPlayerByDiscordId(user.id);
  if (!profile?.minecraft_username) {
    await interaction.reply({
      content: `${formatUser(user)} does not have a stored Minecraft username. Nothing to remove.`,
      ephemeral: true
    });
    return;
  }
  eventBus.emit(SERVER_COMMAND, { action: 'allowlist:remove', name: profile.minecraft_username });
  await interaction.reply({
    content: `Queued allowlist removal for **${profile.minecraft_username}** (requested by ${formatUser(interaction.user)}).`,
    ephemeral: true
  });
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ping') return handlePing(interaction);
  if (interaction.commandName === 'sendmessage') return handleSendMessage(interaction);
  if (interaction.commandName === 'setminecraftusername') return handleSetMinecraftUsername(interaction);
  if (interaction.commandName === 'changeplayerusername') return handleChangePlayerUsername(interaction);
  if (interaction.commandName === 'whitelist') return handleWhitelist(interaction);
  if (interaction.commandName === 'unwhitelist') return handleUnwhitelist(interaction);
}

module.exports = function createDiscordBot() {
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

  client.on('ready', () => {
    console.log(`Sir Aldric is online as ${client.user.tag}`);
  });

  client.on('interactionCreate', (interaction) => handleInteraction(interaction));

  registerDiscordAuditHandlers(client);
  registerServerEventHandlers(client);

  return {
    client,
    async start() {
      await registerCommands();
      const token = process.env.DISCORD_TOKEN;
      if (!token) {
        console.warn('DISCORD_TOKEN not provided. Bot will not connect.');
        return;
      }
      await client.login(token);
    }
  };
};
