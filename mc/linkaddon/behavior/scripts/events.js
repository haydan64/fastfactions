import { world, system } from "@minecraft/server";

world.beforeEvents.chatSend.subscribe((eventData) => {
    const message = eventData.message;
    console.info("[MCLINK] [CHAT SENT]", JSON.stringify({
        message: eventData.message,
        sender: eventData.sender.name,
        targets: eventData.targets?.map(t => t.name)
    }));
    eventData.cancel = true;

    let nameColor = "";
    if (eventData.sender.hasTag("war")) nameColor = "§4";
    else if (eventData.sender.hasTag("leg")) nameColor = "§3";
    else if (eventData.sender.hasTag("kam")) nameColor = "§g";
    else if (eventData.sender.hasTag("merc")) nameColor = "§2";
    if (eventData.sender.hasTag("whiteguard")) nameColor = "§9";
    if (eventData.sender.hasTag("royalty")) nameColor = "§5";
    if (eventData.sender.hasTag("emperor")) nameColor = "§v§l";

    world.sendMessage({ rawtext: [{ "text": `${nameColor}<${eventData.sender.name}>§r ${message}` }] });
});

world.afterEvents.effectAdd.subscribe((eventData) => {
    console.info("[MCLINK] [EFFECT ADDED]", JSON.stringify({
        effectName: eventData.effect.typeId,
        entity: eventData.entity.id,
        entityName: eventData.entity?.name || eventData.entity?.nameTag,
        amplifier: eventData.effect.amplifier,
        duration: eventData.effect.duration
    }));
});

world.afterEvents.entityDie.subscribe((eventData) => {
    console.info("[MCLINK] [ENTITY DIED]", JSON.stringify({
        entity: eventData.deadEntity.id,
        entityType: eventData.deadEntity.typeId,
        entityName: eventData.deadEntity.nameTag || eventData.deadEntity.name || null,
        damagingEntity: eventData.damageSource.damagingEntity?.id || null,
        damagingEntityType: eventData.damageSource.damagingEntity?.typeId || null,
        damagingEntityName: eventData.damageSource.damagingEntity?.nameTag || null,
        cause: eventData.damageSource.cause,
        location: eventData.deadEntity.location,
        dimension: eventData.deadEntity.dimension.id
    }));
});

world.afterEvents.gameRuleChange.subscribe((eventData) => {
    console.info("[MCLINK] [GAMERULE CHANGED]", JSON.stringify({
        gameRule: eventData.rule,
        value: eventData.value
    }));
});

world.afterEvents.playerBreakBlock.subscribe((eventData) => {
    console.info("[MCLINK] [PLAYER BREAK BLOCK]", JSON.stringify({
        player: eventData.player.name,
        block: eventData.block.typeId,
        location: eventData.block.location,
        dimension: eventData.block.dimension.id
    }));
});

world.afterEvents.playerPlaceBlock.subscribe((eventData) => {
    console.info("[MCLINK] [PLAYER PLACE BLOCK]", JSON.stringify({
        player: eventData.player.name,
        block: eventData.block.typeId,
        location: eventData.block.location,
        dimension: eventData.block.dimension.id
    }));
});

world.afterEvents.playerDimensionChange.subscribe((eventData) => {
    console.info("[MCLINK] [PLAYER DIMENSION CHANGE]", JSON.stringify({
        player: eventData.player.name,
        from: eventData.fromDimension.id,
        origin: eventData.fromLocation,
        to: eventData.toDimension.id,
        destination: eventData.toLocation
    }));
});

world.afterEvents.playerGameModeChange.subscribe((eventData) => {
    console.info("[MCLINK] [PLAYER GAMEMODE CHANGE]", JSON.stringify({
        player: eventData.player.name,
        from: eventData.fromGameMode,
        to: eventData.toGameMode
    }));
});

world.afterEvents.weatherChange.subscribe((eventData) => {
    console.info("[MCLINK] [WEATHER CHANGE]", JSON.stringify({
        dimension: eventData.dimension.id,
        newWeather: eventData.newWeather,
        previousWeather: eventData.previousWeather
    }));
});

world.afterEvents.worldLoad.subscribe((eventData) => {
    console.info("[MCLINK] [WORLD LOAD]");
});


system.runInterval(() => {
    const players = world.getPlayers().map(p => {
        return {
            name: p.name,
            location: p.location,
            dimension: p.dimension.id,
            gameMode: p.gameMode
        };
    });
    if (players.length === 0) return;
    console.info("[MCLINK] [PLAYER LIST]", JSON.stringify({
        players: players
    }));
}, 3000);

system.afterEvents.scriptEventReceive.subscribe((eventData) => {
    switch (eventData.id) {
        case "mclink:intrun": {
            const command = base64ToUtf8String(eventData.message);
            world.getDimension("overworld").runCommand(command);
            break;
        }
        case "mclink:event": {
            console.info("[MCLINK] [EVENT]", JSON.stringify({
                id: eventData.id,
                initiator: eventData.initiator?.name || eventData.initiator?.nameTag,
                message: eventData.message,
                sourceType: eventData.sourceType
            }));
            break;
        }
        default:
            break;
    }
});

function base64ToUtf8String(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let buffer = 0;
  let bits = 0;
  let bytes = [];

  // Base64 → bytes
  for (let i = 0; i < base64.length; i++) {
    const c = base64.charAt(i);
    if (c === "=") break;

    const v = chars.indexOf(c);
    if (v === -1) continue;

    buffer = (buffer << 6) | v;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  // UTF-8 bytes → JS string
  let result = "";
  for (let i = 0; i < bytes.length; ) {
    const b1 = bytes[i++];

    if (b1 <= 0x7f) {
      result += String.fromCharCode(b1);
    } else if (b1 <= 0xdf) {
      const b2 = bytes[i++];
      result += String.fromCharCode(
        ((b1 & 0x1f) << 6) | (b2 & 0x3f)
      );
    } else if (b1 <= 0xef) {
      const b2 = bytes[i++], b3 = bytes[i++];
      result += String.fromCharCode(
        ((b1 & 0x0f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f)
      );
    } else {
      const b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
      let cp =
        ((b1 & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);

      cp -= 0x10000;
      result += String.fromCharCode(
        0xd800 + (cp >> 10),
        0xdc00 + (cp & 0x3ff)
      );
    }
  }

  return result;
}