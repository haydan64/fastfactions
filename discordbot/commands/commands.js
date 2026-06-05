const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Sir Aldric command groups')
    .addSubcommandGroup((group) =>
      group
        .setName('developer')
        .setDescription('Developer utilities')
        .addSubcommand((sub) => sub.setName('ping').setDescription('Ping Sir Aldric'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('staff')
        .setDescription('Staff tools')
        .addSubcommand((sub) =>
          sub
            .setName('allowlist-add')
            .setDescription('Add a player to the server allowlist')
            .addStringOption((opt) => opt.setName('name').setDescription('Xbox Gamertag').setRequired(true))
            .addStringOption((opt) => opt.setName('xuid').setDescription('Optional XUID for the player').setRequired(false))
            .addBooleanOption((opt) =>
              opt
                .setName('ignores_player_limit')
                .setDescription('Allow player to bypass player limit')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('allowlist-remove')
            .setDescription('Remove a player from the server allowlist')
            .addStringOption((opt) => opt.setName('name').setDescription('Xbox Gamertag').setRequired(true))
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('community')
        .setDescription('Community commands')
        .addSubcommand((sub) => sub.setName('help').setDescription('Player commands list'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('management')
        .setDescription('Management commands')
        .addSubcommand((sub) =>
          sub
            .setName('permission-set')
            .setDescription('Set a player permission level by XUID')
            .addStringOption((opt) => opt.setName('xuid').setDescription('Player XUID').setRequired(true))
            .addStringOption((opt) =>
              opt
                .setName('permission')
                .setDescription('Permission level')
                .addChoices(
                  { name: 'operator', value: 'operator' },
                  { name: 'member', value: 'member' },
                  { name: 'visitor', value: 'visitor' }
                )
                .setRequired(true)
            )
        )
    ),
  async execute(interaction, { ensureRole, roleIds, eventBus, events }) {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (group === 'developer' && sub === 'ping') {
      const allowed = await ensureRole(
        interaction,
        [roleIds.DEVELOPER],
        'Only developers can use /commands developer ping.'
      );
      if (!allowed) return;

      const sent = await interaction.reply({ content: 'Pong!', ephemeral: true, fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.followUp({ content: `Round-trip latency: ${latency}ms`, ephemeral: true });
      return;
    }

    if (group === 'staff' && sub === 'allowlist-add') {
      const allowed = await ensureRole(
        interaction,
        [roleIds.STAFF, roleIds.ROYALTY, roleIds.DEVELOPER],
        'Only staff can update the whitelist.'
      );
      if (!allowed) return;
      const name = interaction.options.getString('name', true);
      const xuid = interaction.options.getString('xuid');
      const ignoresLimit = interaction.options.getBoolean('ignores_player_limit') || false;
      const result = await eventBus.request(events.SERVER_COMMAND, {
        action: 'allowlist:add',
        name,
        xuid,
        ignoresPlayerLimit: ignoresLimit
      });
      await interaction.reply({ content: result.message, ephemeral: true });
      return;
    }

    if (group === 'staff' && sub === 'allowlist-remove') {
      const allowed = await ensureRole(
        interaction,
        [roleIds.STAFF, roleIds.ROYALTY, roleIds.DEVELOPER],
        'Only staff can update the whitelist.'
      );
      if (!allowed) return;
      const name = interaction.options.getString('name', true);
      const result = await eventBus.request(events.SERVER_COMMAND, { action: 'allowlist:remove', name });
      await interaction.reply({ content: result.message, ephemeral: true });
      return;
    }

    if (group === 'management' && sub === 'permission-set') {
      const allowed = await ensureRole(
        interaction,
        [roleIds.ROYALTY, roleIds.DEVELOPER],
        'Only management can set permissions.'
      );
      if (!allowed) return;
      const xuid = interaction.options.getString('xuid', true);
      const permission = interaction.options.getString('permission', true);
      const result = await eventBus.request(events.SERVER_COMMAND, { action: 'permission:set', xuid, permission });
      await interaction.reply({
        content: result.message,
        ephemeral: true
      });
      return;
    }

    await interaction.reply({ content: 'Unknown or unimplemented command.', ephemeral: true });
  }
};
