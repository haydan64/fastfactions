const { SlashCommandBuilder } = require('discord.js');
const {
  isDuplicateMinecraftUsernameError,
  requestAllowlistRemoval,
  requestAllowlistUpdate
} = require('../minecraftProfileAllowlist');
const { safeReply } = require('../interactionResponses');

function sameUsername(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changeplayerusername')
    .setDescription("Change a player's Minecraft username (Royalty only)")
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((opt) => opt.setName('username').setDescription('New Minecraft username').setRequired(true)),
  async execute(
    interaction,
    {
      ensureRole,
      roleIds,
      upsertMinecraftProfile,
      getMinecraftProfileByDiscordId,
      getMinecraftProfileByUsername,
      eventBus,
      events,
      formatUser
    }
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

    const previousProfile = await getMinecraftProfileByDiscordId(user.id);
    const conflictingProfile = await getMinecraftProfileByUsername(username);
    if (conflictingProfile && conflictingProfile.discord_id !== user.id) {
      await safeReply(interaction, {
        content: `**${username}** is already linked to another Discord user.`,
      });
      return;
    }

    const usernameChanged = previousProfile?.username && !sameUsername(previousProfile.username, username);
    let removalResult = null;
    try {
      if (usernameChanged) {
        removalResult = await requestAllowlistRemoval(eventBus, events, previousProfile.username);
      }

      const result = await upsertMinecraftProfile(user.id, username, {
        clearXuidOnUsernameChange: true
      });
      const profile = result?.rows?.[0] || result;
      const allowlistResult = await requestAllowlistUpdate(eventBus, events, profile);

      const removedOldUsername = usernameChanged
        ? ` ${removalResult?.message || `Removed old allowlist entry for ${previousProfile.username}.`} Cleared the saved XUID.`
        : '';

      await safeReply(interaction, {
        content:
          `Updated Minecraft username for ${formatUser(user)} to **${profile.username}**. ${allowlistResult.message}` +
          removedOldUsername,
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
  }
};
