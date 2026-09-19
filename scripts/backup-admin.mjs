import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, copyFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";

const root = process.argv[2] || "/opt/attrax";
const destination = process.argv[3];
if (!destination) throw new Error("请指定备份目录");
mkdirSync(destination, { recursive: true, mode: 0o700 });
const database = path.join(root, "data/admin/analytics.sqlite");
if (existsSync(database)) {
  const db = new DatabaseSync(database, { readOnly: true });
  try { await backup(db, path.join(destination, "analytics.sqlite")); }
  finally { db.close(); }
  chmodSync(path.join(destination, "analytics.sqlite"), 0o600);
}
const config = path.join(root, ".admin-auth.json");
if (existsSync(config)) {
  copyFileSync(config, path.join(destination, ".admin-auth.json"));
  chmodSync(path.join(destination, ".admin-auth.json"), 0o600);
}
