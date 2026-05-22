import { describe, it, expect } from 'vitest'
import { t, getTranslations } from '@/lib/i18n'

describe('i18n utilities', () => {
  describe('getTranslations', () => {
    it('returns zh translations by default', () => {
      const translations = getTranslations('zh')
      expect(translations.common.submit).toBe('提交')
    })

    it('returns en translations when locale is en', () => {
      const translations = getTranslations('en')
      expect(translations.common.submit).toBe('Submit')
    })

    it('contains home page translations', () => {
      const translations = getTranslations('zh')
      expect(translations.home.title).toBe('火鹰合规')
      expect(translations.home.subtitle).toBe('想出海？先烧毁！')
    })

    it('contains upload form translations', () => {
      const translations = getTranslations('zh')
      expect(translations.upload.title).toBe('上传产品资料')
      expect(translations.upload.submitAndScan).toBe('提交并开始扫描')
    })

    it('contains market translations', () => {
      const translations = getTranslations('zh')
      expect(translations.markets.EU).toBe('欧盟')
      expect(translations.markets.US).toBe('美国')
    })

    it('contains category translations', () => {
      const translations = getTranslations('zh')
      expect(translations.categories.electronics).toBe('电子产品')
    })
  })

  describe('t function', () => {
    it('translates simple key', () => {
      expect(t('common.submit', 'zh')).toBe('提交')
    })

    it('translates nested key', () => {
      expect(t('home.title', 'zh')).toBe('火鹰合规')
    })

    it('returns key when not found', () => {
      expect(t('nonexistent.key', 'zh')).toBe('nonexistent.key')
    })

    it('replaces parameters', () => {
      expect(t('upload.productImagesCount', 'zh', { count: '3' })).toBe('3/8 张')
    })

    it('handles en locale', () => {
      expect(t('common.submit', 'en')).toBe('Submit')
    })
  })
})
