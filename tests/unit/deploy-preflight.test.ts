import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function makeDeployRoot(envBody: string) {
  const root = mkdtempSync(join(tmpdir(), 'attrax-deploy-'))
  mkdirSync(join(root, 'data', 'faiss'), { recursive: true })
  mkdirSync(join(root, 'data', 'corpus', 'processed'), { recursive: true })
  mkdirSync(join(root, 'rag_service'), { recursive: true })
  writeFileSync(join(root, 'data', 'faiss', 'legal_chunks.index'), 'index')
  writeFileSync(join(root, 'data', 'faiss', 'legal_chunks_meta.json'), '{"chunks":[]}')
  writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n')
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:22-alpine\n')
  writeFileSync(join(root, 'rag_service', 'Dockerfile'), 'FROM python:3.10-slim\n')
  writeFileSync(join(root, '.env'), envBody)
  return root
}

describe('deployment preflight', () => {
  it('accepts a complete API-only production deployment root', async () => {
    const { validateDeployment } = await import('../../scripts/preflight-deploy.mjs')
    const root = makeDeployRoot(`
MINIMAX_API_KEY=minimax-key
MODELSCOPE_API_KEY=modelscope-key
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`)

    const result = validateDeployment(root)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('requires both LLM and embedding API keys when demo mode is disabled', async () => {
    const { validateDeployment } = await import('../../scripts/preflight-deploy.mjs')
    const root = makeDeployRoot(`
MINIMAX_API_KEY=
MODELSCOPE_API_KEY=
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`)

    const result = validateDeployment(root)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('MINIMAX_API_KEY is required when DEMO_MODE is not true.')
    expect(result.errors).toContain('MODELSCOPE_API_KEY is required when DEMO_MODE is not true.')
  })

  it('rejects untouched placeholder API keys', async () => {
    const { validateDeployment } = await import('../../scripts/preflight-deploy.mjs')
    const root = makeDeployRoot(`
MINIMAX_API_KEY=your_minimax_api_key
MODELSCOPE_API_KEY=your_modelscope_api_key
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`)

    const result = validateDeployment(root)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('MINIMAX_API_KEY still contains the production example placeholder.')
    expect(result.errors).toContain('MODELSCOPE_API_KEY still contains the production example placeholder.')
  })

  it('requires an explicit browser origin for a production standalone backend', async () => {
    const { validateDeployment } = await import('../../scripts/preflight-deploy.mjs')
    const root = makeDeployRoot(`
MINIMAX_API_KEY=minimax-key
MODELSCOPE_API_KEY=modelscope-key
DEMO_MODE=false
`)

    const result = validateDeployment(root)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('RAG_ALLOWED_ORIGINS is required for direct browser access in production.')
  })

  it('accepts the legacy MIMOTALK_API_KEY alias during migration', async () => {
    const { validateDeployment } = await import('../../scripts/preflight-deploy.mjs')
    const root = makeDeployRoot(`
MIMOTALK_API_KEY=legacy-key
MODELSCOPE_API_KEY=modelscope-key
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`)

    expect(validateDeployment(root).ok).toBe(true)
  })

  it('keeps standalone backend runtime state on a writable Docker volume', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')
    const dockerfile = readFileSync(join(process.cwd(), 'rag_service', 'Dockerfile'), 'utf8')

    expect(compose).toContain('ATTRAX_RUNTIME_DIR: /app/data/backend')
    expect(compose).toContain('./data/backend:/app/data/backend')
    expect(dockerfile).toContain('/app/data/backend')
  })
})
