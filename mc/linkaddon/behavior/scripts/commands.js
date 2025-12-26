import {world,system,CustomCommand, CommandPermissionLevel, CustomCommandParamType} from "@minecraft/server";

system.beforeEvents.startup.subscribe((init) => {
    const helloCommand = {
        name: "mclink:hellocustomcommand",
        description: "Says hello to the player",
        permissionLevel: CommandPermissionLevel.GameDirectors,
    };
    init.customCommandRegistry.registerCommand(helloCommand, (commandSource, commandArgs) => {
        world.sendMessage(`Hello, ${commandSource.sourceEntity?.name}!`);
    });
});