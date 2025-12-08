const { SlashCommandBuilder } = require('discord.js');
const { sendInitialApplicationMessage } = require('../../applicationFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-application')
    .setDescription("Reset a player's application status and roles")
    .addUserOption((opt) => opt.setName('user').setDescription('Player to reset').setRequired(true)),
  async execute(interaction, context) {
    const { ensureRole, roleIds, resetApplication, applicationRoles, formatUser, applicationChannels, applicationQuestions } = context;
    const allowed = await ensureRole(
      interaction,
      [roleIds.STAFF, roleIds.ROYALTY, roleIds.DEVELOPER],
      'Only staff can reset applications.'
    );
    if (!allowed) return;

    const targetUser = interaction.options.getUser('user', true);
    await resetApplication(targetUser.id);

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (member) {
      if (applicationRoles?.liege && member.roles.cache.has(applicationRoles.liege)) {
        await member.roles.remove(applicationRoles.liege).catch(() => null);
      }
      if (applicationRoles?.outsider && !member.roles.cache.has(applicationRoles.outsider)) {
        await member.roles.add(applicationRoles.outsider).catch(() => null);
      }
    }

    const waitingRoomChannelId = applicationChannels?.waitingRoom;
    const initialPrompt = await sendInitialApplicationMessage(
      targetUser,
      applicationQuestions || [],
      interaction.guild,
      waitingRoomChannelId
    );

    const promptLocation =
      initialPrompt?.location === 'dm'
        ? 'Sent a fresh application prompt to their DMs.'
        : initialPrompt?.location === 'waiting-room'
        ? 'Could not DM the user, so a new prompt was sent in the waiting room.'
        : 'Unable to deliver a new application prompt.';

    await interaction.reply({
      content: `Reset application status for ${formatUser(
        targetUser
      )}. Liege role removed and outsider role applied when possible. ${promptLocation}`,
      ephemeral: true
    });
  }
};
