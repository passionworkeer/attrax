# 法规库惰性加载改造（2026-09-19）

## 背景与动因

`article_loader` 原先的实现是"全量预热"：进程内第一次查询时 `glob` 724 个法规
YAML 并全部 `yaml.safe_load` 进内存。提出改造时假设的收益是"省内存"——改造前的
估算说全量加载占 100–150MB RSS。

## 实测修正了一个错误假设

基准（`bench_load_impl.py`，两实现分别独立进程运行于同一份 724 条法规库）：

| 指标 | Eager（旧） | Lazy（新） | 差值 |
|---|---|---|---|
| 冷启动（首个 `list_regulation_ids()`） | 7222ms | 11.5ms | **-7211ms** |
| 冷启动后 RSS 增量 | +22.1MB | +0.5MB | -21.6MB |
| 首次全库遍历（724×`load_regulation`） | 3134ms | 11109ms | +7975ms |
| 全库遍历后 RSS 增量（稳态） | +22.1MB | +22.4MB | +0.3MB |
| 稳态全库遍历（第二次） | 3325ms | 3329ms | ~0 |
| **库变更后首次读**（模拟 03:00 watchdog 入库） | **7421ms** | **21ms** | **-7400ms** |

**内存假设是错的**：全量解析 724 个 YAML 的稳态 RSS 只有 ~22MB（不是 100–150MB
——早期估算把文件尺寸当成了对象开销）。惰性化省不下有意义的常驻内存，稳态两者
相同。

**真实收益在哪**：

1. **冷启动 7.2s → 11ms**：RAG 进程每次重启（部署 / max_memory_restart / 手动）
   后第一个请求不再被 7 秒预热阻塞。
2. **库变更后 7.4s → 21ms**：watchdog 每日 03:00 入库后，`invalidate_cache` /
   stamp 变化触发的"下一个请求重建全库"从 7 秒压到一次 stamp 走查。这是改造前
   反复观察到的凌晨抖动源。
3. **首次全库遍历 +8s（一次性）**：代价是 `/health/watchdog`（运维事件端点，
   低频）在重启后第一次调用多花 8 秒做首次解析。属于成本转移，不是净损失——
   分摊给了真正需要全库数据的调用者，而不是拦在每个进程启动路径上。

**注意**：稳态全库遍历 ~3.3s 两实现相同——这是既有的"每次调用重算 stamp"
（724 次 stat ≈ 6–9ms/调用）开销，不是本次改造引入的，也不在本次范围内。

## 最终实现（选择了什么）

`article_loader` 改为**惰性加载 + 有上限缓存**（不是工作集 LRU）：

- `list_regulation_ids()`：只做 glob+stat 建"id→路径"索引（724 文件 ~30ms），
  不解析任何 YAML。
- `load_regulation` / `load_article_text`：按需解析单个文件，进
  `OrderedDict` 缓存；**上限 2048**——安全阀而非工作集限制（全库 724 条 ≈22MB，
  设小会令 `/health/watchdog` 类全库遍历反复重解析）。
- `_library_stamp()` 自失效保留：文件集合/内容变化 → 清空缓存（不重建）+
  `cache_generation()` tick，verifier 的 `_ARTICLE_TEXT_CACHE` 联动不受影响。
- 整段 check-parse-insert 在 `_cache_lock` 内：100 线程并发冷 miss 同一文件只
  解析一次（惊群防护，有测试）。

初版曾设计为 LRU(128)，被 `/health/watchdog` 全库遍历场景否决（每次调用会
重解析 ~600 文件）；实测全库体量后改为大上限缓存。此决策过程记录在提交信息。

## 验证

- `rag_service/tests/` 全量：**754 passed, 5 skipped**，含新增
  `test_article_loader_lazy_lru.py` 9 例（冷启动不预读 / LRU 淘汰 / 100 线程
  惊群 / stamp 变化清缓存并 tick / `_load_all` 快照语义 / readiness 轮询零解析）。
- 原有 `test_article_loader_cache_redteam.py` 6 例（mtime/size 变更检测、新文件、
  删除、generation 计数）全部通过——staleness 契约未变。
- 基准脚本：`bench_load_impl.py`（本目录，`python3 bench_load_impl.py eager|lazy`，
  从 git HEAD 取旧实现对比，可复现）。

## 复现

```bash
python3 docs/evidence/2026-09-19-lazy-regulation-loader/bench_load_impl.py eager
python3 docs/evidence/2026-09-19-lazy-regulation-loader/bench_load_impl.py lazy
```
