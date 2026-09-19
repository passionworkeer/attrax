// 读取 _imports/ 下两份 manifest 的 `meta.rawStats`（原始抓取口径）：
//   - marketsCovered：regulation-raw 实际抓到的市场集合大小（含 _REGION_DIRS 外的）。
//   - totalRawFiles：去重后的原始文件数（按 path 去重）。
//
// 由 `scripts/build_regulation_raw_manifest.py` 在 _REGION_DIRS 过滤之前计算并写进
// manifest 顶层 meta。这里只读取，不再二次推算（避免和 build script drift）。
//
// 与 readArchive() 互补：readArchive 统计 attrax 已入库的 1052 条（≤ 25 个 _REGION_DIRS 区域）；
// readRawStats 统计 regulation-raw 真实抓到的全量原始数据。两个口径并存展示。

import fs from "node:fs/promises";
import path from "node:path";
import { regulationsProjectRoot } from "./data-root";

const PROJECT_ROOT = regulationsProjectRoot();
const IMPORTS_DIR = path.join(PROJECT_ROOT, "data", "regulations", "_imports");

interface RawManifest {
  meta?: {
    marketsCovered?: number;
    totalRawFiles?: number;
  };
}

let memo: { value: { marketsCovered: number; totalRawFiles: number }; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export interface RawStats {
  marketsCovered: number;
  totalRawFiles: number;
}

const EMPTY: RawStats = { marketsCovered: 0, totalRawFiles: 0 };

export async function readRawStats(): Promise<RawStats> {
  if (memo && Date.now() - memo.loadedAt < CACHE_TTL_MS) {
    return memo.value;
  }

  let marketsCovered = 0;
  let totalRawFiles = 0;
  const manifests = ["regulation-raw-2026-09-19.json", "attrax-docs-extra-2026-09-19.json"];
  for (const fname of manifests) {
    try {
      const text = await fs.readFile(path.join(IMPORTS_DIR, fname), "utf-8");
      const parsed = JSON.parse(text) as RawManifest;
      const meta = parsed.meta;
      if (typeof meta?.marketsCovered === "number") {
        marketsCovered = Math.max(marketsCovered, meta.marketsCovered);
      }
      if (typeof meta?.totalRawFiles === "number") {
        // attrax-docs-extra 没有 meta.rawStats；regulation-raw 一次给出全集。
        totalRawFiles = Math.max(totalRawFiles, meta.totalRawFiles);
      }
    } catch {
      // 缺失 manifest 不影响另一个（attrax-docs-extra 部署后不一定都有 rawStats meta）
    }
  }

  const value: RawStats = { marketsCovered, totalRawFiles };
  memo = { value, loadedAt: Date.now() };
  return value;
}

export const EMPTY_RAW_STATS: RawStats = EMPTY;