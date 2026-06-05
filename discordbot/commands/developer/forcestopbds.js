const { SlashCommandBuilder } = require('discord.js');
const { replyWithRequestResult } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcestopbds')
    .setDescription('Force stop the Bedrock server (Developers only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.DEVELOPER],
      'Only developers can force stop the Bedrock server.'
    );
    if (!allowed) return;

    await replyWithRequestResult(interaction, eventBus.request(events.SERVER_COMMAND, { action: 'forceStop' }));
  }
};
