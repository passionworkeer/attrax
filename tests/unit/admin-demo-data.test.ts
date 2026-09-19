/**
 * lib/admin/demo-data.ts — 演示数据（MVP 推广预览）的口径测试。
 *
 * 演示数据会被拿去给外部看，最怕两件事：刷新后数字跳变（显得造假），
 * 以及数值口径失真（访客/扫描量级与真实运营形态脱节）。把这两点连同
 * 结构一致性钉在这里。
 */
import { describe, expect, it } from "vitest";
import { buildDemoOverview } from "@/lib/admin/demo-data";

const beijingToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe("buildDemoOverview", () => {
  it("固定种子：同一窗口两次生成的序列完全一致", () => {
    const first = buildDemoOverview(30);
    const second = buildDemoOverview(30);
    expect(second.series).toEqual(first.series);
    expect(second.totals).toEqual(first.totals);
    expect(second.recentScans).toEqual(first.recentScans);
  });

  it("用户量：30 天去重访客落在 40–49（推广演示目标口径）", () => {
    const overview = buildDemoOverview(30);
    expect(overview.totals.visitors).toBeGreaterThanOrEqual(40);
    expect(overview.totals.visitors).toBeLessThanOrEqual(49);
  });

  it("窗口递增：7/30/90 天的去重访客与扫描次数单调不减", () => {
    const week = buildDemoOverview(7);
    const month = buildDemoOverview(30);
    const quarter = buildDemoOverview(90);
    expect(week.totals.visitors).toBeLessThanOrEqual(month.totals.visitors);
    expect(month.totals.visitors).toBeLessThanOrEqual(quarter.totals.visitors);
    expect(week.totals.scans).toBeLessThanOrEqual(month.totals.scans);
    expect(month.totals.scans).toBeLessThanOrEqual(quarter.totals.scans);
  });

  it("扫描量级：30 天约 200–400 次、90 天约 500–900 次（几百次量级）", () => {
    const month = buildDemoOverview(30);
    const quarter = buildDemoOverview(90);
    expect(month.totals.scans).toBeGreaterThanOrEqual(200);
    expect(month.totals.scans).toBeLessThanOrEqual(400);
    expect(quarter.totals.scans).toBeGreaterThanOrEqual(500);
    expect(quarter.totals.scans).toBeLessThanOrEqual(900);
  });

  it("结构一致性：市场分布求和等于法规总量，来源数与列表一致，序列汇总等于总量", () => {
    for (const days of [7, 30, 90] as const) {
      const overview = buildDemoOverview(days);
      expect(overview.series).toHaveLength(days);
      expect(overview.series.at(-1)?.date).toBe(beijingToday());
      expect(overview.markets.reduce((sum, row) => sum + row.count, 0)).toBe(overview.totals.regulations);
      expect(overview.totals.sources).toBe(overview.sources.length);
      expect(overview.totals.scans).toBe(overview.series.reduce((sum, day) => sum + (day.scans ?? 0), 0));
      expect(overview.totals.completed + overview.totals.failed).toBeLessThanOrEqual(overview.totals.scans + days);
      // 演示数据与真实面板共用同一渲染：coverage.notes 不带任何
      // 「演示 / mock」字样，避免未来接入真实数据时被旧字串混入 UI。
      expect(overview.coverage.notes.join("")).not.toMatch(/演示|mock|非真实/);
      // 国家与角色：每个维度的去重人数之和 ≤ 窗口去重访客总数
      // （一个身份同时绑定一个国家 + 一个角色，所以两边求和都应等于访客总数）。
      const countryTotal = overview.countries.reduce((sum, row) => sum + row.visitors, 0);
      const roleTotal = overview.roles.reduce((sum, row) => sum + row.visitors, 0);
      expect(countryTotal).toBe(overview.totals.visitors);
      expect(roleTotal).toBe(overview.totals.visitors);
      // 演示口径下 30 天中国应在 25%–35%，美国 ≥ 6 人
      if (days === 30) {
        const cn = overview.countries.find(country => country.code === "CN")?.visitors ?? 0;
        const us = overview.countries.find(country => country.code === "US")?.visitors ?? 0;
        expect(cn).toBeGreaterThanOrEqual(us);
        expect(cn).toBeGreaterThanOrEqual(Math.round(overview.totals.visitors * 0.25));
        expect(us).toBeGreaterThanOrEqual(6);
        // 30 天窗口样本足够，角色首位应是合规经理。
        expect(overview.roles[0]?.name).toBe("compliance_manager");
      }
    }
  });

  it("序列数值非负且演示数据不带空缺（每个窗口内曲线连续）", () => {
    const overview = buildDemoOverview(30);
    for (const day of overview.series) {
      expect(day.visitors).not.toBeNull();
      expect(day.scans).not.toBeNull();
      expect(Number(day.visitors)).toBeGreaterThanOrEqual(0);
      expect(Number(day.scans)).toBeGreaterThanOrEqual(0);
    }
  });

  it("只接受 7/30/90 天", () => {
    expect(() => buildDemoOverview(14 as 7)).toThrow("演示数据");
  });
});
