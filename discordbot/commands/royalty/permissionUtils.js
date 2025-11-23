async function resolvePlayerIdentity(identifier, helpers) {
  const normalized = identifier.trim();
  const {
    getMinecraftProfileByUsername,
    getMinecraftProfileByXuid,
    getAllowlistEntryByName,
    getAllowlistEntryByXuid
  } = helpers;

  let name = null;
  let xuid = null;

  if (normalized) {
    const profileByUsername = await getMinecraftProfileByUsername(normalized);
    if (profileByUsername) {
      name = profileByUsername.username || name;
      xuid = profileByUsername.xuid || xuid;
    }

    if (!xuid) {
      const profileByXuid = await getMinecraftProfileByXuid(normalized);
      if (profileByXuid) {
        name = profileByXuid.username || name;
        xuid = profileByXuid.xuid || normalized;
      }
    }

    const allowlistByName = await getAllowlistEntryByName(normalized);
    if (allowlistByName) {
      name = allowlistByName.name || name;
      xuid = allowlistByName.xuid || xuid;
    }

    if (!xuid) {
      const allowlistByXuid = await getAllowlistEntryByXuid(normalized);
      if (allowlistByXuid) {
        name = allowlistByXuid.name || name;
        xuid = allowlistByXuid.xuid || normalized;
      }
    }
  }

  return { name: name || normalized, xuid };
}

module.exports = { resolvePlayerIdentity };
