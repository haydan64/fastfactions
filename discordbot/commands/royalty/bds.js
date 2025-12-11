const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bds')
    .setDescription('Bedrock server management (Royalty only)')
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Run a command on the Bedrock server')
        .addStringOption((opt) =>
          opt.setName('command').setDescription('Command to send to the server').setRequired(true)
        )
    ),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can run server commands.');
    if (!allowed) return;

    const sub = interaction.options.getSubcommand();
    if (sub === 'run') {
      const command = interaction.options.getString('command', true);
      eventBus.emit(events.SERVER_COMMAND, { action: 'command', command });
      await interaction.reply({ content: `Sent command to Bedrock server: **${command}**`, ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'Unknown BDS action.', ephemeral: true });
  }
};
