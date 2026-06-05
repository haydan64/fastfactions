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


//TODO: Rename all profile grabbers from Minecraft profile to Player profile, as the database only keeps one type of profile.
//TODO: Add the user's PID to the database.
//TODO: rename the column "username" to "mc_username"

//TODO: add the tables entity_types, block_types, item_types, dimension_types. Each with columns type_id (string), id (number)
/**TODO: add the following tables:
 * player_kills {
 *    player_id (id from players)
 *    entity_id (id from entity_types table)
 *    posx (float)
 *    posy (float)
 *    posz (float)
 *    dimension (id from dimension_types)
 *    dead_name (string)
 *    cause (string)
 * }
 * player_blocks {
 *    player_id (id from players)
 *    block_id (id from block_types table)
 *    posx (int)
 *    posy (int)
 *    posz (int)
 *    dimension (id from dimension_types)
 *    action (int (0-mined, 1-placed, 2-interaction))
 * }
 * economy_balances {
 *    player_id (id from players table)
 *    balance (int)
 * }
 * 
 */

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS player_applications (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accepted', 'denied')),
        submitted_at TIMESTAMPTZ,
        reviewed_at TIMESTAMPTZ,
        reviewer_id TEXT,
        denial_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS player_application_responses (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (discord_id, question_id)
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

async function upsertMinecraftProfile(discordId, username, options = {}) {
  if (!discordId || !username) return null;
  const clearXuidOnUsernameChange = Boolean(options.clearXuidOnUsernameChange);
  return pool.query(
    `
    INSERT INTO players (discord_id, username, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      xuid = CASE
        WHEN $3 AND LOWER(players.username) <> LOWER(EXCLUDED.username) THEN NULL
        ELSE players.xuid
      END,
      updated_at = NOW()
    RETURNING *;
  `,
    [discordId, username, clearXuidOnUsernameChange]
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

async function clearMinecraftProfileXuid(discordId) {
  if (!discordId) return null;
  const result = await pool.query(
    `
    UPDATE players
    SET xuid = NULL, updated_at = NOW()
    WHERE discord_id = $1
    RETURNING *;
  `,
    [discordId]
  );
  return result.rows[0] || null;
}


async function getMinecraftProfileByUsername(username) {
  if (!username) return null;
  const result = await pool.query('SELECT * FROM players WHERE LOWER(username) = LOWER($1);', [username]);
  return result.rows[0] || null;
}

async function getAllowlistEntries() {
  const result = await pool.query(
    'SELECT name, xuid, ignores_player_limit FROM allowlist_entries ORDER BY LOWER(name);'
  );
  return result.rows;
}

async function getAllowlistEntryByName(name) {
  if (!name) return null;
  const result = await pool.query('SELECT * FROM allowlist_entries WHERE LOWER(name) = LOWER($1);', [name]);
  return result.rows[0] || null;
}

async function getServerPermissions() {
  const result = await pool.query('SELECT xuid, permission FROM server_permissions ORDER BY xuid;');
  return result.rows;
}

async function ensureApplication(discordId) {
  if (!discordId) return null;
  const result = await pool.query(
    `
    INSERT INTO player_applications (discord_id, updated_at)
    VALUES ($1, NOW())
    ON CONFLICT (discord_id) DO UPDATE SET updated_at = NOW()
    RETURNING *;
  `,
    [discordId]
  );
  return result.rows[0] || null;
}

async function saveApplicationResponse(discordId, questionId, response) {
  if (!discordId || !questionId || typeof response !== 'string') return null;
  await ensureApplication(discordId);
  const result = await pool.query(
    `
    INSERT INTO player_application_responses (discord_id, question_id, response, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (discord_id, question_id)
    DO UPDATE SET response = EXCLUDED.response, updated_at = NOW()
    RETURNING *;
  `,
    [discordId, questionId, response]
  );
  return result.rows[0] || null;
}

async function getApplicationResponses(discordId) {
  if (!discordId) return [];
  const result = await pool.query(
    `SELECT question_id, response, updated_at FROM player_application_responses WHERE discord_id = $1;`,
    [discordId]
  );
  return result.rows;
}

async function getApplicationResponse(discordId, questionId) {
  if (!discordId || !questionId) return null;
  const result = await pool.query(
    `SELECT * FROM player_application_responses WHERE discord_id = $1 AND question_id = $2;`,
    [discordId, questionId]
  );
  return result.rows[0] || null;
}

async function deleteApplicationResponse(discordId, questionId) {
  if (!discordId || !questionId) return null;
  const result = await pool.query(
    `DELETE FROM player_application_responses WHERE discord_id = $1 AND question_id = $2 RETURNING *;`,
    [discordId, questionId]
  );
  return result.rows[0] || null;
}

async function setApplicationStatus(discordId, status, reviewerId, denialReason) {
  if (!discordId || !status) return null;
  const timestamps = {
    submitted_at: status === 'submitted' ? 'NOW()' : null,
    reviewed_at: ['accepted', 'denied'].includes(status) ? 'NOW()' : null
  };

  const submittedAtSql = timestamps.submitted_at ? 'NOW()' : 'NULL';
  const reviewedAtSql = timestamps.reviewed_at ? 'NOW()' : 'NULL';

  const result = await pool.query(
    `
    INSERT INTO player_applications (discord_id, status, submitted_at, reviewed_at, reviewer_id, denial_reason, updated_at)
    VALUES ($1, $2, ${submittedAtSql}, ${reviewedAtSql}, $3, $4, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE player_applications.submitted_at END,
      reviewed_at = CASE WHEN EXCLUDED.status IN ('accepted', 'denied') THEN NOW() ELSE player_applications.reviewed_at END,
      reviewer_id = EXCLUDED.reviewer_id,
      denial_reason = EXCLUDED.denial_reason,
      updated_at = NOW()
    RETURNING *;
  `,
    [discordId, status, reviewerId || null, denialReason || null]
  );
  return result.rows[0] || null;
}

async function getApplication(discordId) {
  if (!discordId) return null;
  const result = await pool.query('SELECT * FROM player_applications WHERE discord_id = $1;', [discordId]);
  return result.rows[0] || null;
}

async function resetApplication(discordId) {
  if (!discordId) return null;
  await pool.query(`DELETE FROM player_application_responses WHERE discord_id = $1;`, [discordId]);
  const result = await pool.query(
    `
    INSERT INTO player_applications (discord_id, status, submitted_at, reviewed_at, reviewer_id, denial_reason, updated_at)
    VALUES ($1, 'draft', NULL, NULL, NULL, NULL, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET
      status = 'draft',
      submitted_at = NULL,
      reviewed_at = NULL,
      reviewer_id = NULL,
      denial_reason = NULL,
      updated_at = NOW()
    RETURNING *;
  `,
    [discordId]
  );
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
  clearMinecraftProfileXuid,
  getMinecraftProfileByUsername,
  getAllowlistEntries,
  getAllowlistEntryByName,
  getServerPermissions,
  ensureApplication,
  saveApplicationResponse,
  getApplicationResponses,
  getApplicationResponse,
  deleteApplicationResponse,
  setApplicationStatus,
  getApplication,
  resetApplication
};
