const express = require("express");
const eventBus = require("../eventBus");

const {MINECRAFT_EVENT} = eventBus.EVENTS

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


// Body parsing (primarily POST)
app.use(express.json({ limit: '2mb' })); // application/json
app.use(express.urlencoded({ extended: false, limit: '2mb' })); // application/x-www-form-urlencoded
app.use(express.text({ type: ['text/*', 'application/xml'], limit: '2mb' })); // text/plain, xml, etc.


// POST /mclink/unwhitelist
app.post("/mclink/unwhitelist", (req, res) => {
  // req.body will be the parsed JSON object if Content-Type: application/json
  const payload = req.body;

  if (!payload.target) {
    console.warn("/mclink/unwhitelist", "payload should contain target.");
    return;
  }
  if (!payload.initiator) {
    console.warn("/mclink/unwhitelist", "payload should contain initiator.");
    return;
  }

  const errorTimeout = setTimeout(() => {
    res.status(500).json({ ok: false, error: "Evenbus took too long to respond." });
    console.warn("ERROR: Eventbus took too long to respond.")
  }, 5000)

  eventBus.emit(MINECRAFT_EVENT, {
    event: "unwhitelist",
    target: payload.target,
    initiator: payload.initiator
  }, (err, result) => {
    errorTimeout.close();
    if(err) {
      res.status(500).json({ ok: false, error: err});
      return;
    }
    res.status(200).json({ ok: true, result});
  });
});

// POST /mclink/event
app.post("/mclink/event", (req, res) => {
  // req.body will be the parsed JSON object if Content-Type: application/json
  const payload = req.body;

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