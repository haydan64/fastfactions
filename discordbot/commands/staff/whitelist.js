const { SlashCommandBuilder } = require('discord.js');
const { requestAllowlistUpdate } = require('../minecraftProfileAllowlist');
const { replyWithRequestResult } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist a community member (Staff only)')
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user to whitelist').setRequired(true)),
  async execute(interaction, { ensureRole, roleIds, getMinecraftProfileByDiscordId, eventBus, formatUser, events }) {
    const allowed = await ensureRole(
      interaction,
      [roleIds.STAFF, roleIds.ROYALTY, roleIds.DEVELOPER],
      'Only staff can update the whitelist.'
    );
    if (!allowed) return;

    const user = interaction.options.getUser('user', true);
    const profile = await getMinecraftProfileByDiscordId(user.id);
    if (!profile) {
      await interaction.reply({
        content: `${formatUser(user)} has not set a Minecraft username. Ask them to run /setMinecraftUsername first.`,
        ephemeral: true
      });
      return;
    }

    await replyWithRequestResult(interaction, requestAllowlistUpdate(eventBus, events, profile));
  }
};
