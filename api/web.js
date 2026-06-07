const express = require("express");
const eventBus = require("../eventBus");
const { createWebRouter } = require("../web/routes");

const { MINECRAFT_EVENT } = eventBus.EVENTS

const PORT = 8383;

const app = express();

// Basic request logging (no extra deps)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.ip} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Body parsing (primarily POST)
app.use(express.json({ limit: '2mb' })); // application/json
app.use(express.urlencoded({ extended: false, limit: '2mb' })); // application/x-www-form-urlencoded
app.use(express.text({ type: ['text/*', 'application/xml'], limit: '2mb' })); // text/plain, xml, etc.

let webRouterMounted = false;

function mountWeb(context = {}) {
  if (webRouterMounted) return;
  webRouterMounted = true;
  app.use('/web', createWebRouter(context));
  app.get('/', (req, res) => res.redirect('/web/'));
}

// POST /mclink/unwhitelist
app.post("/mclink/unwhitelist", (req, res) => {
  // req.body will be the parsed JSON object if Content-Type: application/json
  const payload = req.body || {};

  if (!payload.target) {
    console.warn("/mclink/unwhitelist", "payload should contain target.");
    return res.status(400).json({ ok: false, error: "payload should contain target." });

  }
  if (!payload.initiator) {
    console.warn("/mclink/unwhitelist", "payload should contain initiator.");
    return res.status(400).json({ ok: false, error: "payload should contain initiator." });

  }

  eventBus.emit(MINECRAFT_EVENT, {
    event: "unwhitelist",
    content: {
      target: payload.target,
      initiator: payload.initiator
    }
  });
  res.status(202).json({ ok: true });
});

// POST /mclink/event
app.post("/mclink/event", (req, res) => {
  // req.body will be the parsed JSON object if Content-Type: application/json
  const payload = req.body || {};

  if (!payload.event) {
    console.warn("/mclink/event", "payload should contain event id.");
    return res.status(400).json({ ok: false, error: "payload should contain event id." });
  }

  eventBus.emit(MINECRAFT_EVENT, {
    event: payload.event,
    content: payload.content
  });

  return res.status(202).json({ ok: true });
});

// Start server (if you don't already have this later in the file)
app.listen(PORT, () => {
  console.log(`HTTP API listening on :${PORT}`);
});

module.exports = {
  app,
  mountWeb
};
