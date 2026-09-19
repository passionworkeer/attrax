# 2026-09-19 法规库全量接入扫描管线

## 目标

2026-09-19 批量导入的 ~900 条法规（regulation-raw + attrax-docs + watchdog）此前只进
/regulations 档案展示，不进扫描引用。本批次让**全库进入扫描检索**：每条法规有 KB 锚点、
有原件解析出的条款正文、有引用验证路径；同时修掉跨批次重复登记。

## 结果

| 维度 | 之前 | 之后 |
|---|---|---|
| 法规条目 | 1048（含跨批次重复） | **724**（三轮去重 -324） |
| KB 锚点 | 61（人工整理） | **711**（61 curated + 650 自动生成） |
| 带条款正文的法规 | 36 | **618**（582 机器解析 + 36 原有） |
| 单次扫描可命中锚点 | ~10-20 | 数百（US electronics 122），受确定性上限截断 |
| 扫描引用新库法规 | 不可能 | 已实测（见下） |

## 三轮去重（scripts/dedup_regulations.py）

1. **文书号分组**（60 组）：同法规不同 id（`EU-1223-2009` vs `EU-1223-2009_COSMETICS_REGULATION`）。
   CN GB 标准号含分部号整段比较（GB 4806.2 与 GB 15092.2 同年同部号是不同标准）；
   region 进 key（EU 海事指令不并入 CN 微波炉标准）；id 含完整日期的条目（Federal Register
   每日刊）不分组。**首轮 dry-run 抓出并修掉两个假分组模式**：部号碰撞、跨区域碰撞。
2. **引用号分组**（82 组）：CFR 同一 part 从 xml/pdf/内部 scheme 四个 URL 变体重复登记成
   `-2/-3/-4` 后缀家族。归一化引用号 <8 字符或无数字无 CJK 的通用标题不分组。
3. **人工合并表**（4 组）：UK watchdog 自动入库 vs attrax-docs 导入的同源重复（EPR/REACH/SVHC/WEEE），
   保留 watchdog 干净 id，合并两侧原件。

变更清单：`dedup-report.json`；服务器同步删除用 `dedup-apply.log` / `dedup-apply2.log` 尾部的 removed 文件列表。

## 条款提取（scripts/extract_regulation_articles.py）

- 格式：xhtml（EUR-Lex CONVEX）> xml（CFR granule / e-Gov / CA Justice）> pdf（pdfplumber）
  > html（BeautifulSoup）——官方结构化格式优先，避免把分析报告 HTML 当法规原文
  （实测修掉 EU-2019-452/EU-2021-821 两登记错配的研究报告正文）
- 分段：条款标题行正则（第X条/Article N/§N.N/Section N/第X章/Annex…）切段；无标题且 <6000
  字符视为门户残渣拒绝；无标题长文本按 4KB 块切
- 上限：单条 12k / 单法规 32k 字符 / 60 条；重跑幂等（--redo 只重做本脚本写入的条目，
  人工整理的 36 条永不动）
- `source_kind: official_verbatim`（文本直接来自已归档官方原件），解析来源写进 notes

## 锚点生成（scripts/generate_kb_anchors.py）

- domain ∈ 10 品类 → 品类锚点；domain ∈ 特征 → 特征锚点；其它横切领域（数据保护/消费者保护…）
  → **市场级锚点**（该市场扫描一律注入，受上限约束）
- 市场映射：region 直通；GCC → [SA, AE]（多市场命中任一即保留）；GLOBAL/UN → ALWAYS_INCLUDE；
  VN/ID/IN/MY/TH/NZ 建锚点但产品未开放这些市场，扫描选不到（需扩 MARKET_IDS + UI，属产品决策）
- 排除：Federal Register 每日刊 / 召回数据集（无稳定文书身份，13 条）
- 锚点带 `curation: auto` + `domain` 标记；key_points 第一条是诚实的适用性描述
- US CFR 81 条 short_name 从 raw XML 的 FDSYS 标题补全主题词
  （scripts/enrich_us_cfr_names.py，排序与档案展示都用）

## 扫描侧代码

- `kb_loader`：ALWAYS_INCLUDE_REGIONS 加入 GLOBAL；新增 `get_anchors_by_market`（市场级锚点）
- `must_check.build_anchor_list`：并入市场级锚点；过滤改为完整 markets 列表命中
  （GCC 多市场不再被 region[0] 误杀）；平铺锚点携带 `curation` / `domain`
- **新增 `rag_service/retrieval/anchor_selection.py`**：curated 全过；生成锚点按池封顶
  （品类 12 / 每市场横切 3 / GLOBAL+UN 3），排序 = 标题命中产品词 > 品类关键词
  （英文标题桥接）> 横切领域优先级（消费者保护 > 产品安全 > … > 金融支付）> id 稳定序；
  生成锚点条款正文进 prompt 预算 40k 字符、单条 2500
- `report_generator._build_mandatory_section`：自动接入条目标注（库自动接入），
  要求适用性判断而非逐条展开（保护 12k 字符输出预算）
- `generator_node`：接入 bound_anchor_set / bound_generated_article_texts，trace 记录
  anchorSelection 统计

## 验证

| 检查 | 结果 |
|---|---|
| pytest rag_service | **745 passed** / 5 skipped（含库不变量：anchored ⊆ regulated、无锚点不得有正文、GLOBAL/UN 常含、市场级锚点对账） |
| pytest watchdog + 脚本回归 | **183 passed**（新增 test_regulation_batch_scripts.py 30 用例：去重分组安全性 / 提取分段与门槛 / 锚点映射） |
| vitest | **1012 passed**；tsc 干净；eslint 0 error |
| 本地真实端到端扫描（electronics + EU/US，DeepSeek 降级通道） | ready 65s；**20 条引用 = 16 matched + 4 fallback_article_only**（≥70% 目标）；**新库法规被真实引用**：EU-2005-29（UCPD）、EU-2011-83（CRD）、US-CFR-TITLE47-PART15（§15.1 原文逐字引用）、US-CFR-TITLE47-PART2、US-CFR-TITLE16-PART1505；anchorSelection = curated 5 + generated 117 可用选 19；article_texts 51 条 |
| 引用质量抽查 | CFR/UCPD 引用为解析正文的逐字节选（quote_matcher matched） |
| 单条法规接口 | US-CFR-TITLE47-PART15 返回 15 条 articles（source_kind: official_verbatim），DocViewer 可渲染 |

`local-scan-result.json` 为完整扫描响应（run_local_scan.py 可重跑）。

## 部署（2026-09-19 晚，BUILD_ID NLkljdmddP4TF1jk_8Did）

1. **tarball**：本地构建 → scp → apply-deploy（nginx reload + health gate 通过，只重启 nextjs）
2. **数据**：additive rsync `data/regulations`（排除索引）+ `data/kb/anchors`；服务器删除
   328 个去重变体 YAML（`server-remove-list.txt`）与 KR 孤儿 raw；服务器侧 `_rebuild_index()`
   → count 724；`pm2 restart rag-service`
3. **代码（rag_service 走 git 不走 tarball）**：git bundle 快进服务器仓库。期间发现服务器上有
   admin 看板 session 的未提交热修（backup-data.sh / orchestrator.py 指标采集）——已核实这些
   修改全部包含在本地 main 的提交链里（ee99a27/9167c99），工作树收敛到 HEAD 无损；
   `.admin-auth.json`、`data/admin/` 等运行时文件未受影响。第一次 merge 因脏工作树中止且
   中途 checkout 复活了变体文件，最终以 update-ref + reset --mixed + checkout 收敛，
   过程见会话记录；收敛后 anchors=711 / YAML=724 / 索引=724
4. **生产验证**：
   - rag-service 启动日志 `Knowledge base ready: 711 KB anchors, 724 regulation library entries`
   - 真实冒烟扫描（electronics EU/US，DeepSeek 降级通道）100s ready：
     `anchorSelection = {curated 9, generatedAvailable 117, generatedSelected 19}`（新代码已生效）
     12 引用 = 9 matched + 3 fallback_article_only（75%）
     **新库法规逐字引用**：16 CFR 1263 纽扣电池（section-1263-1-a + guidance-product-requirements
     两条）、47 CFR Part 15 §15.1、16 CFR Part 1505 §1505.1
   - `/api/regulations/archive` total=724（SWR 缓存刷新后与磁盘一致）；`/regulations` 200
   - pm2 三进程 online
5. **缓存注意**：archive 路由 unstable_cache 300s + SWR——索引重建后最长约 6 分钟内 API
   仍返回旧 total，属预期，不要当成数据没同步

## 边界与残留

- **非扫描市场**：VN 12 / ID 8 / MY 8 / TH 4 / NZ 7 / IN 4 / GCC 2 条已建锚点但选不到，
  待产品开放对应市场（扩 MARKET_IDS + 上传页 UI + i18n）
- **321 条原件解析失败**：门户/导航残渣（无条款标题且 <6000 字符），保持元数据展示行；
  要提升需引入 headless browser 抓真实正文，属独立架构决定
- 生成锚点的 key_points 是程序化适用性描述，需人工逐条精修才会达到 curated 61 条的
  分析深度；报告中对这些条目标注"库自动接入，需人工复核"
- `MIN_CHUNK_MODE_CHARS` 门槛会把真正的短指南页（<6000 字符无条款结构）一并拒掉，
  数量小（AU ACL 系列），可后续按需单独整理
