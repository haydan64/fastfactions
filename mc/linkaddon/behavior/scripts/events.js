import {world,system} from "@minecraft/server";

world.beforeEvents.chatSend.subscribe((eventData) => {
    const message = eventData.message;
    console.info("[MCLINK] [Chat Sent]", JSON.stringify({
        message: eventData.message,
        sender: eventData.sender.name,
        targets: eventData.targets?.map(t => t.name)
    }));
    eventData.cancel = true;

    let nameColor = "";
    if(eventData.sender.hasTag("war")) nameColor = "§4";
    else if(eventData.sender.hasTag("leg")) nameColor = "§3";
    else if(eventData.sender.hasTag("kam")) nameColor = "§g";
    else if(eventData.sender.hasTag("merc")) nameColor = "§2";
    if(eventData.sender.hasTag("whiteguard")) nameColor = "§9";
    if(eventData.sender.hasTag("royalty")) nameColor = "§5";
    if(eventData.sender.hasTag("emperor")) nameColor = "§v§l";

    world.sendMessage({message: `${nameColor}<${eventData.sender.name}>§r ${message}`});
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
        damagingEntity: eventData.damageSource.damagingEntity?.id || null,
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
    if(players.length === 0) return;
    console.info("[MCLINK] [PLAYER LIST]", JSON.stringify({
        players: players
    }));
}, 3000);

system.afterEvents.scriptEventReceive.subscribe((eventData) => {
    if(eventData.id !== "mclink:event") return;
    console.info("[MCLINK] [EVENT]", JSON.stringify({
        id: eventData.id,
        initiator: eventData.initiator?.name || eventData.initiator?.nameTag,
        message: eventData.message,
        sourceType: eventData.sourceType
    }));
});