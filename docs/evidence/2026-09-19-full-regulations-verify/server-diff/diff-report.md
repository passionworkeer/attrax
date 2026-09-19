# 法规库对账报告 — aliyun-sz ↔ 本地

**日期**：2026-09-19  
**服务器**：aliyun-sz（120.77.36.107，root）  
**本地基线**：`/Users/wangjianjun/me/attrax/data/regulations/`（1049 条，commit fd17bd1 全量扩展）

---

## 1. 概览

| 维度 | 本地 | 服务器（aliyun-sz） |
|---|---|---|
| regulations_index.json count | 1049 | **1052** |
| YAML 文件数（不含 _pending） | 1049 | **1052** |
| YAML 文件总数（含 _pending/） | 1049 | 1055 |
| 索引 region 数 | 25 | 25 |
| raw/ 文件数（24 region 之和） | 1028 | 1028 |
| 零字节文件 | 0 | 0 |
| 不完整文件（.tmp / .partial） | 0 | 0 |

| 对账结果 | 数量 |
|---|---|
| 两侧共有 | 1049 |
| 本地独有 | 0 |
| 服务器独有（主目录） | 3 |
| 服务器独有（_pending/） | 3（与主目录同 id 的 pending 副本） |
| md5 不一致 | 0（抽样 70 条） |

---

## 2. 服务器 region 分布（按 index.json）

| region | 数量 |
|---|---|
| AE | 7 |
| AU | 13 |
| BR | 7 |
| CA | 34 |
| CN | 258 |
| DE | 36 |
| EU | 117 |
| FR | 1 |
| GCC | 2 |
| GLOBAL | 75 |
| ID | 8 |
| IN | 4 |
| IT | 3 |
| JP | 13 |
| KR | 4 |
| MX | 1 |
| MY | 8 |
| NZ | 7 |
| SA | 7 |
| SG | 9 |
| TH | 4 |
| **UK** | **14**（本地 11，+3） |
| UN | 8 |
| US | 400 |
| VN | 12 |
| **total** | **1052** |

仅 UK 区差异 +3，其他 24 region 与本地完全一致。

---

## 3. 服务器独有清单

```
uk/UK-Packaging-EPR.yaml
uk/UK-REACH.yaml
uk/UK-WEEE.yaml
uk/_pending/UK-Packaging-EPR.yaml
uk/_pending/UK-REACH.yaml
uk/_pending/UK-WEEE.yaml
```

**来源判定**：watchdog 自动入库（生产服务器 `scripts/watchdog.orchestrator`，PID 45927，今天 12:17 启动，与本次部署同步）。

证据：
- `/opt/attrax/data/regulation_supplements/auto-2026-09-19/` 目录下 3 个同名 source 已 apply
- `/opt/attrax/data/regulation_supplements/watchdog-2026-09-19/applied.json` `created: ["UK-Packaging-EPR", "UK-REACH", "UK-WEEE"]`
- `_pending/` 是 watchdog 的「写入主目录前」中转站；本次对账时主目录已合入，_pending 副本未清理（orphan，但不影响服务）

API 端验证 `https://twinbuddy.xyz/api/regulations/archive?market=uk` 返回 14 条，其中这 3 条 `articleCount=0`（已创建但条款正文未填充，属预期）：
- `UK-Packaging-EPR` — Extended producer responsibility for packaging
- `UK-REACH` — How to comply with REACH chemical regulations
- `UK-WEEE` — Regulations: waste electrical and electronic equipment

---

## 4. 本地独有清单

**无**。

本地 `data/regulations/uk/` 缺上述 3 条（UK-Packaging-EPR / UK-REACH / UK-WEEE）。但根据 2026-09-19 法规库全量扩展部署记录（commit fd17bd1）：

> 法规库要 additive rsync + 在服务器上重建索引（不能拷本地索引）

本地 commit fd17bd1 完成于 16:xx，服务器 12:17 watchdog apply 这 3 条。**时间线上服务器比本地先行**——本地的这 3 条缺口，是 watchdog 在服务器上独立入库、本地未补抓的预期现象，不是部署遗漏。

如果需要让本地与服务器完全一致，可选动作：
- 从服务器 rsync 这 3 条 YAML + raw/ HTML 到本地（`scp aliyun-sz:/opt/attrax/data/regulations/uk/UK-{Packaging-EPR,REACH,WEEE}.yaml /Users/wangjianjun/me/attrax/data/regulations/uk/`）
- 然后本地重建索引（`python3 scripts/.../ingest.py` 或 `_rebuild_index`）

**建议**：纳入下一次 "本地与服务器同步" 的常规流程，不必为这 3 条单独发版。

---

## 5. 内容一致性

抽样 70 条 YAML（24 region 每 region 2–3 条），md5 全部一致。

详见 `diff-content.txt`。

---

## 6. raw/ 完整性

服务器 raw/ 与本地逐 region 计数完全一致：

| region | local | server |
|---|---|---|
| ae | 5 | 5 |
| au | 12 | 12 |
| br | 6 | 6 |
| ca | 28 | 28 |
| cn | 236 | 236 |
| de | 36 | 36 |
| eu | 112 | 112 |
| fr | 1 | 1 |
| gcc | 2 | 2 |
| global | 82 | 82 |
| id | 7 | 7 |
| in | 3 | 3 |
| it | 3 | 3 |
| jp | 12 | 12 |
| kr | 3 | 3 |
| mx | 1 | 1 |
| my | 7 | 7 |
| nz | 5 | 5 |
| sa | 6 | 6 |
| sg | 10 | 10 |
| th | 4 | 4 |
| uk | 6 | 6 |
| un | 7 | 7 |
| us | 223 | 223 |
| vn | 11 | 11 |

零字节文件：无  
不完整文件（.tmp / .partial）：无

**与 9-19 attrax-docs 部署记录（doc_files 不同步）不同**：本次 fd17bd1 全量扩展部署是把 raw/ 完整 rsync 过去的，与之前的「目录条目不入扫描引用」策略分两条线。

---

## 7. watchdog 状态

```
PID 45927 /opt/attrax/.venv/bin/python -m scripts.watchdog.orchestrator
启动时间 2026-09-19 12:17（与本次部署同步）
CPU 0:10 / 内存 49 MB
```

**最近一次跑批（watchdog-2026-09-19，12:17）**：

| source | 动作 | similarity | 状态 |
|---|---|---|---|
| uk-packaging-epr-who-is-affected | created → applied | 0.0842 | 已写入主目录 |
| uk-reach-compliance-guidance | created → applied | 0.0985 | 已写入主目录 |
| uk-weee-regulations-guidance | created → applied | 0.1094 | 已写入主目录 |
| jp-meti-pse-list | modified | 0.3972 | 需人工 review，未自动 apply |
| nz-product-safety-standards-2005 | cosmetic | 0.9998 | 微小变更，未触发 apply |
| nz-product-safety-standards-household-cots-2016 | cosmetic | 0.9999 | 微小变更，未触发 apply |

failed: []

详见 `server-watchdog.log`。

---

## 8. 生产 API 实测

```bash
$ curl -sS 'https://twinbuddy.xyz/api/regulations/archive?market=us' → HTTP 200, 100 entries
$ curl -sS 'https://twinbuddy.xyz/api/regulations/archive?market=uk' → HTTP 200, 14 entries
$ curl -sS 'https://twinbuddy.xyz/api/health'                  → HTTP 200
```

UK 列表已包含 watchdog 新建的 3 条（`UK-Packaging-EPR` / `UK-REACH` / `UK-WEEE`），`articleCount=0`（条款正文尚未填充，但 metadata 完整）。  
US 返回 100 条是当前 archive 接口的默认 pageSize 上限，需要翻页才能拿到全部 400 条；该接口分页逻辑不在本次对账范围内。

---

## 9. 结论

| 项 | 状态 |
|---|---|
| 服务器法规库数量 | 健康（1052 条，预期内） |
| 服务器独有 | 3 条 UK，**全部来自 watchdog 自动入库**，非异常 |
| 本地独有 | 0，**本地法规库需要时可同步这 3 条**（不是阻塞） |
| 内容一致性 | 抽样 70 条 md5 全一致，**无不一致** |
| raw/ 完整性 | 24 region 全部对齐，**无零字节 / 无不完整文件** |
| watchdog | 正常运行，**最近一次跑批成功入库 3 条 UK** |
| 生产 API | HTTP 200，UK 区可见新入库法规 |
| 服务可用性 | `/api/health` 200 |

**总体判断**：服务器法规库健康，无需补同步；本地的 3 条 UK 缺口是 watchdog 异步入库导致，按下一次同步流程常规处理即可，不需要紧急动作。

---

## 产物清单

- `server-tree.txt` — 服务器 YAML 文件树（find 输出）
- `server-index.json` — 服务器 regulations_index.json
- `server-stats.txt` — 服务器 region 分布 + 计数 + watchdog 摘要
- `server-watchdog.log` — watchdog 自动入库详情
- `server-md5-sample.txt` — 服务器 md5sum 输出（70 条样本）
- `local-tree.txt` — 本地 YAML 文件树
- `diff-local-only.txt` — 本地独有（空）
- `diff-server-only.txt` — 服务器独有（3 + 3 _pending）
- `diff-content.txt` — md5 不一致清单（空）
- `raw-integrity.txt` — raw/ 完整性总结
- `diff-report.md` — 本报告
