const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('stopbds').setDescription('Stop the Bedrock server (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can stop the server.');
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'stop' });
    await interaction.reply({ content: 'Bedrock server stop requested.', ephemeral: true });
  }
};
