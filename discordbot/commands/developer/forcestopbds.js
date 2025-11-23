const { SlashCommandBuilder } = require('discord.js');

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

    eventBus.emit(events.SERVER_COMMAND, { action: 'forceStop' });
    await interaction.reply({ content: 'Force stop requested for Bedrock server.', ephemeral: true });
  }
};
