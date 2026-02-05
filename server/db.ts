import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import { bootstrapSqliteSchema } from "./sqlite-bootstrap";

function getSqlitePath(): string {
  if (process.env.OTTO_SQLITE_PATH) return process.env.OTTO_SQLITE_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  return path.join(dataDir, "otto.sqlite");
}

const sqlitePath = getSqlitePath();
fs.mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });

export const sqlite = new Database(sqlitePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
bootstrapSqliteSchema(sqlite);

export const db = drizzle(sqlite, { schema });
