const { SlashCommandBuilder } = require('discord.js');
const { replyWithRequestResult } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('savebackup')
    .setDescription('Create a running backup of the Bedrock server (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can trigger backups.');
    if (!allowed) return;

    await replyWithRequestResult(interaction, eventBus.request(events.SERVER_COMMAND, { action: 'backup' }));
  }
};
