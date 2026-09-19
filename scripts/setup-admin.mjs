import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

// 用法：
//   node setup-admin.mjs <项目根>                    # 首次初始化：生成随机密码，已存在则不动
//   node setup-admin.mjs <项目根> --password <密码>   # 轮换为指定密码：覆盖哈希、更新口令文件、
//                                                     # 清空 admin_sessions（旧会话立即失效）
const args = process.argv.slice(2);
const root = path.resolve(args[0] || process.cwd());
const passwordIndex = args.indexOf("--password");
const explicitPassword = passwordIndex !== -1 ? args[passwordIndex + 1] : undefined;
if (explicitPassword !== undefined && (typeof explicitPassword !== "string" || explicitPassword.length < 8 || explicitPassword.length > 256)) {
  console.error("--password 需要 8–256 个字符。");
  process.exit(2);
}
const password = explicitPassword ?? randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const config = { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
mkdirSync(path.join(root, ".deploy"), { recursive: true, mode: 0o700 });
const authPath = path.join(root, ".admin-auth.json");
const accessPath = path.join(root, ".deploy/admin-access.txt");

async function clearSessions() {
  // 轮换密码后旧会话令牌必须立即失效，否则 8 小时内旧 Cookie 仍可登录。
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = path.join(root, "data/admin/analytics.sqlite");
    const db = new DatabaseSync(database);
    try { db.exec("DELETE FROM admin_sessions"); } finally { db.close(); }
    return true;
  } catch {
    return false; // 统计库尚不存在（从未登录过）——无需清理
  }
}

if (explicitPassword === undefined) {
  writeFileSync(authPath, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  writeFileSync(accessPath, `管理员密码：${password}\n入口：/admin\n`, { mode: 0o600, flag: "wx" });
  console.log("管理员凭据已创建。密码位于 .deploy/admin-access.txt，权限 0600；请安全保存。重复执行不会覆盖现有凭据。");
} else {
  // 原子替换：先写同目录临时文件再 rename，读到半个配置文件会让登录整体不可用。
  const staging = `${authPath}.staging`;
  writeFileSync(staging, JSON.stringify(config), { mode: 0o600 });
  renameSync(staging, authPath);
  writeFileSync(accessPath, `管理员密码：${password}\n入口：/admin\n`, { mode: 0o600 });
  const cleared = await clearSessions();
  console.log(`管理员密码已轮换${cleared ? "，旧登录会话已全部撤销" : "（统计库尚不存在，无会话可清）"}。口令文件：.deploy/admin-access.txt`);
}
