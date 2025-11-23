const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changeplayerusername')
    .setDescription("Change a player's Minecraft username (Royalty only)")
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((opt) => opt.setName('username').setDescription('New Minecraft username').setRequired(true)),
  async execute(interaction, { ensureRole, roleIds, upsertMinecraftProfile, formatUser }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can change player usernames.');
    if (!allowed) return;

    const user = interaction.options.getUser('user', true);
    const username = interaction.options.getString('username', true).trim();
    if (!username) {
      await interaction.reply({ content: 'Please provide a valid username.', ephemeral: true });
      return;
    }

    await upsertMinecraftProfile(user.id, username);
    await interaction.reply({
      content:
        `Updated Minecraft username for ${formatUser(user)} to **${username}**.\n` +
        'If the player is using a different Microsoft account, run `/unbindXUID [user]` and re-add them to the whitelist.',
      ephemeral: true
    });
  }
};
