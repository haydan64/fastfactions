const eventBus = require('../eventBus');
const {
  getMinecraftProfileByUsername,
  getMinecraftProfileByDiscordId
} = require('../database/database');

const {
  EVENTS: { MINECRAFT_EVENT, SERVER_COMMAND }
} = eventBus;



module.exports = function registerChatLinkModule({ bot, server }) {
  const client = bot?.client;

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event === 'event' && content?.initiator) {
      try {
        const { displayName, avatarUrl } = await resolveDiscordIdentity(client, content.sender);

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
