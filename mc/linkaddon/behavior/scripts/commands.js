import {world,system,CustomCommand, CommandPermissionLevel, CustomCommandParamType} from "@minecraft/server";
import { sendEvent } from "./link";

system.beforeEvents.startup.subscribe((init) => {
    const reloadCommand = {
        name: "mclink:reload",
        description: "Reloads all addons on the server.",
        permissionLevel: CommandPermissionLevel.GameDirectors
    };
    init.customCommandRegistry.registerCommand(reloadCommand, (commandSource, commandArgs) => {
        sendEvent("reload")
    });

    console.log("MCLINK Custom Commands Registered.");
});