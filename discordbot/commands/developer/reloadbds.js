const { SlashCommandBuilder } = require('discord.js');

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

    eventBus.emit(events.SERVER_COMMAND, { action: 'reload' });
    await interaction.reply({ content: 'reload requested for Bedrock server.', ephemeral: true });
  }
};
