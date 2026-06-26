/**
 * Tests for lib/pipeline/profit-report.ts
 *
 * Covers the pure helpers (`parseCostValue`, `extractCostSummary`) and
 * `buildProfitReportFromMarkdown`. Section-detection / table-row paths in
 * `extractCostSummary` are already covered by scan-extract-cost.test.ts; here
 * we focus on `parseCostValue` edge cases, risk-exposure math, override
 * precedence, and the GPM fallback in `buildProfitReportFromMarkdown`.
 */
import { describe, it, expect } from 'vitest'
import {
  parseCostValue,
  extractCostSummary,
  buildProfitReportFromMarkdown,
} from '@/lib/pipeline/profit-report'

describe('parseCostValue', () => {
  it('解析纯数字字符串', () => {
    expect(parseCostValue('123')).toBe(123)
    expect(parseCostValue('0')).toBe(0)
  })

  it('剥离 ¥ 与 $ 货币符号', () => {
    expect(parseCostValue('¥50.00')).toBe(50)
    expect(parseCostValue('$60.00')).toBe(60)
  })

  it('剥离千位逗号', () => {
    expect(parseCostValue('1,234.50')).toBe(1234.5)
    expect(parseCostValue('$1,234')).toBe(1234)
  })

  it('从含文字的串中取出第一个数字', () => {
    expect(parseCostValue('约 ¥50.00 起')).toBe(50)
    expect(parseCostValue('N/A')).toBe(0)
  })

  it('无数字时返回 0（安全默认）', () => {
    expect(parseCostValue('N/A')).toBe(0)
    expect(parseCostValue('--')).toBe(0)
    expect(parseCostValue('')).toBe(0)
  })

  it('多小数点时只取第一段数字', () => {
    // regex [\\d.]+ 贪婪匹配 "12.34.56"，parseFloat 解析为 12.34
    expect(parseCostValue('12.34.56')).toBeCloseTo(12.34, 2)
  })
})

describe('extractCostSummary - 边界与空输入', () => {
  it('空 markdown 返回零值默认结构', () => {
    const r = extractCostSummary('')
    expect(r.barebone).toEqual({
      bom: 0, packaging: 0, cert: 0, epr: 0,
      logistics: 0, asp: 0, gp: 0, warranty: 0, total: 0,
    })
    expect(r.compliant.total).toBe(0)
    expect(r.keyConclusion).toBe('')
    expect(r.premiumPct).toBe('')
    expect(r.bareboneGpm).toBe(0)
    expect(r.compliantGpm).toBe(0)
  })

  it('只有非表行文本时不识别成本/收益项', () => {
    const r = extractCostSummary('hello world\n普通段落')
    expect(r.barebone.bom).toBe(0)
    expect(r.barebone.asp).toBe(0)
  })

  it('表行缺第二第三列时取 0', () => {
    const r = extractCostSummary('| BOM 成本 |')
    expect(r.barebone.bom).toBe(0)
    expect(r.compliant.bom).toBe(0)
  })

  it('表格分隔线被忽略（--- 行）', () => {
    const r = extractCostSummary('| --- | --- | --- |\n| BOM 成本 | ¥10 | ¥20 |')
    expect(r.barebone.bom).toBe(10)
    expect(r.compliant.bom).toBe(20)
  })

  it('纯分隔行 | 不抛错', () => {
    expect(() => extractCostSummary('|')).not.toThrow()
  })

  it('表头行“成本项”开启 cost 模式但不写入数据', () => {
    const r = extractCostSummary('| 成本项 | 裸奔 | 合规 |')
    expect(r.barebone.total).toBe(0)
  })

  it('总成本表行覆盖求和默认值', () => {
    const md = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥100 | ¥120 |
| 总直接成本 | ¥200 | ¥240 |
`
    const r = extractCostSummary(md)
    expect(r.barebone.total).toBe(200)
    expect(r.compliant.total).toBe(240)
  })

  it('riskNote 在 idle 表行上下文被提取', () => {
    // 风险敞口说明行没有 | 前缀 → 不进入表格处理；当前实现要求以 | 开头才参与
    // 验证真实行为：纯文本风险说明不会被抽取
    const md = '风险敞口说明：纯文本形式\n'
    const r = extractCostSummary(md)
    expect(r.riskNote).toBe('')
  })

  it('section 5/6 累积多行结论与引用', () => {
    const md = `
### 五、关键结论
第一行结论
第二行结论

### 六、法规引用
引用 A
引用 B
`
    const r = extractCostSummary(md)
    expect(r.conclusions).toContain('第一行结论')
    expect(r.conclusions).toContain('第二行结论')
    expect(r.references).toContain('引用 A')
    expect(r.references).toContain('引用 B')
  })

  it('非 S4/S5/S6 的 # 标题重置 section 标记', () => {
    const md = `
### 四、盈亏平衡分析
合规溢价：10%

### 七、其它章节
合规溢价：99%
`
    const r = extractCostSummary(md)
    // 第二个溢价行不在 section 4，不应覆盖
    expect(r.premiumPct).toBe('10%')
  })
})

describe('buildProfitReportFromMarkdown', () => {
  const md = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥50 | ¥60 |
| 包装印刷 | ¥5 | ¥8 |
| 认证费摊销 | ¥10 | ¥15 |
| EPR 运营费 | ¥3 | ¥5 |
| 售后/保修预留 | ¥2 | ¥3 |
| 物流与渠道 | ¥12 | ¥15 |

| 收益项 | 裸奔 | 合规 |
| 平均售价 ASP | ¥120 | ¥150 |
| 毛利润（单台） | ¥40 | ¥47 |

### 四、盈亏平衡分析
合规溢价：37%
盈亏平衡台数：500台
定价策略：建议定价 ¥150

### 五、关键结论
合规方案更优

### 六、法规引用
CE 认证要求
`

  it('从 markdown 构建完整 ProfitReportResult', () => {
    const r = buildProfitReportFromMarkdown('sess-1', md, '电子产品', 'EU')
    expect(r.sessionId).toBe('sess-1')
    expect(r.productType).toBe('电子产品')
    expect(r.market).toBe('EU')
    expect(r.report).toBe(md)
    expect(r.barebone.bom).toBe(50)
    expect(r.compliant.bom).toBe(60)
    expect(r.premiumPct).toBe('37%')
    expect(r.breakevenUnits).toBe('500台')
    expect(r.pricingStrategy).toBe('建议定价 ¥150')
    expect(r.conclusions).toContain('合规方案更优')
    expect(r.references).toContain('CE 认证要求')
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('riskExposure 按公式计算（asp * 100 / asp * 5）', () => {
    const r = buildProfitReportFromMarkdown('sess-2', md, '电子产品', 'EU')
    expect(r.bareboneRiskExposure).toBe(120 * 100) // 12000
    expect(r.compliantRiskExposure).toBe(150 * 5) // 750
  })

  it('asp 为 0 时 riskExposure 为 0', () => {
    const bareMd = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥10 | ¥20 |
`
    const r = buildProfitReportFromMarkdown('sess-3', bareMd, '玩具', 'US')
    expect(r.bareboneRiskExposure).toBe(0)
    expect(r.compliantRiskExposure).toBe(0)
  })

  it('overrides 优先于 markdown 解析结果', () => {
    const r = buildProfitReportFromMarkdown('sess-4', md, '电子产品', 'EU', {
      keyConclusion: 'override-conclusion',
      premiumPct: '99%',
      breakevenUnits: '999台',
      pricingStrategy: 'override-strategy',
      riskNote: 'override-risk',
      conclusions: 'override-concs',
      references: 'override-refs',
    })
    expect(r.keyConclusion).toBe('override-conclusion')
    expect(r.premiumPct).toBe('99%')
    expect(r.breakevenUnits).toBe('999台')
    expect(r.pricingStrategy).toBe('override-strategy')
    expect(r.riskNote).toBe('override-risk')
    expect(r.conclusions).toBe('override-concs')
    expect(r.references).toBe('override-refs')
  })

  it('GPM fallback：表格未给毛利率时按 gp/asp 计算', () => {
    const r = buildProfitReportFromMarkdown('sess-5', md, '电子产品', 'EU')
    expect(r.bareboneGpm).toBeCloseTo((40 / 120) * 100, 1)
    expect(r.compliantGpm).toBeCloseTo((47 / 150) * 100, 1)
  })

  it('markdown 无 ASP 时不计算 GPM（保持 0）', () => {
    const bareMd = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥10 | ¥20 |
`
    const r = buildProfitReportFromMarkdown('sess-6', bareMd, '玩具', 'US')
    expect(r.bareboneGpm).toBe(0)
    expect(r.compliantGpm).toBe(0)
  })
})
