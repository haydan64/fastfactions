const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a player from the Bedrock server (Royalty only)')
    .addStringOption((opt) =>
      opt.setName('player').setDescription('Player name or XUID').setRequired(true)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kick').setRequired(true)),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can kick players.');
    if (!allowed) return;

    const player = interaction.options.getString('player', true);
    const reason = interaction.options.getString('reason', true);
    const sanitizedReason = reason.replace(/"/g, "'");
    const result = await eventBus.request(events.SERVER_COMMAND, {
      action: 'command',
      command: `kick "${player}" ${sanitizedReason}`
    });
    await interaction.reply({ content: result.message, ephemeral: true });
  }
};
