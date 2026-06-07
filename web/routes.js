const express = require('express');
const eventBus = require('../eventBus');
const { getStatus, queryLogs, updateBotStatus } = require('./logStore');

function requireAdminToken(req, res, next) {
  const token = process.env.WEB_ADMIN_TOKEN;
  if (!token) return next();

  const provided = req.get('x-admin-token') || req.query.token || req.body?.token;
  if (provided !== token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  return next();
}

function createWebRouter({ client } = {}) {
  const router = express.Router();

  router.use(express.static(__dirname + '/public'));

  router.get('/api/status', (req, res) => {
    updateBotStatus(client);
    res.json({ ok: true, status: getStatus() });
  });

  router.get('/api/logs', (req, res) => {
    const logs = queryLogs(req.query);
    res.json({ ok: true, logs });
  });

  router.post('/api/server-command', requireAdminToken, async (req, res) => {
    const command = String(req.body?.command || '').trim();
    if (!command) {
      return res.status(400).json({ ok: false, error: 'Command is required.' });
    }

    try {
      const result = await eventBus.request(
        eventBus.EVENTS.SERVER_COMMAND,
        { action: 'command', command },
        { timeoutMs: 10000 }
      );
      return res.json({ ok: Boolean(result?.ok), result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/api/server-action', requireAdminToken, async (req, res) => {
    const action = String(req.body?.action || '').trim();
    const allowedActions = new Set(['start', 'stop', 'restart', 'reload', 'backup']);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ ok: false, error: 'Unsupported action.' });
    }

    try {
      const result = await eventBus.request(
        eventBus.EVENTS.SERVER_COMMAND,
        { action },
        { timeoutMs: 120000 }
      );
      return res.json({ ok: Boolean(result?.ok), result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createWebRouter };
