const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwhitelist')
    .setDescription('Remove a community member from the whitelist (Staff only)')
    .addUserOption((opt) => opt.setName('user').setDescription('Discord user to remove').setRequired(true)),
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
        content: `${formatUser(user)} does not have a saved Minecraft username.`,
        ephemeral: true
      });
      return;
    }

    eventBus.emit(events.SERVER_COMMAND, { action: 'allowlist:remove', name: profile.username });
    await interaction.reply({ content: `Queued whitelist removal for **${profile.username}**.`, ephemeral: true });
  }
};
