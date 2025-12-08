const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buildResponseMap, formatResponses } = require('../../applicationFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-application')
    .setDescription('View a player\'s application')
    .addUserOption((opt) => opt.setName('user').setDescription('Player to view')), 
  async execute(interaction, context) {
    const { ensureRole, roleIds, applicationQuestions, getApplicationResponses, getApplication, formatUser } = context;
    const allowed = await ensureRole(
      interaction,
      [roleIds.STAFF, roleIds.ROYALTY, roleIds.DEVELOPER],
      'Only staff can view applications.'
    );
    if (!allowed) return;

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const questions = applicationQuestions || [];
    const responses = await getApplicationResponses(targetUser.id);
    const responseMap = buildResponseMap(responses);
    const description = formatResponses(responseMap, questions);
    const application = (await getApplication(targetUser.id)) || { status: 'draft' };

    const statusDetails = [`Status: **${application.status || 'draft'}**`];
    if (application.denial_reason) {
      statusDetails.push(`Denial reason: ${application.denial_reason}`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Application for ${formatUser(targetUser)}`)
      .setDescription(description)
      .addFields({ name: 'Details', value: statusDetails.join('\n') })
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
