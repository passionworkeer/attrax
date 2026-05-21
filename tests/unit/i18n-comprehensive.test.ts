/**
 * Comprehensive i18n tests - covers getTranslations and t function
 */
import { describe, it, expect } from 'vitest'
import { getTranslations, t } from '@/lib/i18n'

describe('i18n getTranslations', () => {
  it('returns zh translations by default', () => {
    const translations = getTranslations()
    expect(translations).toBeDefined()
    expect(translations.common).toBeDefined()
    expect(translations.common.submit).toBe('提交')
  })

  it('returns en translations when locale is en', () => {
    const translations = getTranslations('en')
    expect(translations).toBeDefined()
    expect(translations.common).toBeDefined()
    expect(translations.common.submit).toBe('Submit')
  })

  it('contains all common translations', () => {
    const translations = getTranslations()
    expect(translations.common.loading).toBe('加载中...')
    expect(translations.common.error).toBe('错误')
    expect(translations.common.retry).toBe('重试')
    expect(translations.common.submit).toBe('提交')
    expect(translations.common.cancel).toBe('取消')
    expect(translations.common.save).toBe('保存')
    expect(translations.common.delete).toBe('删除')
    expect(translations.common.edit).toBe('编辑')
    expect(translations.common.search).toBe('搜索')
    expect(translations.common.filter).toBe('筛选')
  })

  it('contains home page translations', () => {
    const translations = getTranslations()
    expect(translations.home.title).toBe('火鹰合规')
    expect(translations.home.subtitle).toBe('想出海？先烧毁！')
    expect(translations.home.description).toBe('AI驱动的跨境电商合规风险智能扫描平台')
  })

  it('contains upload page translations', () => {
    const translations = getTranslations()
    expect(translations.upload.title).toBe('上传产品资料')
    expect(translations.upload.submitAndScan).toBe('提交并开始扫描')
  })

  it('contains market translations', () => {
    const translations = getTranslations()
    expect(translations.markets.EU).toBe('欧盟')
    expect(translations.markets.US).toBe('美国')
    expect(translations.markets.UK).toBe('英国')
    expect(translations.markets.CN).toBe('中国')
    expect(translations.markets.AU).toBe('澳大利亚')
    expect(translations.markets.SA).toBe('沙特')
    expect(translations.markets.UAE).toBe('阿联酋')
  })

  it('contains category translations', () => {
    const translations = getTranslations()
    expect(translations.categories.electronics).toBe('电子产品')
    expect(translations.categories.toys).toBe('玩具')
    expect(translations.categories.home).toBe('家居')
  })
})

describe('i18n t function', () => {
  it('translates a simple key', () => {
    const result = t('common.submit')
    expect(result).toBe('提交')
  })

  it('translates nested key', () => {
    const result = t('home.title')
    expect(result).toBe('火鹰合规')
  })

  it('supports locale parameter', () => {
    const zh = t('common.submit', 'zh')
    const en = t('common.submit', 'en')
    expect(zh).toBe('提交')
    expect(en).toBe('Submit')
  })

  it('returns key when not found', () => {
    const result = t('nonexistent.key')
    expect(result).toBe('nonexistent.key')
  })
})

describe('i18n translations completeness', () => {
  it('home object has all required fields', () => {
    const translations = getTranslations()
    const home = translations.home

    expect(home).toHaveProperty('title')
    expect(home).toHaveProperty('subtitle')
    expect(home).toHaveProperty('description')
    expect(home).toHaveProperty('startScanning')
  })

  it('upload object has all required fields', () => {
    const translations = getTranslations()
    const upload = translations.upload

    expect(upload).toHaveProperty('title')
    expect(upload).toHaveProperty('productImages')
    expect(upload).toHaveProperty('productDocs')
    expect(upload).toHaveProperty('submitAndScan')
  })

  it('scanStages object has translations', () => {
    const translations = getTranslations()
    const scanStages = translations.scanStages

    expect(scanStages).toBeDefined()
    expect(scanStages).toHaveProperty('preparing')
    expect(scanStages).toHaveProperty('generatingReport')
    expect(scanStages).toHaveProperty('scanPassed')
  })

  it('result object has translations', () => {
    const translations = getTranslations()
    const result = translations.result

    expect(result).toBeDefined()
    expect(result.scanResult).toBe('扫描结果')
    expect(result.complianceReport).toBeDefined()
  })

  it('all markets are translated', () => {
    const translations = getTranslations()
    const markets = translations.markets

    const marketKeys = ['EU', 'US', 'UK', 'CN', 'AU', 'SA', 'UAE']
    marketKeys.forEach(key => {
      expect(markets).toHaveProperty(key)
      expect(typeof markets[key as keyof typeof markets]).toBe('string')
    })
  })

  it('all categories are translated', () => {
    const translations = getTranslations()
    const categories = translations.categories

    expect(categories).toHaveProperty('electronics')
    expect(categories).toHaveProperty('toys')
    expect(categories).toHaveProperty('home')
  })
})

describe('i18n locale switching', () => {
  it('zh locale has correct values', () => {
    const zh = getTranslations('zh')
    expect(zh.common.submit).toBe('提交')
    expect(zh.markets.EU).toBe('欧盟')
  })

  it('en locale has correct values', () => {
    const en = getTranslations('en')
    expect(en.common.submit).toBe('Submit')
  })

  it('t function uses zh by default', () => {
    expect(t('common.submit')).toBe('提交')
  })

  it('t function respects locale parameter', () => {
    expect(t('common.submit', 'zh')).toBe('提交')
    expect(t('common.submit', 'en')).toBe('Submit')
  })
})
