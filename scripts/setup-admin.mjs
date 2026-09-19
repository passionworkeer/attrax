import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const config = { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
mkdirSync(path.join(root, ".deploy"), { recursive: true, mode: 0o700 });
writeFileSync(path.join(root, ".admin-auth.json"), JSON.stringify(config), { mode: 0o600, flag: "wx" });
writeFileSync(path.join(root, ".deploy/admin-access.txt"), `管理员密码：${password}\n入口：/admin\n`, { mode: 0o600, flag: "wx" });
console.log("管理员凭据已创建。密码位于 .deploy/admin-access.txt，权限 0600；请安全保存。重复执行不会覆盖现有凭据。");
