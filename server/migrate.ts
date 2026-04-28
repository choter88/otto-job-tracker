import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Lightweight migration runner for SQLite.
 *
 * Reads numbered `.sql` files from `server/migrations/`, compares them against
 * a `_migrations` tracking table, and applies any that haven't been run yet.
 *
 * Each migration file must be named `<version>_<name>.sql` where `<version>` is
 * a positive integer (e.g. `001_add_login_columns.sql`).
 */

interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
}

export function runMigrations(db: Database.Database): number {
  // Ensure the tracking table exists.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version  INTEGER PRIMARY KEY,
       name     TEXT    NOT NULL,
       applied_at TEXT  NOT NULL
     );`,
  ).run();

  // Determine which versions have already been applied.
  const applied = new Set(
    (db.prepare(`SELECT version FROM _migrations`).all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  // Discover migration files.
  // In dev mode (tsx), __dirname points at server/ directly.
  // In production (esbuild bundle in dist/), try the sibling migrations dir,
  // then fall back to <project-root>/server/migrations/.
  const candidates = [
    path.join(__dirname, "migrations"),
    path.resolve(__dirname, "..", "server", "migrations"),
  ];
  const migrationsDir = candidates.find((d) => fs.existsSync(d));
  if (!migrationsDir) {
    return 0;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = file.match(/^(\d+)[_-](.+)\.sql$/);
    if (!match) continue;
    migrations.push({
      version: parseInt(match[1], 10),
      name: match[2],
      filePath: path.join(migrationsDir, file),
    });
  }

  // Sort by version ascending.
  migrations.sort((a, b) => a.version - b.version);

  // Filter to unapplied only.
  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) {
    return 0;
  }

  const insertMigration = db.prepare(
    `INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  );

  let count = 0;
  for (const migration of pending) {
    const sql = fs.readFileSync(migration.filePath, "utf-8").trim();
    if (!sql) continue;

    // Run each migration inside its own transaction. We hand the whole file
    // to SQLite via db.exec() instead of splitting on `;` ourselves — that
    // naive split mis-parses semicolons inside string literals AND inside
    // `--` comments, which previously crashed startup with "supplied SQL
    // string contains no statements" when a comment happened to contain a
    // colon-then-semicolon. Native SQLite parsing handles all of those.
    db.transaction(() => {
      db.exec(sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    })();

    count++;
  }

  return count;
}
