const { SlashCommandBuilder } = require('discord.js');
const {
  isDuplicateMinecraftUsernameError,
  saveProfileAndQueueAllowlist
} = require('../minecraftProfileAllowlist');
const { safeReply } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changeplayerusername')
    .setDescription("Change a player's Minecraft username (Royalty only)")
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((opt) => opt.setName('username').setDescription('New Minecraft username').setRequired(true)),
  async execute(
    interaction,
    { ensureRole, roleIds, upsertMinecraftProfile, getMinecraftProfileByDiscordId, eventBus, events, formatUser }
  ) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can change player usernames.');
    if (!allowed) return;

    const user = interaction.options.getUser('user', true);
    const username = interaction.options.getString('username', true).trim();
    if (!username) {
      await interaction.reply({ content: 'Please provide a valid username.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    let result;
    try {
      result = await saveProfileAndQueueAllowlist({
        discordId: user.id,
        username,
        getMinecraftProfileByDiscordId,
        upsertMinecraftProfile,
        eventBus,
        events
      });
    } catch (err) {
      if (isDuplicateMinecraftUsernameError(err)) {
        await safeReply(interaction, {
          content: `**${username}** is already linked to another Discord user.`,
        });
        return;
      }

      throw err;
    }

    const removedOldUsername = result.removedOldUsername
      ? ` ${result.removalResult?.message || `Removed old allowlist entry for ${result.removedOldUsername}.`} Cleared the saved XUID.`
      : '';
    const allowlistMessage = result.allowlistResult?.message || 'Allowlist update completed.';

    await safeReply(interaction, {
      content:
        `Updated Minecraft username for ${formatUser(user)} to **${result.profile.username}**. ${allowlistMessage}` +
        removedOldUsername,
    });
  }
};
