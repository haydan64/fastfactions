const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('savebackup')
    .setDescription('Create a running backup of the Bedrock server (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can trigger backups.');
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'backup' });
    await interaction.reply({ content: 'Backup requested for the Bedrock server.', ephemeral: true });
  }
};
