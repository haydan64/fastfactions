const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restartbds')
    .setDescription('Restart the Bedrock server gracefully (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can restart the server.');
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'restart' });
    await interaction.reply({ content: 'Bedrock server restart requested.', ephemeral: true });
  }
};
