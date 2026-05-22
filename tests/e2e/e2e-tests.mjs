import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';

async function runE2ETests() {
  console.log('🧪 Starting E2E Tests...\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  async function test(name, fn) {
    try {
      await fn();
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
      console.log(`  ✅ ${name}`);
    } catch (error) {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', error: error.message });
      console.log(`  ❌ ${name}: ${error.message}`);
    }
  }

  console.log('\n📋 Upload Flow Tests:');

  await test('Upload page shows file prompt when empty', async () => {
    await page.goto(`${BASE_URL}/upload`);
    await page.waitForTimeout(500);
    const bodyText = await page.textContent('body');
    // Real upload page shows "请上传至少 1 张图片" when empty
    if (!bodyText.includes('请上传至少')) throw new Error('File prompt not found');
  });

  await test('Submit button is disabled initially', async () => {
    await page.goto(`${BASE_URL}/upload`);
    const button = page.locator('button[type="submit"]');
    const isDisabled = await button.isDisabled();
    // With 0 images, button should be disabled
    if (!isDisabled) throw new Error('Submit should be disabled with 0 images');
  });

  console.log('\n📋 Demo Result Page Tests:');

  await test('Demo result shows session ID', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    await page.waitForSelector('pre');
    const pre = await page.locator('pre').first();
    const content = await pre.textContent();
    const parsed = JSON.parse(content);
    if (!parsed.sessionId) throw new Error('Session ID not found');
    if (parsed.sessionId !== 'demo') throw new Error('Expected demo sessionId');
  });

  await test('Demo result has valid scan time', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    if (!parsed.scanTime) throw new Error('scanTime not found');
    const date = new Date(parsed.scanTime);
    if (isNaN(date.getTime())) throw new Error('Invalid scanTime format');
  });

  await test('Demo result has compliance score', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    if (typeof parsed.complianceScore !== 'number') throw new Error('complianceScore not found');
    if (parsed.complianceScore < 0 || parsed.complianceScore > 100) throw new Error('Score out of range');
  });

  await test('Demo result has score grade', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    const validGrades = ['A', 'B', 'C', 'D'];
    if (!validGrades.includes(parsed.scoreGrade)) throw new Error('Invalid scoreGrade');
  });

  await test('Demo result has risk points', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.riskPoints)) throw new Error('riskPoints not found');
    if (parsed.riskPoints.length === 0) throw new Error('Expected at least 1 risk point');
  });

  await test('Demo result has checklist items', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.checklist)) throw new Error('checklist not found');
    if (parsed.checklist.length === 0) throw new Error('Expected at least 1 checklist item');
  });

  await test('Risk point has required fields', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    const risk = parsed.riskPoints[0];
    const required = ['riskId', 'title', 'description', 'severity', 'flameLevel', 'confidence'];
    for (const field of required) {
      if (!(field in risk)) throw new Error(`Missing field: ${field}`);
    }
  });

  await test('Checklist item has required fields', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    const content = await page.locator('pre').first().textContent();
    const parsed = JSON.parse(content);
    const item = parsed.checklist[0];
    const required = ['itemId', 'category', 'title', 'requiredMaterials', 'isFree'];
    for (const field of required) {
      if (!(field in item)) throw new Error(`Missing field: ${field}`);
    }
  });

  console.log('\n📋 Page Rendering Tests:');

  await test('Homepage renders without console errors', async () => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    const criticalErrors = errors.filter(e => !e.includes('Warning'));
    if (criticalErrors.length > 0) throw new Error(`Console errors: ${criticalErrors.join(', ')}`);
  });

  await test('Upload page renders without console errors', async () => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`${BASE_URL}/upload`);
    await page.waitForLoadState('networkidle');
    const criticalErrors = errors.filter(e => !e.includes('Warning'));
    if (criticalErrors.length > 0) throw new Error(`Console errors: ${criticalErrors.join(', ')}`);
  });

  await test('Demo result page renders without console errors', async () => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`${BASE_URL}/result/demo`);
    await page.waitForLoadState('networkidle');
    const criticalErrors = errors.filter(e => !e.includes('Warning'));
    if (criticalErrors.length > 0) throw new Error(`Console errors: ${criticalErrors.join(', ')}`);
  });

  await browser.close();

  console.log('\n═══════════════════════════════════════');
  console.log(`📊 E2E Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════\n');

  return results;
}

runE2ETests().catch(console.error);