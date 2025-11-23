const { SlashCommandBuilder } = require('discord.js');

async function resolveXuid(player, getAllowlistEntryByName, getMinecraftProfileByUsername) {
  const trimmed = player?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;

  const allowlistEntry = await getAllowlistEntryByName(trimmed);
  if (allowlistEntry?.xuid) return allowlistEntry.xuid;

  const profile = await getMinecraftProfileByUsername(trimmed);
  if (profile?.xuid) return profile.xuid;

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('op')
    .setDescription('Promote a player to operator and persist the change (Royalty only)')
    .addStringOption((opt) => opt.setName('player').setDescription('Player name or XUID').setRequired(true)),
  async execute(
    interaction,
    { ensureRole, roleIds, eventBus, events, getAllowlistEntryByName, getMinecraftProfileByUsername }
  ) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can promote operators.');
    if (!allowed) return;

    const player = interaction.options.getString('player', true);
    const xuid = await resolveXuid(player, getAllowlistEntryByName, getMinecraftProfileByUsername);
    if (!xuid) {
      await interaction.reply({
        content: 'Could not resolve a valid XUID for that player. Please provide a XUID or add one to the database first.',
        ephemeral: true
      });
      return;
    }

    eventBus.emit(events.SERVER_COMMAND, { action: 'permission:set', xuid, permission: 'operator' });
    await interaction.reply({ content: `Operator status granted for XUID **${xuid}**.`, ephemeral: true });
  }
};
