const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcestopbds')
    .setDescription('Force-stop the Bedrock server (Developers only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.DEVELOPER],
      'Only developers can force-stop the Bedrock server.'
    );
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'force-stop' });
    await interaction.reply({ content: 'Force stop signal sent to the Bedrock server.', ephemeral: true });
  }
};
