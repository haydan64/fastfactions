const { EventEmitter } = require('events');

const EVENTS = {
  SERVER_LOG: 'server:log',
  SERVER_STATE: 'server:state',
  SERVER_COMMAND: 'server:command',
  SERVER_BACKUP: 'server:backup',
  DISCORD_LOG: 'discord:log',
  MINECRAFT_EVENT: 'minecraft:event'
};

const eventBus = new EventEmitter({ captureRejections: true });

eventBus.setMaxListeners(50);

Object.entries(EVENTS).forEach(([key, value]) => {
  if(value === "server:log") return;
  eventBus.on(value, (...args) => {
    console.log(`[EventBus] Event: ${key}`, ...args);
  });
});

eventBus.EVENTS = EVENTS;

module.exports = eventBus;
