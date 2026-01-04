import * as NET from "@minecraft/server-net";

export const sendEvent = async function(event, content) {
    const req = new NET.HttpRequest('http://localhost:8383/mclink/event');

    req.body = JSON.stringify({
        event: event,
        content: content
    });
    req.method = NET.HttpRequestMethod.Post;
    req.headers = [
        new NET.HttpHeader('Content-Type', 'application/json')
    ];

    await NET.http.request(req);
}

export const unwhitelist = async function(initiator, target) {
    const req = new NET.HttpRequest('http://localhost:8383/mclink/unwhitelist');

    req.body = JSON.stringify({
        initiator,
        target
    });
    req.method = NET.HttpRequestMethod.Post;
    req.headers = [
        new NET.HttpHeader('Content-Type', 'application/json')
    ];

    await NET.http.request(req);
}