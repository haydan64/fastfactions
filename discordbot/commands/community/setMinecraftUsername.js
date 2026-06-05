const { SlashCommandBuilder } = require('discord.js');
const {
  isDuplicateMinecraftUsernameError,
  saveProfileAndQueueAllowlist
} = require('../minecraftProfileAllowlist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setminecraftusername')
    .setDescription('Set your Minecraft username')
    .addStringOption((opt) => opt.setName('username').setDescription('Your Minecraft username').setRequired(true)),
  async execute(interaction, { upsertMinecraftProfile, getMinecraftProfileByDiscordId, eventBus, events }) {
    const username = interaction.options.getString('username', true).trim();
    if (!username) {
      await interaction.reply({ content: 'Please provide a valid username.', ephemeral: true });
      return;
    }

    let result;
    try {
      result = await saveProfileAndQueueAllowlist({
        discordId: interaction.user.id,
        username,
        getMinecraftProfileByDiscordId,
        upsertMinecraftProfile,
        eventBus,
        events
      });
    } catch (err) {
      if (isDuplicateMinecraftUsernameError(err)) {
        await interaction.reply({
          content: `**${username}** is already linked to another Discord user. Please enter your own Minecraft username.`,
          ephemeral: true
        });
        return;
      }

      throw err;
    }

    const removedOldUsername = result.removedOldUsername
      ? ` ${result.removalResult?.message || `Removed old allowlist entry for ${result.removedOldUsername}.`}`
      : '';
    const allowlistMessage = result.allowlistResult?.message || 'Allowlist update completed.';

    await interaction.reply({
      content: `Saved your Minecraft username as **${result.profile.username}**. ${allowlistMessage}${removedOldUsername} We'll capture your XUID when you join the server.`,
      ephemeral: true
    });
  }
};
