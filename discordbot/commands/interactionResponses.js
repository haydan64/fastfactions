async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      const { ephemeral, ...editPayload } = payload || {};
      return await interaction.editReply(editPayload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    console.error(`Failed to respond to interaction ${interaction.commandName || 'unknown'}:`, err.message);
    return null;
  }
}

async function replyWithRequestResult(interaction, requestPromise, options = {}) {
  const ephemeral = options.ephemeral !== false;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }

  try {
    const result = await requestPromise;
    return safeReply(interaction, {
      content: result?.message || options.successMessage || 'Done.'
    });
  } catch (err) {
    console.error(`Request-backed command failed for ${interaction.commandName || 'unknown'}:`, err);
    return safeReply(interaction, {
      content: options.errorMessage || `There was an error completing that request: ${err.message}`
    });
  }
}

module.exports = {
  replyWithRequestResult,
  safeReply
};
