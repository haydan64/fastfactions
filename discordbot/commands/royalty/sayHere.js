const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sayhere')
    .setDescription('Send a message as Sir Aldric in this channel (Royalty only)')
    .addStringOption((opt) => opt.setName('message').setDescription('Message to send').setRequired(true)),
  async execute(interaction, { ensureRole, roleIds }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can speak through Sir Aldric.');
    if (!allowed) return;

    const message = interaction.options.getString('message', true);
    await interaction.channel.send({ content: message });
    await interaction.reply({ content: 'Message sent in this channel.', ephemeral: true });
  }
};
