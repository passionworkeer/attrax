/**
 * Improved Load Test for 火鹰合规 (Attrax)
 * Supports both k6 (with k6 installed) and standalone Node.js mode
 */

const BASE_URL = process.env.TARGET_URL || 'http://localhost:3000'

// Common test scenarios
const TEST_SCENARIOS = {
  homepage: {
    name: 'Homepage',
    url: '/',
    expectedStatus: 200,
    expectedMinSize: 1000
  },
  upload: {
    name: 'Upload Page',
    url: '/upload',
    expectedStatus: 200
  },
  result: {
    name: 'Demo Result Page',
    url: '/result/demo',
    expectedStatus: 200,
    expectedMinSize: 500
  },
  regulations: {
    name: 'Regulations Page',
    url: '/regulations',
    expectedStatus: 200
  },
  trace: {
    name: 'Trace Page',
    url: '/trace',
    expectedStatus: 200
  },
  roadmap: {
    name: 'Roadmap Page',
    url: '/roadmap',
    expectedStatus: 200
  }
}

// API endpoints to test
const API_ENDPOINTS = {
  health: { method: 'GET', path: '/api/health' },
  scan: { method: 'POST', path: '/api/scan' },
  regulationsUpdates: { method: 'GET', path: '/api/regulations/updates' }
}

// k6 configuration (for when k6 is available)
const K6_OPTIONS = `
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = '${BASE_URL}';

export default function () {
  // Homepage
  const homeRes = http.get(BASE_URL);
  check(homeRes, {
    'homepage status 200': (r) => r.status === 200,
    'homepage has content': (r) => r.body.length > 1000,
  });

  // Upload page
  const uploadRes = http.get(BASE_URL + '/upload');
  check(uploadRes, {
    'upload page status 200': (r) => r.status === 200,
  });

  // Demo result
  const demoRes = http.get(BASE_URL + '/result/demo');
  check(demoRes, {
    'demo result status 200': (r) => r.status === 200,
  });

  // API health
  const healthRes = http.get(BASE_URL + '/api/health');
  check(healthRes, {
    'health endpoint ok': (r) => r.status === 200,
  });

  // API scan (should fail without proper data)
  const scanRes = http.post(BASE_URL + '/api/scan');
  check(scanRes, {
    'scan endpoint rejects invalid request': (r) => r.status >= 400,
  });

  sleep(1);
}
`

// Node.js standalone load test (when k6 not available)
async function runNodeLoadTest(concurrency = 10, durationSeconds = 30) {
  console.log(`\n=== Node.js Load Test ===`)
  console.log(`Target: ${BASE_URL}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Duration: ${durationSeconds}s\n`)

  const results = {
    total: 0,
    success: 0,
    failed: 0,
    errors: [],
    responseTimes: []
  }

  const startTime = Date.now()
  const endTime = startTime + (durationSeconds * 1000)

  async function makeRequest(url, method = 'GET') {
    const reqStart = Date.now()
    try {
      const response = await fetch(BASE_URL + url, {
        method,
        headers: { 'Content-Type': 'application/json' }
      })
      const reqTime = Date.now() - reqStart
      results.responseTimes.push(reqTime)
      return { ok: response.ok, status: response.status, time: reqTime }
    } catch (error) {
      const reqTime = Date.now() - reqStart
      results.responseTimes.push(reqTime)
      return { ok: false, status: 0, time: reqTime, error: error.message }
    }
  }

  async function worker() {
    while (Date.now() < endTime) {
      for (const scenario of Object.values(TEST_SCENARIOS)) {
        results.total++
        const result = await makeRequest(scenario.url)

        if (result.ok && result.status === scenario.expectedStatus) {
          results.success++
        } else {
          results.failed++
          if (result.status !== scenario.expectedStatus) {
            results.errors.push(scenario.name + ': expected ' + scenario.expectedStatus + ', got ' + result.status)
          } else if (!result.ok) {
            results.errors.push(scenario.name + ': ' + (result.error || 'Request failed'))
          }
        }
      }

      // Test API endpoints
      results.total++
      const healthResult = await makeRequest('/api/health')
      if (healthResult.ok) {
        results.success++
      } else {
        results.failed++
        results.errors.push('Health: ' + (healthResult.error || 'Request failed'))
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  // Run concurrent workers
  const workers = []
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)

  // Calculate statistics
  const avgResponseTime = results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length
  const sortedTimes = [...results.responseTimes].sort((a, b) => a - b)
  const p95Index = Math.floor(sortedTimes.length * 0.95)
  const p99Index = Math.floor(sortedTimes.length * 0.99)

  console.log('\n=== Results ===')
  console.log('Total Requests: ' + results.total)
  console.log('Successful: ' + results.success + ' (' + (results.success / results.total * 100).toFixed(2) + '%)')
  console.log('Failed: ' + results.failed + ' (' + (results.failed / results.total * 100).toFixed(2) + '%)')
  console.log('\nResponse Times:')
  console.log('  Average: ' + avgResponseTime.toFixed(2) + 'ms')
  console.log('  P95: ' + (sortedTimes[p95Index] || 0) + 'ms')
  console.log('  P99: ' + (sortedTimes[p99Index] || 0) + 'ms')
  console.log('  Min: ' + (sortedTimes[0] || 0) + 'ms')
  console.log('  Max: ' + (sortedTimes[sortedTimes.length - 1] || 0) + 'ms')

  if (results.errors.length > 0) {
    console.log('\nErrors (first 10):')
    results.errors.slice(0, 10).forEach(e => console.log('  - ' + e))
  }

  return results
}

// Smoke test - quick check of all pages
async function runSmokeTest() {
  console.log('\n=== Smoke Test ===')
  console.log('Target: ' + BASE_URL + '\n')

  let passed = 0
  let failed = 0

  for (const scenario of Object.values(TEST_SCENARIOS)) {
    try {
      const response = await fetch(BASE_URL + scenario.url)
      const ok = response.status === scenario.expectedStatus
      const sizeOk = !scenario.expectedMinSize || parseInt(response.headers.get('content-length') || '0') > scenario.expectedMinSize

      if (ok && sizeOk) {
        console.log('  PASS: ' + scenario.name)
        passed++
      } else {
        console.log('  FAIL: ' + scenario.name + ' - Status: ' + response.status)
        failed++
      }
    } catch (error) {
      console.log('  FAIL: ' + scenario.name + ' - Error: ' + error.message)
      failed++
    }
  }

  // Test API endpoints
  for (const endpoint of Object.values(API_ENDPOINTS)) {
    try {
      const response = await fetch(BASE_URL + endpoint.path, {
        method: endpoint.method
      })
      const ok = response.status >= 200 && response.status < 500
      if (ok) {
        console.log('  PASS: API ' + endpoint.path)
        passed++
      } else {
        console.log('  FAIL: API ' + endpoint.path + ' - Status: ' + response.status)
        failed++
      }
    } catch (error) {
      console.log('  FAIL: API ' + endpoint.path + ' - Error: ' + error.message)
      failed++
    }
  }

  console.log('\nSmoke Test: ' + passed + ' passed, ' + failed + ' failed')
  return { passed, failed }
}

// Export k6 config
function exportK6Config() {
  console.log('\n=== K6 Configuration ===')
  console.log('Save the following to load-test-k6.js and run with: k6 run load-test-k6.js\n')
  console.log(K6_OPTIONS)
}

// Main entry point
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'smoke'

  switch (command) {
    case 'smoke':
      await runSmokeTest()
      break
    case 'load':
      const concurrency = parseInt(args[1]) || 10
      const duration = parseInt(args[2]) || 30
      await runNodeLoadTest(concurrency, duration)
      break
    case 'k6':
      exportK6Config()
      break
    default:
      console.log('Usage:')
      console.log('  node load-test.js smoke      - Run smoke test')
      console.log('  node load-test.js load [concurrency] [duration] - Run load test')
      console.log('  node load-test.js k6         - Export k6 configuration')
  }
}

main().catch(console.error)

module.exports = { runSmokeTest, runNodeLoadTest, TEST_SCENARIOS, API_ENDPOINTS }
