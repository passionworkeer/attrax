import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { regulationsProjectRoot } from "@/lib/regulations/data-root";

let connection: DatabaseSync | undefined;

export function adminDb(): DatabaseSync {
  if (connection) return connection;
  const directory = path.join(regulationsProjectRoot(), "data/admin");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "analytics.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traffic (
      id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, day TEXT NOT NULL,
      visitor TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS traffic_day ON traffic(day, kind, visitor);
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  `);
  chmodSync(filename, 0o600);
  connection = db;
  return db;
}
