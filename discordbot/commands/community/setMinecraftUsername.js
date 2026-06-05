const { SlashCommandBuilder } = require('discord.js');
const {
  isDuplicateMinecraftUsernameError,
  saveProfileAndQueueAllowlist
} = require('../minecraftProfileAllowlist');
const { safeReply } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setminecraftusername')
    .setDescription('Set your Minecraft username')
    .addStringOption((opt) => opt.setName('username').setDescription('Your Minecraft username').setRequired(true)),
  async execute(interaction, { upsertMinecraftProfile, getMinecraftProfileByDiscordId, eventBus, events, applicationRoles }) {
    const memberRoles = interaction.member?.roles?.cache;
    if (applicationRoles?.outsider && memberRoles?.has(applicationRoles.outsider)) {
      await interaction.reply({
        content: 'You must have an accepted application before setting your Minecraft username.',
        ephemeral: true
      });
      return;
    }

    if (applicationRoles?.liege && !memberRoles?.has(applicationRoles.liege)) {
      await interaction.reply({
        content: 'Only players with the Liege role can use this command.',
        ephemeral: true
      });
      return;
    }

    const username = interaction.options.getString('username', true).trim();
    if (!username) {
      await interaction.reply({ content: 'Please provide a valid username.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

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
        await safeReply(interaction, {
          content: `**${username}** is already linked to another Discord user. Please enter your own Minecraft username.`,
        });
        return;
      }

      throw err;
    }

    const removedOldUsername = result.removedOldUsername
      ? ` ${result.removalResult?.message || `Removed old allowlist entry for ${result.removedOldUsername}.`}`
      : '';
    const allowlistMessage = result.allowlistResult?.message || 'Allowlist update completed.';

    await safeReply(interaction, {
      content: `Saved your Minecraft username as **${result.profile.username}**. ${allowlistMessage}${removedOldUsername} We'll capture your XUID when you join the server.`,
    });
  }
};
