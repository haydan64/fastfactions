const eventBus = require('../eventBus');
const {
  joinMercs,
  joinKams,
  joinWarriors,
  joinLegion,
  defectFromFaction,
  banishFromFaction
} = require('../factionManager');

const {
  EVENTS: { MINECRAFT_EVENT }
} = eventBus;

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

module.exports = function registerFactionLinkModule({ client }) {
  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
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
