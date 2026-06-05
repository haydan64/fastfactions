const { SlashCommandBuilder } = require('discord.js');
const { replyWithRequestResult } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reloadbds')
    .setDescription('Reloads the addons on the bedrock server.'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.DEVELOPER],
      'Only developers can reload the addons on the bds.'
    );
    if (!allowed) return;

    await replyWithRequestResult(interaction, eventBus.request(events.SERVER_COMMAND, { action: 'reload' }));
  }
};
