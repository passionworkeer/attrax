/**
 * 可自愈的 HTTP 失败判定（2026-09-20 限流优化 P0）。
 *
 * 429（限流排队/令牌桶）、408/425、5xx（上游重启或过载）都不是"这次请求错了"，
 * 而是"稍后会好"——把界面直接判成失败会让用户以为扫描坏了（实际后台还在跑）。
 * 轮询与结果加载统一按这里的策略退避重试，重试耗尽才向用户报错。
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

/** 退避重试上限（网络错误与可重试状态共用）。5 次约 3+6+12+15+15 ≈ 51 秒。 */
export const MAX_TRANSIENT_RETRIES = 5;

export function transientRetryDelayMs(attempt: number): number {
  return Math.min(3000 * 2 ** (attempt - 1), 15000);
}
