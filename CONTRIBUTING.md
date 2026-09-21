# 贡献指南 (Contributing to Attrax)

感谢你对 **Attrax (规航 / 火鹰合规)** 的关注与支持！我们欢迎一切形式的贡献，包括但不限于：提交 Bug 报告、提出功能建议、补充全球法规条目、改进文档以及提交 Pull Request。

---

## 一、行为准则

我们致力于为所有人提供一个友好、包容且互相尊重的开源社区环境。请在参与讨论与协作时保持礼貌、尊重不同背景与观点。

---

## 二、开发流程与规范

### 1. 分支管理
- **主分支**：`main` 为稳定主分支，所有正式发布均基于此分支。
- **特性分支**：新功能开发请从 `main` 切出 `feat/<feature-name>` 分支。
- **修复分支**：缺陷修复请从 `main` 切出 `fix/<bug-name>` 分支。
- **文档分支**：文档完善请从 `main` 切出 `docs/<doc-name>` 分支。

### 2. 提交信息规范 (Conventional Commits)
请遵循社区标准的 Conventional Commits 格式：
- `feat:` 新增功能（如 `feat(vision): support multi-angle label detection`）
- `fix:` 修复缺陷（如 `fix(i18n): correct compliance score tooltip text`）
- `docs:` 文档更新（如 `docs(readme): add deployment walkthrough`）
- `test:` 增加或修改测试用例（如 `test(rag): add quote grounding regression test`）
- `perf:` 性能优化（如 `perf(retrieval): optimize article index lazy loading`）
- `refactor:` 代码重构（不改变外部行为）
- `chore:` 构建过程、依赖更新或辅助工具变动

### 3. 代码风格与规范
- **前端 (TypeScript / React)**：
  - 遵循严格类型检查（`strict: true`），避免滥用 `any`。
  - 组件与样式遵循 Tailwind CSS 与 Base UI 设计风格。
  - 提交前运行 `npm run typecheck` 与 `npm run lint`，确保 0 报错。
- **后端 (Python / FastAPI)**：
  - 代码符合 PEP 8 规范，类型注解完备。
  - 保持输入数据不可变性原则（Immutable pipeline observations）。

---

## 三、本地测试要求

所有提交在发起 PR 前，请确保本地通过以下验证：

```bash
# 1. 前端单元测试（Vitest）
npm run test

# 2. 静态类型检查（TypeScript）
npm run typecheck

# 3. 代码风格检查（ESLint）
npm run lint

# 4. 后端逻辑测试（Pytest）
npm run test:rag
```

---

## 四、提交 Pull Request (PR)

1. **Fork** 本仓库到你的个人 GitHub 账号。
2. 将你的 Fork 仓库克隆到本地，并基于 `main` 分支创建工作分支。
3. 完成开发并编写/更新对应的单元测试。
4. 运行全套测试确保 100% 通过。
5. 提交你的改动并推送至你的远程 Fork 仓库。
6. 在 GitHub 上向原仓库的 `main` 分支发起 Pull Request。
7. 在 PR 描述中清晰说明修改的背景、解决方案以及测试验证结果。

---

## 五、安全漏洞反馈

如果你发现了潜在的安全漏洞或敏感信息泄漏，请**切勿在 GitHub 公开 Issue 中直接披露**。请通过 GitHub 仓库的安全警报渠道（Security Advisory）或邮件联系维护者以协助负责任地披露与修复。
