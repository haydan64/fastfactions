const { SlashCommandBuilder } = require('discord.js');
const {
  isDuplicateMinecraftUsernameError,
  requestAllowlistRemoval,
  saveProfileAndQueueAllowlist
} = require('../minecraftProfileAllowlist');
const { safeReply } = require('../interactionResponses');
const { sendUsernameChangeReview } = require('../../usernameChangeReview');

function sameUsername(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setminecraftusername')
    .setDescription('Set your Minecraft username')
    .addStringOption((opt) => opt.setName('username').setDescription('Your Minecraft username').setRequired(true)),
  async execute(
    interaction,
    {
      upsertMinecraftProfile,
      getMinecraftProfileByDiscordId,
      getMinecraftProfileByUsername,
      clearMinecraftProfileXuid,
      eventBus,
      events,
      applicationRoles,
      applicationChannels
    }
  ) {
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

    const existingProfile = await getMinecraftProfileByDiscordId(interaction.user.id);
    const isUsernameChange = existingProfile?.username && !sameUsername(existingProfile.username, username);

    await interaction.deferReply({ ephemeral: true });

    if (isUsernameChange) {
      const conflictingProfile = await getMinecraftProfileByUsername(username);
      if (conflictingProfile && conflictingProfile.discord_id !== interaction.user.id) {
        await safeReply(interaction, {
          content: `**${username}** is already linked to another Discord user. Please enter your own Minecraft username.`
        });
        return;
      }

      const reviewResult = await sendUsernameChangeReview(
        interaction.client,
        applicationChannels?.waitingRoom || '790378409024028702',
        {
          user: interaction.user,
          oldUsername: existingProfile.username,
          newUsername: username
        }
      );

      if (!reviewResult.ok) {
        await safeReply(interaction, { content: reviewResult.message });
        return;
      }

      const removalResult = await requestAllowlistRemoval(eventBus, events, existingProfile.username);
      await clearMinecraftProfileXuid(interaction.user.id);

      await safeReply(interaction, {
        content:
          `${removalResult.message} Cleared your saved XUID. ` +
          'Your username change request has been sent to staff for review.'
      });
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
