/**
 * DEMO_MODE 本地扫描会话状态机单元测试。
 *
 * 覆盖 lib/pipeline/demo-scan-session.ts 的全部导出:
 *  - isDemoScanSession(前缀判断)
 *  - createDemoScanSession(建会话、setTimeout 注册 ready 转换、TTL)
 *  - getDemoScanSession(读、过期清理)
 *
 * 用 fake timers 控制 READY_DELAY_MS(1.8s)的 ready 转换与 TTL(1h)的过期清理,
 * 避免真实等待。每个用例 resetModules 拿到干净的模块级 store。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadModule() {
  return (await import("@/lib/pipeline/demo-scan-session")) as typeof import("@/lib/pipeline/demo-scan-session");
}

describe("demo-scan-session", () => {
  describe("isDemoScanSession", () => {
    it("识别 scan_demo_ 前缀的 sessionId", async () => {
      const m = await loadModule();
      expect(m.isDemoScanSession("scan_demo_abc123")).toBe(true);
    });

    it("拒绝非 demo 前缀的 sessionId", async () => {
      const m = await loadModule();
      expect(m.isDemoScanSession("sess_abc123")).toBe(false);
      expect(m.isDemoScanSession("demo")).toBe(false);
      expect(m.isDemoScanSession("")).toBe(false);
    });
  });

  describe("createDemoScanSession", () => {
    it("返回 processing 会话 + scan_demo_ 前缀 sessionId + pollUrl", async () => {
      const m = await loadModule();
      const created = m.createDemoScanSession({ imageCount: 2 });
      expect(created.status).toBe("processing");
      expect(created.sessionId.startsWith("scan_demo_")).toBe(true);
      expect(created.accessToken.length).toBeGreaterThan(0);
      expect(created.pollUrl).toBe(`/api/scan/${created.sessionId}`);
    });

    it("两次创建产生不同 sessionId 与 accessToken", async () => {
      const m = await loadModule();
      const a = m.createDemoScanSession();
      const b = m.createDemoScanSession();
      expect(a.sessionId).not.toBe(b.sessionId);
      expect(a.accessToken).not.toBe(b.accessToken);
    });

    it("初始状态可在 getDemoScanSession 读到(processing, progress=45)", async () => {
      const m = await loadModule();
      const created = m.createDemoScanSession({ imageCount: 3 });
      const status = m.getDemoScanSession(created.sessionId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe("processing");
      expect(status!.progress).toBe(45);
      expect(status!.imageCount).toBe(3);
      expect(status!.stageKey).toBe("retrieval");
    });

    it("READY_DELAY_MS(1.8s)后翻成 ready,填入 source=demo 的 result + profitReport", async () => {
      const m = await loadModule();
      const created = m.createDemoScanSession({ imageCount: 1 });

      // 还没到 1.8s,仍 processing
      vi.advanceTimersByTime(1799);
      expect(m.getDemoScanSession(created.sessionId)!.status).toBe("processing");

      // 跨过 1.8s → ready
      vi.advanceTimersByTime(2);
      const ready = m.getDemoScanSession(created.sessionId);
      expect(ready!.status).toBe("ready");
      expect(ready!.progress).toBe(100);
      expect(ready!.stageKey).toBe("done");
      expect(ready!.result).toBeDefined();
      expect((ready!.result as { source?: string }).source).toBe("demo");
      expect(ready!.profitReport).toBeDefined();
      expect(ready!.profitReports).toBeDefined();
    });
  });

  describe("getDemoScanSession 过期清理", () => {
    it("未知 sessionId 返回 null", async () => {
      const m = await loadModule();
      expect(m.getDemoScanSession("scan_demo_unknown")).toBeNull();
    });

    it("超过 TTL(1h)后返回 null 并清理", async () => {
      const m = await loadModule();
      const created = m.createDemoScanSession();
      expect(m.getDemoScanSession(created.sessionId)).not.toBeNull();

      // TTL = 60*60*1000,越过即过期
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      expect(m.getDemoScanSession(created.sessionId)).toBeNull();
    });

    it("过期会话的 ready 定时器回调命中 expiry 守卫,不再翻 ready", async () => {
      const m = await loadModule();
      const created = m.createDemoScanSession();
      // 越过 TTL,让会话过期
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      // 此时 getDemoScanSession 已清理;后续 ready 回调(若被触发)命中 expiresAt 守卫
      expect(m.getDemoScanSession(created.sessionId)).toBeNull();
      // 再推进过 READY_DELAY_MS,不应 resurrect(已 delete)
      vi.advanceTimersByTime(2000);
      expect(m.getDemoScanSession(created.sessionId)).toBeNull();
    });
  });

  describe("purgeExpired(创建时清理已过期会话)", () => {
    it("新建会话时顺带清理 store 里已过期的旧会话", async () => {
      const m = await loadModule();
      const first = m.createDemoScanSession();
      // 越过 TTL,first 过期但未触发清理(没被读/没被新建)
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      // 新建第二个,purgeExpired(now) 应清掉 first
      const second = m.createDemoScanSession();
      expect(m.getDemoScanSession(first.sessionId)).toBeNull();
      expect(m.getDemoScanSession(second.sessionId)).not.toBeNull();
    });
  });
});
