const { SlashCommandBuilder } = require('discord.js');
const { replyWithRequestResult } = require('../interactionResponses');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sendmessage')
    .setDescription('Send a message to the Minecraft server (Royalty only)')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Message to broadcast to the server').setRequired(true)
    ),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can send server messages.');
    if (!allowed) return;

    const message = interaction.options.getString('message', true);
    await replyWithRequestResult(
      interaction,
      eventBus.request(events.SERVER_COMMAND, { action: 'command', command: `say ${message}` })
    );
  }
};
