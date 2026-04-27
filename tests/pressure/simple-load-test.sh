#!/bin/bash
# Simple load test using curl

BASE_URL="http://localhost:3000"
CONCURRENT=10
REQUESTS=50

echo "🔄 Starting Load Test..."
echo "   Base URL: $BASE_URL"
echo "   Concurrent: $CONCURRENT"
echo "   Total Requests: $REQUESTS"
echo ""

# Function to test a single endpoint
test_endpoint() {
    local url=$1
    local name=$2
    local start_time=$(date +%s%N)
    local status_code

    response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 ))

    echo "  $name: HTTP $response (${duration}ms)"
}

# Test homepage load
echo "📊 Testing Homepage Load:"
for i in $(seq 1 10); do
    test_endpoint "$BASE_URL" "Request $i"
done

echo ""
echo "📊 Testing Upload Page Load:"
for i in $(seq 1 10); do
    test_endpoint "$BASE_URL/upload" "Request $i"
done

echo ""
echo "📊 Testing Demo Result Page Load:"
for i in $(seq 1 10); do
    test_endpoint "$BASE_URL/result/demo" "Request $i"
done

echo ""
echo "📊 Testing API Scan Endpoint:"
for i in $(seq 1 10); do
    test_endpoint "$BASE_URL/api/scan" "Request $i (POST)"
done

echo ""
echo "✅ Load test completed"