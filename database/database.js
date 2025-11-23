const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connectionOptions = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
};

const pool = new Pool(connectionOptions);

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS allowlist_entries (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        xuid TEXT,
        ignores_player_limit BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS allowlist_entries_name_lower_idx
      ON allowlist_entries (LOWER(name));
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS server_permissions (
        id SERIAL PRIMARY KEY,
        xuid TEXT NOT NULL UNIQUE,
        permission TEXT NOT NULL CHECK (permission IN ('operator', 'member', 'visitor')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS player_profiles (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        minecraft_username TEXT NOT NULL,
        xuid TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function upsertAllowlistEntry({ name, xuid, ignoresPlayerLimit = false }) {
  if (!name) return null;
  return pool.query(
    `
    INSERT INTO allowlist_entries (name, xuid, ignores_player_limit, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (LOWER(name))
    DO UPDATE SET xuid = EXCLUDED.xuid, ignores_player_limit = EXCLUDED.ignores_player_limit, updated_at = NOW()
    RETURNING *;
  `,
    [name, xuid || null, ignoresPlayerLimit]
  );
}

async function removeAllowlistEntry(name) {
  if (!name) return null;
  return pool.query('DELETE FROM allowlist_entries WHERE LOWER(name) = LOWER($1);', [name]);
}

async function upsertPermission({ xuid, permission }) {
  if (!xuid || !permission) return null;
  return pool.query(
    `
    INSERT INTO server_permissions (xuid, permission, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (xuid) DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()
    RETURNING *;
  `,
    [xuid, permission]
  );
}

async function setMinecraftUsername({ discordId, username }) {
  if (!discordId || !username) return null;
  return pool.query(
    `
    INSERT INTO player_profiles (discord_id, minecraft_username, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET minecraft_username = EXCLUDED.minecraft_username, updated_at = NOW()
    RETURNING *;
  `,
    [discordId, username]
  );
}

async function setPlayerXuid({ discordId, xuid }) {
  if (!discordId || !xuid) return null;
  return pool.query(
    `
    UPDATE player_profiles
    SET xuid = $2, updated_at = NOW()
    WHERE discord_id = $1
    RETURNING *;
  `,
    [discordId, xuid]
  );
}

async function getPlayerByDiscordId(discordId) {
  if (!discordId) return null;
  const result = await pool.query('SELECT * FROM player_profiles WHERE discord_id = $1 LIMIT 1;', [discordId]);
  return result.rows[0] || null;
}

module.exports = {
  pool,
  runMigrations,
  upsertAllowlistEntry,
  removeAllowlistEntry,
  upsertPermission,
  setMinecraftUsername,
  setPlayerXuid,
  getPlayerByDiscordId
};
