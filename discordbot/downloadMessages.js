require('dotenv').config({ path: path.join(__dirname, '../env') });
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const {
  DISCORD_TOKEN,
  DISCORD_GUILD_ID,
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}
if (!DISCORD_GUILD_ID) {
  console.error('Missing DISCORD_GUILD_ID in .env');
  process.exit(1);
}

// We need message content + guilds + message history
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const OUTPUT_FILE = path.join(__dirname, 'messages.txt');

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    await guild.channels.fetch(); // populate cache with channels

    // Clear old file contents (or create empty)
    fs.writeFileSync(OUTPUT_FILE, '', 'utf8');

    const channels = guild.channels.cache.filter(ch =>
      ch.type === ChannelType.GuildText ||
      ch.type === ChannelType.GuildAnnouncement ||
      ch.type === ChannelType.PublicThread ||
      ch.type === ChannelType.PrivateThread ||
      ch.type === ChannelType.AnnouncementThread
    );

    console.log(`Found ${channels.size} text/thread channels`);

    for (const [channelId, channel] of channels) {
      console.log(`Fetching messages for #${channel.name || channelId} (${channelId})`);
      await dumpChannelMessages(channel, guild.id);
    }

    console.log(`Finished. Messages written to ${OUTPUT_FILE}`);
    // Optional: exit when done
    process.exit(0);
  } catch (err) {
    console.error('Error while dumping messages:', err);
    process.exit(1);
  }
});

/**
 * Fetch all messages from a channel and append them to the output file.
 * @param {import('discord.js').TextChannel | import('discord.js').ThreadChannel} channel
 * @param {string} guildId
 */
async function dumpChannelMessages(channel, guildId) {
  let lastId = null;
  let fetchedCount = 0;

  while (true) {
    const options = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }

    const messages = await channel.messages.fetch(options);
    if (!messages.size) {
      break;
    }

    // Sort from oldest to newest for stable output
    const sorted = Array.from(messages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    const lines = sorted.map(msg => {
      const timestamp = new Date(msg.createdTimestamp).toISOString();
      const authorId = msg.author?.id || 'unknown';
      const channelId = msg.channelId;
      const messageId = msg.id;

      // Standard Discord message link
      const messageLink = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

      // Replace newlines in content to keep it one line; escape pipes
      const content = (msg.content || '')
        .replace(/\r?\n/g, '\\n')
        .replace(/\|/g, '\\|');

      return `${timestamp} | ${channelId} | ${messageId} | ${authorId} | ${messageLink} | ${content}`;
    });

    // Append to file
    fs.appendFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf8');

    fetchedCount += messages.size;
    console.log(`  Fetched ${fetchedCount} messages so far from ${channel.id}`);

    // Prepare for next loop
    lastId = sorted[0].id; // oldest message ID
    if (messages.size < 100) {
      break; // no more messages
    }
  }
}

client.login(DISCORD_TOKEN);
