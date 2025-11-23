const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restartbds')
    .setDescription('Gracefully restart the Bedrock server (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.ROYALTY],
      'Only Royalty can restart the Bedrock server.'
    );
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'restart' });
    await interaction.reply({ content: 'Restart signal sent to the Bedrock server.', ephemeral: true });
  }
};
