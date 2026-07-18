export const SESSION_TTL_MS = 60 * 60 * 1000;
export const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export const RAG_SERVICE_TIMEOUT_MS = 300_000;
export const PROFIT_REPORT_TIMEOUT_MS = 60_000;

export const MAX_IMAGE_FILES = 8;
export const MAX_DOCUMENT_FILES = 5;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;

// 800ms 太密会跟后端 /api/scan/{id} 撞,2s 起跳更稳;max 8s 给后端充分时间跑 LLM
// 重试 + refine 循环(单次 generate LLM 调用可重试 3 次,总 LLM 时间 ~90s)
export const POLL_INITIAL_INTERVAL_MS = 2_000;
export const POLL_MAX_INTERVAL_MS = 8_000;
// 后端 _SCAN_TIMEOUT_SECS = 280s (4.67 min),前端给 60s 缓冲让后端能写完 failed
export const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

export const API_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const API_SCAN_RATE_LIMIT = 10;
