const { SlashCommandBuilder } = require('discord.js');
const { resolvePlayerIdentity } = require('./permissionUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deop')
    .setDescription('Demote an operator back to member (Royalty only)')
    .addStringOption((opt) => opt.setName('player').setDescription('Player name or XUID').setRequired(true)),
  async execute(interaction, helpers) {
    const { ensureRole, roleIds, eventBus, events } = helpers;
    const allowed = await ensureRole(interaction, [roleIds.ROYALTY], 'Only Royalty can demote operators.');
    if (!allowed) return;

    const identifier = interaction.options.getString('player', true);
    const { name, xuid } = await resolvePlayerIdentity(identifier, helpers);

    if (!xuid) {
      await interaction.reply({
        content:
          `Could not find an XUID for **${identifier}**. Make sure they have joined the server, or update their profile then re-whitelist them.`,
        ephemeral: true
      });
      return;
    }

    eventBus.emit(events.SERVER_COMMAND, { action: 'command', command: `deop "${name}"` });
    eventBus.emit(events.SERVER_COMMAND, { action: 'permission:set', xuid, permission: 'member' });

    await interaction.reply({
      content: `Demotion queued for **${name}** (XUID: ${xuid}).`,
      ephemeral: true
    });
  }
};
