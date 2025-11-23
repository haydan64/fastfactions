const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('stopbds').setDescription('Gracefully stop the Bedrock server (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.ROYALTY],
      'Only Royalty can stop the Bedrock server.'
    );
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'stop' });
    await interaction.reply({ content: 'Stop signal sent to the Bedrock server.', ephemeral: true });
  }
};
