const eventBus = require('../eventBus');

const {
  EVENTS: { MINECRAFT_EVENT, SERVER_COMMAND }
} = eventBus;

const {joinMercs, joinKams, joinWarriors, joinLegion, defectFromFaction} = require("../factionManager")



module.exports = function registerChatLinkModule({ bot, server }) {
  const client = bot?.client;

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event === 'event' && content?.initiator) {
      console.log(content.message);
      switch(content.message.split(";")[0]) {
        case("join_mercs"): {
          const minecraftUsername = content.initiator;
          joinMercs();
          break;
        }
        case("join_kams"): {
          const minecraftUsername = content.initiator;
          joinKams();
          break;
        }
        case("join_warriors"): {
          const minecraftUsername = content.initiator;
          joinWarriors();
          break;
        }
        case("join_legion"): {
          const minecraftUsername = content.initiator;
          joinLegion();
          break;
        }
        case("defect_from_faction"): {
          const minecraftUsername = content.initiator;
          defectFromFaction();
          break;
        }
        case("banish_from_faction"): {
          const defectorMinecraftUsername = content.message.slice(content.message.indexOf(";")+1).trim();
          const factionLeaderMinecraftUsername = content.initiator;
          defectFromFaction();
          break;
        }
      }
    }

  });
};
