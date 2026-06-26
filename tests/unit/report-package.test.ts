/**
 * Tests for lib/pipeline/report-package.ts · normalizeReportPackage
 *
 * The existing report-package-contract.test.ts covers one full happy-path
 * fixture; here we exercise the normalizer's edge cases directly: snake_case
 * ↔ camelCase fallbacks, missing/invalid input, array/string field coercion,
 * and the multi-key profit report normalization.
 */
import { describe, it, expect } from 'vitest'
import { normalizeReportPackage } from '@/lib/pipeline/report-package'

describe('normalizeReportPackage', () => {
  describe('顶层防护', () => {
    it('非对象输入返回 undefined', () => {
      expect(normalizeReportPackage(null)).toBeUndefined()
      expect(normalizeReportPackage(undefined)).toBeUndefined()
      expect(normalizeReportPackage('string')).toBeUndefined()
      expect(normalizeReportPackage(42)).toBeUndefined()
    })

    it('数组通过 isRecord 判定（typeof [] === "object"），不会被拒绝', () => {
      // ⚠️ 源码行为记录：isRecord 仅检查 typeof === "object" && !== null，
      // 数组也满足这个条件。结果是一个所有字段为 undefined 的结构（不是 undefined 本身）。
      const r = normalizeReportPackage([])
      expect(r).toBeDefined()
      expect(r?.productDossier).toBeUndefined()
      expect(r?.profitReport).toBeUndefined()
    })

    it('空对象返回字段全 undefined 的合法结构', () => {
      const r = normalizeReportPackage({})
      expect(r).toBeDefined()
      expect(r?.productDossier).toBeUndefined()
      expect(r?.profitReport).toBeUndefined()
      expect(r?.roadmap).toBeUndefined()
      expect(r?.decisionView).toBeUndefined()
      expect(r?.complianceReport).toBeUndefined()
      expect(r?.evidenceBundles).toBeUndefined()
      expect(r?.auditMetadata).toBeUndefined()
    })
  })

  describe('profitReport', () => {
    it('profitReport 为字符串时被包装为 { markdown }', () => {
      const r = normalizeReportPackage({ profitReport: '# md' })
      expect(r?.profitReport?.markdown).toBe('# md')
    })

    it('profit_report（snake_case）字符串同样被包装', () => {
      const r = normalizeReportPackage({ profit_report: '# md2' })
      expect(r?.profitReport?.markdown).toBe('# md2')
    })

    it('profitReport 优先于 profit_report', () => {
      const r = normalizeReportPackage({
        profitReport: { markdown: 'camel' },
        profit_report: { markdown: 'snake' },
      })
      expect(r?.profitReport?.markdown).toBe('camel')
    })

    it('profitReport.markdown_en（snake）映射到 markdownEn', () => {
      const r = normalizeReportPackage({
        profitReport: { markdown: 'zh', markdown_en: 'en' },
      })
      expect(r?.profitReport?.markdown).toBe('zh')
      expect(r?.profitReport?.markdownEn).toBe('en')
    })

    it('profitReport 所有字段 camel/snake 双写都能取到', () => {
      const r = normalizeReportPackage({
        profitReport: {
          markdown: 'md',
          key_conclusion: 'kc',
          key_conclusion_en: 'kc-en',
          premium_pct: '12%',
          breakeven_units: '500台',
          breakeven_units_en: '500 units',
          pricing_strategy: 'ps',
          pricing_strategy_en: 'ps-en',
          risk_note: 'rn',
          risk_note_en: 'rn-en',
          conclusions: 'cs',
          conclusions_en: 'cs-en',
          references: 'refs',
          references_en: 'refs-en',
        },
      })
      const p = r?.profitReport
      expect(p?.markdown).toBe('md')
      expect(p?.keyConclusion).toBe('kc')
      expect(p?.keyConclusionEn).toBe('kc-en')
      expect(p?.premiumPct).toBe('12%')
      expect(p?.breakevenUnits).toBe('500台')
      expect(p?.breakevenUnitsEn).toBe('500 units')
      expect(p?.pricingStrategy).toBe('ps')
      expect(p?.pricingStrategyEn).toBe('ps-en')
      expect(p?.riskNote).toBe('rn')
      expect(p?.riskNoteEn).toBe('rn-en')
      expect(p?.conclusions).toBe('cs')
      expect(p?.conclusionsEn).toBe('cs-en')
      expect(p?.references).toBe('refs')
      expect(p?.referencesEn).toBe('refs-en')
    })

    it('profitReport 为非对象非字符串时 profitReport 为 undefined', () => {
      const r = normalizeReportPackage({ profitReport: 42 })
      expect(r?.profitReport).toBeUndefined()
    })

    it('profitReport 内部字段类型不匹配时降级为 undefined', () => {
      const r = normalizeReportPackage({
        profitReport: {
          markdown: 123,
          premiumPct: { x: 1 },
        },
      })
      expect(r?.profitReport?.markdown).toBeUndefined()
      expect(r?.profitReport?.premiumPct).toBeUndefined()
    })

    it('profitReport 为空对象时返回全 undefined 字段的结构', () => {
      const r = normalizeReportPackage({ profitReport: {} })
      expect(r?.profitReport).toBeDefined()
      expect(r?.profitReport?.markdown).toBeUndefined()
      expect(r?.profitReport?.premiumPct).toBeUndefined()
    })
  })

  describe('roadmap', () => {
    it('roadmap 为非对象时 roadmap 为 undefined', () => {
      expect(normalizeReportPackage({ roadmap: 'str' })?.roadmap).toBeUndefined()
    })

    it('totalDays / total_days 双写都能取到', () => {
      const r1 = normalizeReportPackage({ roadmap: { totalDays: 30 } })
      expect(r1?.roadmap?.totalDays).toBe(30)
      const r2 = normalizeReportPackage({ roadmap: { total_days: 60 } })
      expect(r2?.roadmap?.totalDays).toBe(60)
    })

    it('totalCost / total_cost 双写都能取到', () => {
      const r = normalizeReportPackage({ roadmap: { total_cost: '¥1000' } })
      expect(r?.roadmap?.totalCost).toBe('¥1000')
    })

    it('items 中每个 item 字段映射 + snake/camel 兼容', () => {
      const r = normalizeReportPackage({
        roadmap: {
          progress: 50,
          items: [
            {
              id: 7,
              date: '2026-01-01',
              title: '步骤一',
              title_en: 'Step 1',
              description: 'desc',
              description_en: 'desc-en',
              type: 'apply',
              status: 'pending',
              estimated_days: 10,
              cost: '¥100',
              documents: ['doc1', 'doc2'],
              documents_en: ['d1', 'd2'],
            },
          ],
        },
      })
      const item = r?.roadmap?.items?.[0]
      expect(item?.id).toBe('7') // 数字 id 转 string
      expect(item?.title).toBe('步骤一')
      expect(item?.titleEn).toBe('Step 1')
      expect(item?.descriptionEn).toBe('desc-en')
      expect(item?.estimatedDays).toBe(10)
      expect(item?.documents).toEqual(['doc1', 'doc2'])
      expect(item?.documentsEn).toEqual(['d1', 'd2'])
    })

    it('items 含非对象条目时被过滤', () => {
      const r = normalizeReportPackage({
        roadmap: {
          items: ['bad', { id: 'x', title: 't' }, null, 42],
        },
      })
      expect(r?.roadmap?.items).toHaveLength(1)
      expect(r?.roadmap?.items?.[0]?.id).toBe('x')
    })

    it('items 为非数组时 items 为 undefined', () => {
      const r = normalizeReportPackage({ roadmap: { items: 'not-array' } })
      expect(r?.roadmap?.items).toBeUndefined()
      // 但 roadmap 对象本身仍存在
      expect(r?.roadmap).toBeDefined()
    })

    it('documents 非数组时返回 undefined', () => {
      const r = normalizeReportPackage({
        roadmap: { items: [{ id: 'a', documents: 'nope' }] },
      })
      expect(r?.roadmap?.items?.[0]?.documents).toBeUndefined()
    })

    it('documents 数组元素通过 String() 强转', () => {
      const r = normalizeReportPackage({
        roadmap: { items: [{ id: 'a', documents: [1, 2, true] }] },
      })
      expect(r?.roadmap?.items?.[0]?.documents).toEqual(['1', '2', 'true'])
    })
  })

  describe('decisionView', () => {
    it('decisionView / decision_view 双写', () => {
      const r = normalizeReportPackage({
        decision_view: {
          summary: 's',
          summary_en: 's-en',
          key_findings: ['a', 'b'],
          key_findings_en: ['a-en'],
          recommended_action: 'rec',
          recommended_action_en: 'rec-en',
        },
      })
      expect(r?.decisionView?.summary).toBe('s')
      expect(r?.decisionView?.summaryEn).toBe('s-en')
      expect(r?.decisionView?.keyFindings).toEqual(['a', 'b'])
      expect(r?.decisionView?.keyFindingsEn).toEqual(['a-en'])
      expect(r?.decisionView?.recommendedAction).toBe('rec')
      expect(r?.decisionView?.recommendedActionEn).toBe('rec-en')
    })

    it('nodes 中每个节点字段映射 + snake/camel 兼容', () => {
      const r = normalizeReportPackage({
        decisionView: {
          nodes: [
            {
              id: 3,
              type: 'risk',
              label: '风险',
              label_en: 'Risk',
              icon: 'alert',
              status: 'warning',
              duration: '2 days',
              confidence: 0.8,
              reasoning: '因为…',
              reasoning_en: 'because…',
            },
          ],
        },
      })
      const n = r?.decisionView?.nodes?.[0]
      expect(n?.id).toBe('3')
      expect(n?.labelEn).toBe('Risk')
      expect(n?.confidence).toBe(0.8)
      expect(n?.reasoningEn).toBe('because…')
    })

    it('nodes 含非对象条目时被过滤', () => {
      const r = normalizeReportPackage({
        decisionView: {
          nodes: [null, 'x', { id: 'n1', label: 'L' }, 5],
        },
      })
      expect(r?.decisionView?.nodes).toHaveLength(1)
      expect(r?.decisionView?.nodes?.[0]?.id).toBe('n1')
    })

    it('decisionView 非对象时 decisionView 为 undefined', () => {
      const r = normalizeReportPackage({ decisionView: 'nope' })
      expect(r?.decisionView).toBeUndefined()
    })
  })

  describe('扁平字段', () => {
    it('complianceReport / compliance_report 双写', () => {
      expect(
        normalizeReportPackage({ complianceReport: '# zh' })?.complianceReport,
      ).toBe('# zh')
      expect(
        normalizeReportPackage({ compliance_report: '# zh2' })?.complianceReport,
      ).toBe('# zh2')
    })

    it('complianceReportEn / compliance_report_en 双写', () => {
      expect(
        normalizeReportPackage({ complianceReportEn: '# en' })?.complianceReportEn,
      ).toBe('# en')
      expect(
        normalizeReportPackage({ compliance_report_en: '# en2' })?.complianceReportEn,
      ).toBe('# en2')
    })

    it('complianceReport 类型不匹配（非 string）时降级 undefined', () => {
      expect(
        normalizeReportPackage({ complianceReport: { x: 1 } })?.complianceReport,
      ).toBeUndefined()
    })

    it('productDossier / product_dossier 双写', () => {
      const r = normalizeReportPackage({ product_dossier: { product: 'X' } })
      expect(r?.productDossier?.product).toBe('X')
    })

    it('productDossier 优先于 product_dossier', () => {
      const r = normalizeReportPackage({
        productDossier: { a: 1 },
        product_dossier: { b: 2 },
      })
      expect(r?.productDossier).toEqual({ a: 1 })
    })

    it('evidenceBundles / evidence_bundles 双写', () => {
      const r = normalizeReportPackage({ evidence_bundles: { x: 1 } })
      expect(r?.evidenceBundles).toEqual({ x: 1 })
    })

    it('evidenceBundle / evidence_bundle 单数双写', () => {
      const r = normalizeReportPackage({ evidence_bundle: { y: 2 } })
      expect(r?.evidenceBundle).toEqual({ y: 2 })
    })

    it('evidenceBundles（复数）优先于 evidenceBundle（单数）', () => {
      const r = normalizeReportPackage({
        evidenceBundles: { plural: true },
        evidenceBundle: { singular: true },
      })
      expect(r?.evidenceBundles).toEqual({ plural: true })
      // 单数也会被同时填充（独立字段）
      expect(r?.evidenceBundle).toEqual({ singular: true })
    })

    it('auditMetadata / audit_metadata 双写', () => {
      const r = normalizeReportPackage({ audit_metadata: { v: '1' } })
      expect(r?.auditMetadata).toEqual({ v: '1' })
    })

    it('扁平字段为非对象时降级 undefined', () => {
      const r = normalizeReportPackage({
        productDossier: 'str',
        evidenceBundles: 42,
      })
      expect(r?.productDossier).toBeUndefined()
      expect(r?.evidenceBundles).toBeUndefined()
    })

    it('auditMetadata 传入数组：因为 typeof [] === "object" 通过 isRecord', () => {
      // ⚠️ 源码行为记录：与 productDossier 等不同（后者有 isRecord 守卫），
      // auditMetadata 同样有 isRecord 守卫，但数组能绕过 typeof 守卫。
      // 结果：数组被原样保留在 auditMetadata 字段中。
      const arr: unknown[] = []
      const r = normalizeReportPackage({ auditMetadata: arr })
      expect(r?.auditMetadata).toBe(arr)
    })
  })

  describe('综合集成', () => {
    it('所有顶层字段同时出现的完整包', () => {
      const r = normalizeReportPackage({
        productDossier: { product: 'P' },
        evidenceBundles: { b: 1 },
        evidenceBundle: { b: 1 },
        auditMetadata: { v: '1' },
        complianceReport: '# zh',
        complianceReportEn: '# en',
        profitReport: { markdown: 'm' },
        roadmap: { totalDays: 10, items: [{ id: 'a' }] },
        decisionView: { summary: 's' },
      })
      expect(r?.productDossier?.product).toBe('P')
      expect(r?.evidenceBundles?.b).toBe(1)
      expect(r?.complianceReport).toBe('# zh')
      expect(r?.complianceReportEn).toBe('# en')
      expect(r?.profitReport?.markdown).toBe('m')
      expect(r?.roadmap?.totalDays).toBe(10)
      expect(r?.decisionView?.summary).toBe('s')
    })
  })
})
