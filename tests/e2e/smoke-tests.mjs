import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';

async function runSmokeTests() {
  console.log('🔍 Starting Smoke Tests...\n');
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

  // Smoke Tests
  console.log('\n📋 Page Availability Tests:');

  await test('Homepage loads', async () => {
    await page.goto(BASE_URL);
    await page.waitForSelector('h1');
    const title = await page.textContent('h1');
    if (!title.includes('想出海')) throw new Error('Homepage title not found');
  });

  await test('Upload page loads', async () => {
    await page.goto(`${BASE_URL}/upload`);
    await page.waitForSelector('h1');
    const title = await page.textContent('h1');
    if (!title.includes('上传产品资料')) throw new Error('Upload page title not found');
  });

  await test('Demo result page loads', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    await page.waitForSelector('h1');
    const title = await page.textContent('h1');
    if (!title.includes('Demo')) throw new Error('Demo result page title not found');
  });

  await test('404 page exists', async () => {
    const response = await page.goto(`${BASE_URL}/non-existent-page`);
    if (response.status() !== 404) throw new Error('Expected 404 status');
  });

  console.log('\n📋 Navigation Tests:');

  await test('Homepage has "开始扫描" button', async () => {
    await page.goto(BASE_URL);
    const button = await page.locator('a:has-text("开始扫描")');
    if (!await button.isVisible()) throw new Error('Start scan button not found');
  });

  await test('Homepage has "查看 Demo" button', async () => {
    await page.goto(BASE_URL);
    const button = await page.locator('a:has-text("查看 Demo")');
    if (!await button.isVisible()) throw new Error('Demo button not found');
  });

  await test('Can navigate to upload page', async () => {
    await page.goto(BASE_URL);
    await page.click('a:has-text("开始扫描")');
    await page.waitForURL(/\/upload/);
    const h1 = await page.textContent('h1');
    if (!h1.includes('上传产品资料')) throw new Error('Navigation failed');
  });

  await test('Can navigate to demo result', async () => {
    await page.goto(BASE_URL);
    await page.click('a:has-text("查看 Demo")');
    await page.waitForURL(/\/result\/demo/);
    const h1 = await page.textContent('h1');
    if (!h1.includes('Demo')) throw new Error('Navigation failed');
  });

  console.log('\n📋 UI Element Tests:');

  await test('Upload page has file input', async () => {
    await page.goto(`${BASE_URL}/upload`);
    const input = await page.locator('input[type="file"]').first();
    if (!await input.isVisible()) throw new Error('File input not found');
  });

  await test('Upload page shows file count', async () => {
    await page.goto(`${BASE_URL}/upload`);
    const counter = await page.locator('text=请上传至少 1 张图片');
    if (!await counter.isVisible()) throw new Error('File counter not found');
  });

  await test('Upload page has submit button', async () => {
    await page.goto(`${BASE_URL}/upload`);
    const button = await page.locator('button[type="submit"]');
    if (!await button.isVisible()) throw new Error('Submit button not found');
  });

  await test('Demo result page shows JSON data', async () => {
    await page.goto(`${BASE_URL}/result/demo`);
    await page.waitForSelector('pre');
    const pre = await page.locator('pre').first();
    if (!await pre.isVisible()) throw new Error('Result JSON not found');
    const content = await pre.textContent();
    if (!content.includes('sessionId')) throw new Error('Expected scan result content');
  });

  console.log('\n📋 API Tests:');

  await test('API returns 400 for missing images', async () => {
    const response = await page.request.post(`${BASE_URL}/api/scan`);
    if (response.status() !== 400) throw new Error('Expected 400 status');
    const json = await response.json();
    if (!json.error) throw new Error('Expected error response');
  });

  await test('API returns 400 for invalid images count', async () => {
    // POST with empty form (0 images)
    const response = await page.request.post(`${BASE_URL}/api/scan`, {
      multipart: {
        category: 'electronics',
        markets: 'EU,US',
      },
    });
    if (response.status() !== 400) throw new Error('Expected 400 for 0 images');
  });

  await test('API accepts valid form data and returns session', async () => {
    // This test creates a mock file
    const response = await page.request.post(`${BASE_URL}/api/scan`, {
      multipart: {
        images: await createMockFile(page),
        category: 'electronics',
        markets: 'EU,US',
      },
    });
    if (response.status() !== 202) throw new Error('Expected 202 Accepted');
    const json = await response.json();
    if (!json.sessionId) throw new Error('Expected sessionId in response');
  });

  async function createMockFile(page) {
    // Create a minimal valid image file
    return {
      name: 'test.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
        0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
        0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
        0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
        0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
        0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
        0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
        0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
        0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
        0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
        0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
        0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
        0x00, 0x00, 0x3F, 0x00, 0xF7, 0xCA, 0x28, 0xA2, 0x00, 0x00, 0x00, 0x00,
        0xFF, 0xD9,
      ]),
    };
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════');
  console.log(`📊 Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════\n');

  return results;
}

runSmokeTests().catch(console.error);