const { SlashCommandBuilder } = require('discord.js');
const {
  FACTION_ROLES,
  setMemberFactionRole,
  clearMemberFactionRoles
} = require('../../../factionManager');
const { safeReply } = require('../interactionResponses');

const FACTION_CHOICES = [
  { name: FACTION_ROLES.kams.name, value: 'kams' },
  { name: FACTION_ROLES.legion.name, value: 'legion' },
  { name: FACTION_ROLES.warriors.name, value: 'warriors' },
  { name: FACTION_ROLES.mercs.name, value: 'mercs' },
  { name: 'None', value: 'none' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changeplayerfaction')
    .setDescription("Change or clear a player's faction role (Royalty only)")
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('faction')
        .setDescription('Faction to assign, or None to clear faction roles')
        .setRequired(true)
        .addChoices(...FACTION_CHOICES)
    ),
  async execute(interaction, { ensureRole, roleIds, formatUser }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can change player factions.');
    if (!allowed) return;

    const user = interaction.options.getUser('user', true);
    const faction = interaction.options.getString('faction', true);

    await interaction.deferReply({ ephemeral: true });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await safeReply(interaction, {
        content: `Could not find ${formatUser(user)} in this server.`
      });
      return;
    }

    const reason = `Faction changed by ${interaction.user.tag || interaction.user.id}`;
    const result = faction === 'none'
      ? await clearMemberFactionRoles(member, reason)
      : await setMemberFactionRole(member, faction, reason);

    await safeReply(interaction, {
      content: result.ok
        ? `${result.message} Target: ${formatUser(user)}.`
        : `Could not update ${formatUser(user)}: ${result.message}`
    });
  }
};
