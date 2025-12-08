const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

function truncateLabel(label) {
  return label.length > 45 ? `${label.slice(0, 42)}...` : label;
}

function buildQuestionSelect(questions) {
  const options = questions.map((question) => ({
    label: truncateLabel(question.prompt),
    description: question.label,
    value: question.id
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('application-question-select')
      .setPlaceholder('Select a question to answer')
      .addOptions(options)
  );
}

function formatResponses(responsesMap, questions) {
  if (!questions?.length) return 'No questions configured.';
  return questions
    .map((question, index) => {
      const answer = responsesMap.get(question.id);
      return `${index + 1}. ${question.prompt}\n➤ ${answer || '*No response yet*'}`;
    })
    .join('\n\n');
}

function hasAllRequiredResponses(responsesMap, questions) {
  return questions.every((question) => !question.required || (responsesMap.get(question.id) || '').trim().length);
}

async function sendWaitingRoomPrompt(channel, user, questions) {
  if (!channel || !channel.isTextBased()) return null;
  const components = [buildQuestionSelect(questions)];
  const content = `<@${user.id}> Welcome! Please start your application by selecting a question below.`;
  return channel.send({ content, components, allowedMentions: { users: [user.id] } });
}

function buildSubmitRow(responsesMap, questions) {
  if (!hasAllRequiredResponses(responsesMap, questions)) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('application-submit').setLabel('Submit for Approval').setStyle(ButtonStyle.Success)
  );
}

async function sendResponseSummary(interaction, responsesMap, questions) {
  const description = formatResponses(responsesMap, questions);
  const submitRow = buildSubmitRow(responsesMap, questions);
  const components = [buildQuestionSelect(questions)];
  if (submitRow) components.push(submitRow);

  await interaction.reply({
    content: 'Here is your application progress. You can continue editing your answers using the menu below.',
    embeds: [new EmbedBuilder().setTitle('Application Progress').setDescription(description).setColor(0x5865f2)],
    components,
    ephemeral: true
  });
}

async function handleQuestionSelect(interaction, questions, getApplicationResponse) {
  const questionId = interaction.values?.[0];
  const question = questions.find((q) => q.id === questionId);
  if (!question) {
    await interaction.reply({ content: 'That question is no longer available.', ephemeral: true });
    return;
  }

  const existingResponse = await getApplicationResponse(interaction.user.id, question.id);
  const modal = new ModalBuilder()
    .setCustomId(`application-modal-${question.id}`)
    .setTitle(truncateLabel(question.prompt) || 'Application Question');

  const responseInput = new TextInputBuilder()
    .setCustomId('response')
    .setLabel('Your answer')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  if (existingResponse?.response) {
    responseInput.setValue(existingResponse.response.slice(0, 4000));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(responseInput));
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction, questions, saveApplicationResponse, getApplicationResponses) {
  const questionId = interaction.customId.replace('application-modal-', '');
  const question = questions.find((q) => q.id === questionId);
  if (!question) {
    await interaction.reply({ content: 'That question is no longer available.', ephemeral: true });
    return;
  }

  const response = interaction.fields.getTextInputValue('response');
  await saveApplicationResponse(interaction.user.id, question.id, response);
  const responses = await getApplicationResponses(interaction.user.id);
  const responsesMap = new Map(responses.map((row) => [row.question_id, row.response]));
  await sendResponseSummary(interaction, responsesMap, questions);
}

async function handleSubmit(interaction, questions, getApplicationResponses, setApplicationStatus, sendToChannel, applicationsChannelId) {
  const responses = await getApplicationResponses(interaction.user.id);
  const responsesMap = new Map(responses.map((row) => [row.question_id, row.response]));
  if (!hasAllRequiredResponses(responsesMap, questions)) {
    await interaction.reply({ content: 'Please answer all required questions before submitting.', ephemeral: true });
    return;
  }

  const application = await setApplicationStatus(interaction.user.id, 'submitted');
  const fields = questions.map((question, index) => ({
    name: `${index + 1}. ${truncateLabel(question.prompt)}`,
    value: responsesMap.get(question.id) || '*No response*'
  }));

  const embed = new EmbedBuilder()
    .setTitle('New Player Application')
    .setDescription(`Applicant: <@${interaction.user.id}>`)
    .setColor(0x43b581)
    .addFields(fields)
    .setTimestamp();

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`application-approve-${interaction.user.id}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`application-deny-${interaction.user.id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
    )
  ];

  await sendToChannel(interaction.client, applicationsChannelId, { embeds: [embed], components });
  await interaction.reply({ content: 'Your application has been submitted for review.', ephemeral: true });
  return application;
}

function buildResponseMap(responses) {
  return new Map(responses.map((row) => [row.question_id, row.response]));
}

async function registerApplicationFlow(client, config, helpers) {
  const { waitingRoomChannelId, applicationsChannelId } = config;
  const {
    saveApplicationResponse,
    getApplicationResponses,
    getApplicationResponse,
    setApplicationStatus,
    sendToChannel,
    ensureRole,
    roleIds,
    rolesConfig
  } = helpers;
  const questions = config.questions || [];

  client.on('guildMemberAdd', async (member) => {
    if (!waitingRoomChannelId) return;
    const channel = member.guild.channels.cache.get(waitingRoomChannelId) || (await member.guild.channels.fetch(waitingRoomChannelId).catch(() => null));
    if (!channel) return;
    await sendWaitingRoomPrompt(channel, member.user, questions);
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'application-question-select') {
      await handleQuestionSelect(interaction, questions, getApplicationResponse);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('application-modal-')) {
      await handleModalSubmit(interaction, questions, saveApplicationResponse, getApplicationResponses);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'application-submit') {
      await handleSubmit(
        interaction,
        questions,
        getApplicationResponses,
        setApplicationStatus,
        sendToChannel,
        applicationsChannelId
      );
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('application-approve-')) {
      const targetUserId = interaction.customId.replace('application-approve-', '');
      const allowed = await ensureRole(
        interaction,
        [roleIds?.STAFF, roleIds?.ROYALTY, roleIds?.DEVELOPER].filter(Boolean),
        'Only staff can review applications.'
      );
      if (!allowed) return;

      await setApplicationStatus(targetUserId, 'accepted', interaction.user.id);
      const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);

      if (member) {
        if (rolesConfig?.outsider && member.roles.cache.has(rolesConfig.outsider)) {
          await member.roles.remove(rolesConfig.outsider).catch(() => null);
        }
        if (rolesConfig?.liege) {
          await member.roles.add(rolesConfig.liege).catch(() => null);
        }
      }

      await interaction.reply({ content: `Application for <@${targetUserId}> has been accepted.`, ephemeral: true });

      const notification = `Your application has been accepted! Welcome to the server.`;
      const waitingRoomChannel = waitingRoomChannelId
        ? interaction.guild.channels.cache.get(waitingRoomChannelId) ||
          (await interaction.guild.channels.fetch(waitingRoomChannelId).catch(() => null))
        : null;
      if (member) {
        await member.send(notification).catch(async () => {
          if (waitingRoomChannel) {
            await waitingRoomChannel.send({
              content: `<@${targetUserId}> ${notification}`,
              allowedMentions: { users: [targetUserId] }
            });
          }
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('application-deny-')) {
      const targetUserId = interaction.customId.replace('application-deny-', '');
      const allowed = await ensureRole(
        interaction,
        [roleIds?.STAFF, roleIds?.ROYALTY, roleIds?.DEVELOPER].filter(Boolean),
        'Only staff can review applications.'
      );
      if (!allowed) return;

      const modal = new ModalBuilder()
        .setCustomId(`application-deny-modal-${targetUserId}`)
        .setTitle('Deny Application');

      const reasonInput = new TextInputBuilder()
        .setCustomId('deny-reason')
        .setLabel('Reason for denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('application-deny-modal-')) {
      const targetUserId = interaction.customId.replace('application-deny-modal-', '');
      const allowed = await ensureRole(
        interaction,
        [roleIds?.STAFF, roleIds?.ROYALTY, roleIds?.DEVELOPER].filter(Boolean),
        'Only staff can review applications.'
      );
      if (!allowed) return;

      const reason = interaction.fields.getTextInputValue('deny-reason');
      await setApplicationStatus(targetUserId, 'denied', interaction.user.id, reason);

      const waitingRoomChannel = waitingRoomChannelId
        ? interaction.guild.channels.cache.get(waitingRoomChannelId) ||
          (await interaction.guild.channels.fetch(waitingRoomChannelId).catch(() => null))
        : null;
      const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      const notice = `Your application was denied. Reason: ${reason}`;
      if (member) {
        await member.send(notice).catch(async () => {
          if (waitingRoomChannel) {
            await waitingRoomChannel.send({
              content: `<@${targetUserId}> ${notice}`,
              allowedMentions: { users: [targetUserId] }
            });
          }
        });
      } else if (waitingRoomChannel) {
        await waitingRoomChannel.send({
          content: `<@${targetUserId}> ${notice}`,
          allowedMentions: { users: [targetUserId] }
        });
      }

      await interaction.reply({ content: `Denied application for <@${targetUserId}>.`, ephemeral: true });
      return;
    }
  });
}

module.exports = {
  registerApplicationFlow,
  buildQuestionSelect,
  formatResponses,
  hasAllRequiredResponses,
  buildResponseMap
};
