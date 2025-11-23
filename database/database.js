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
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'minecraft_profiles'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'players'
        ) THEN
          ALTER TABLE minecraft_profiles RENAME TO players;
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_class WHERE relname = 'minecraft_profiles_username_lower_idx'
        ) THEN
          BEGIN
            ALTER INDEX minecraft_profiles_username_lower_idx RENAME TO players_username_lower_idx;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
      END
      $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        xuid TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS players_username_lower_idx
      ON players (LOWER(username));
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

async function upsertMinecraftProfile(discordId, username) {
  if (!discordId || !username) return null;
  return pool.query(
    `
    INSERT INTO players (discord_id, username, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()
    RETURNING *;
  `,
    [discordId, username]
  );
}

async function getMinecraftProfileByDiscordId(discordId) {
  if (!discordId) return null;
  const result = await pool.query('SELECT * FROM players WHERE discord_id = $1;', [discordId]);
  return result.rows[0] || null;
}

async function updateMinecraftProfileXuid(username, xuid) {
  if (!username || !xuid) return null;
  return pool.query(
    `
    UPDATE players
    SET xuid = $2, updated_at = NOW()
    WHERE LOWER(username) = LOWER($1)
    RETURNING *;
  `,
    [username, xuid]
  );
}

async function getMinecraftProfileByUsername(username) {
  if (!username) return null;
  const result = await pool.query('SELECT * FROM players WHERE LOWER(username) = LOWER($1);', [username]);
  return result.rows[0] || null;
}

module.exports = {
  pool,
  runMigrations,
  upsertAllowlistEntry,
  removeAllowlistEntry,
  upsertPermission,
  upsertMinecraftProfile,
  getMinecraftProfileByDiscordId,
  updateMinecraftProfileXuid,
  getMinecraftProfileByUsername
};
