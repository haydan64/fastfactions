const eventBus = require('../eventBus');

const {
  EVENTS: { MINECRAFT_EVENT, SERVER_COMMAND }
} = eventBus;



module.exports = function registerChatLinkModule({ bot, server }) {
  const client = bot?.client;

  eventBus.on(MINECRAFT_EVENT, async ({ event, content }) => {
    if (event === 'event' && content?.initiator) {
      console.log(content.message);
      switch(content.message) {
        case("join_kams"): {

          break;
        }
        case("join_mercs"): {

          break;
        }
        case("join_warriors"): {

          break;
        }
        case("join_legion"): {

          break;
        }
      }
    }

  });
};
