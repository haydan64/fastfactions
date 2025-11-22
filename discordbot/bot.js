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
  EVENTS: { SERVER_LOG, SERVER_STATE, SERVER_COMMAND }
} = eventBus;

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SERVER_LOG_CHANNEL = '1441903391830970489';
const DISCORD_LOG_CHANNEL = '757597730666315837';

function buildCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('commands')
      .setDescription('Sir Aldric command groups')
      .addSubcommandGroup((group) =>
        group
          .setName('developer')
          .setDescription('Developer utilities')
          .addSubcommand((sub) => sub.setName('ping').setDescription('Ping Sir Aldric'))
      )
      .addSubcommandGroup((group) =>
        group
          .setName('staff')
          .setDescription('Staff tools')
          .addSubcommand((sub) =>
            sub
              .setName('allowlist-add')
              .setDescription('Add a player to the server allowlist')
              .addStringOption((opt) => opt.setName('name').setDescription('Xbox Gamertag').setRequired(true))
              .addStringOption((opt) =>
                opt.setName('xuid').setDescription('Optional XUID for the player').setRequired(false)
              )
              .addBooleanOption((opt) =>
                opt
                  .setName('ignores_player_limit')
                  .setDescription('Allow player to bypass player limit')
                  .setRequired(false)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('allowlist-remove')
              .setDescription('Remove a player from the server allowlist')
              .addStringOption((opt) => opt.setName('name').setDescription('Xbox Gamertag').setRequired(true))
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName('community')
          .setDescription('Community commands')
          .addSubcommand((sub) => sub.setName('help').setDescription('Player commands list'))
      )
      .addSubcommandGroup((group) =>
        group
          .setName('management')
          .setDescription('Management commands')
          .addSubcommand((sub) =>
            sub
              .setName('permission-set')
              .setDescription('Set a player permission level by XUID')
              .addStringOption((opt) =>
                opt.setName('xuid').setDescription('Player XUID').setRequired(true)
              )
              .addStringOption((opt) =>
                opt
                  .setName('permission')
                  .setDescription('Permission level')
                  .addChoices(
                    { name: 'operator', value: 'operator' },
                    { name: 'member', value: 'member' },
                    { name: 'visitor', value: 'visitor' }
                  )
                  .setRequired(true)
              )
          )
      )
  ];

  return commands.map((cmd) => cmd.toJSON());
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

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'commands') return;

  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === 'developer' && sub === 'ping') {
    const sent = await interaction.reply({ content: 'Pong!', ephemeral: true, fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.followUp({ content: `Round-trip latency: ${latency}ms`, ephemeral: true });
    return;
  }

  if (group === 'staff' && sub === 'allowlist-add') {
    const name = interaction.options.getString('name', true);
    const xuid = interaction.options.getString('xuid');
    const ignoresLimit = interaction.options.getBoolean('ignores_player_limit') || false;
    eventBus.emit(SERVER_COMMAND, {
      action: 'allowlist:add',
      name,
      xuid,
      ignoresPlayerLimit: ignoresLimit
    });
    await interaction.reply({ content: `Queued allowlist update for **${name}**.`, ephemeral: true });
    return;
  }

  if (group === 'staff' && sub === 'allowlist-remove') {
    const name = interaction.options.getString('name', true);
    eventBus.emit(SERVER_COMMAND, { action: 'allowlist:remove', name });
    await interaction.reply({ content: `Queued allowlist removal for **${name}**.`, ephemeral: true });
    return;
  }

  if (group === 'management' && sub === 'permission-set') {
    const xuid = interaction.options.getString('xuid', true);
    const permission = interaction.options.getString('permission', true);
    eventBus.emit(SERVER_COMMAND, { action: 'permission:set', xuid, permission });
    await interaction.reply({
      content: `Queued permission update for **${xuid}** → **${permission}**.`,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({ content: 'Unknown or unimplemented command.', ephemeral: true });
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
