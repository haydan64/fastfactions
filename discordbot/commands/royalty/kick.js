const { SlashCommandBuilder } = require('discord.js');

function sanitizeReason(reason) {
  return reason.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a player from the Minecraft server (Royalty only)')
    .addStringOption((opt) => opt.setName('player').setDescription('Player name or XUID').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for kick').setRequired(true)),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.ROYALTY],
      'Only Royalty can kick players from the server.'
    );
    if (!allowed) return;

    const player = interaction.options.getString('player', true).trim();
    const reason = sanitizeReason(interaction.options.getString('reason', true));

    const command = reason ? `kick "${player}" ${reason}` : `kick "${player}"`;
    eventBus.emit(events.SERVER_COMMAND, { action: 'command', command });

    await interaction.reply({
      content: `Queued kick for **${player}** with reason: ${reason || 'No reason provided'}.`,
      ephemeral: true
    });
  }
};
