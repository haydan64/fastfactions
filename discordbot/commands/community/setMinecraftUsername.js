const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setminecraftusername')
    .setDescription('Set your Minecraft username')
    .addStringOption((opt) => opt.setName('username').setDescription('Your Minecraft username').setRequired(true)),
  async execute(interaction, { upsertMinecraftProfile }) {
    const username = interaction.options.getString('username', true).trim();
    if (!username) {
      await interaction.reply({ content: 'Please provide a valid username.', ephemeral: true });
      return;
    }

    try {
      await upsertMinecraftProfile(interaction.user.id, username);
    } catch (err) {
      if (err?.code === '23505' && err?.constraint === 'players_username_lower_idx') {
        await interaction.reply({
          content: `**${username}** is already linked to another Discord user. Please enter your own Minecraft username.`,
          ephemeral: true
        });
        return;
      }

      throw err;
    }

    await interaction.reply({
      content: `Saved your Minecraft username as **${username}**. We'll capture your XUID when you join the server.`,
      ephemeral: true
    });
  }
};
