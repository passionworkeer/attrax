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
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = 'http://localhost:3000';

export default function () {
  // Test 1: Homepage
  const homeResponse = http.get(BASE_URL);
  check(homeResponse, {
    'homepage status is 200': (r) => r.status === 200,
    'homepage has content': (r) => r.body.length > 1000,
  });

  // Test 2: Upload page
  const uploadResponse = http.get(`${BASE_URL}/upload`);
  check(uploadResponse, {
    'upload page status is 200': (r) => r.status === 200,
  });

  // Test 3: Demo result page
  const demoResponse = http.get(`${BASE_URL}/result/demo`);
  check(demoResponse, {
    'demo result page status is 200': (r) => r.status === 200,
    'demo result has JSON': (r) => r.body.includes('sessionId'),
  });

  // Test 4: API scan endpoint (without images - should return 400 or 500)
  const scanResponse = http.post(`${BASE_URL}/api/scan`);
  check(scanResponse, {
    'api scan returns error': (r) => r.status >= 400,
  });

  // Test 5: API scan endpoint (with minimal data)
  const scanWithDataResponse = http.post(`${BASE_URL}/api/scan`, 'category=electronics&markets=EU,US', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  check(scanWithDataResponse, {
    'api scan with params returns error': (r) => r.status >= 400,
  });

  sleep(1);
}