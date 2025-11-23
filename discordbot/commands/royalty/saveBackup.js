const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('savebackup')
    .setDescription('Create a backup of the Bedrock server while it is running (Royalty only)'),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.ROYALTY],
      'Only Royalty can trigger backups.'
    );
    if (!allowed) return;

    eventBus.emit(events.SERVER_COMMAND, { action: 'backup' });
    await interaction.reply({ content: 'Backup requested. Check logs for completion.', ephemeral: true });
  }
};
