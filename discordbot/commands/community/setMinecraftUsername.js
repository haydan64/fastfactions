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

    await upsertMinecraftProfile(interaction.user.id, username);
    await interaction.reply({
      content: `Saved your Minecraft username as **${username}**. We'll capture your XUID when you join the server.`,
      ephemeral: true
    });
  }
};
