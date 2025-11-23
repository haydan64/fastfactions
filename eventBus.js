const { EventEmitter } = require('events');

const EVENTS = {
  SERVER_LOG: 'server:log',
  SERVER_STATE: 'server:state',
  SERVER_COMMAND: 'server:command',
  SERVER_BACKUP: 'server:backup',
  DISCORD_LOG: 'discord:log'
};

const eventBus = new EventEmitter({ captureRejections: true });

eventBus.setMaxListeners(50);

eventBus.EVENTS = EVENTS;

module.exports = eventBus;
