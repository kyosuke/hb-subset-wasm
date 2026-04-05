#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES="$ROOT_DIR/test/fixtures"

echo "=== hb-subset-wasm Cloudflare Workers E2E Test ==="
echo ""

# Start wrangler dev in background
echo "[1/5] Starting wrangler dev..."
cd "$SCRIPT_DIR"
wrangler dev --port 8799 &
WRANGLER_PID=$!

cleanup() {
  echo ""
  echo "Stopping wrangler (PID $WRANGLER_PID)..."
  kill $WRANGLER_PID 2>/dev/null || true
  wait $WRANGLER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for wrangler to start
echo "Waiting for wrangler to be ready..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8799/health > /dev/null 2>&1; then
    echo "  Ready after ${i}s"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "  FAIL: wrangler did not start in 30s"
    exit 1
  fi
  sleep 1
done

echo ""
PASS=0
FAIL=0

# Test 1: Health check
echo "[2/5] Health check..."
RESP=$(curl -s http://localhost:8799/health)
if [ "$RESP" = "ok" ]; then
  echo "  PASS: /health returned 'ok'"
  PASS=$((PASS+1))
else
  echo "  FAIL: expected 'ok', got '$RESP'"
  FAIL=$((FAIL+1))
fi

# Test 2: Subset regular font (Roboto)
echo "[3/5] Subset regular font (Roboto-Regular.abc.ttf, text='ab')..."
RESP=$(curl -s -X POST \
  --data-binary @"$FIXTURES/Roboto-Regular.abc.ttf" \
  "http://localhost:8799/subset?text=ab")
echo "  Response: $RESP"
OK=$(echo "$RESP" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.ok&&j.outputSize>0?'true':'false')}catch{console.log('false')}})")
if [ "$OK" = "true" ]; then
  echo "  PASS"
  PASS=$((PASS+1))
else
  echo "  FAIL"
  FAIL=$((FAIL+1))
fi

# Test 3: Subset variable font
echo "[4/5] Subset variable font (Roboto-Variable.ABC.ttf, text='A')..."
RESP=$(curl -s -X POST \
  --data-binary @"$FIXTURES/Roboto-Variable.ABC.ttf" \
  "http://localhost:8799/subset/varfont?text=A")
echo "  Response: $RESP"
OK=$(echo "$RESP" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.ok&&j.outputSize>0?'true':'false')}catch{console.log('false')}})")
if [ "$OK" = "true" ]; then
  echo "  PASS"
  PASS=$((PASS+1))
else
  echo "  FAIL"
  FAIL=$((FAIL+1))
fi

# Test 4: Subset variable font with axis pinning
echo "[5/5] Subset variable font with wght=400 pin..."
RESP=$(curl -s -X POST \
  --data-binary @"$FIXTURES/Roboto-Variable.ABC.ttf" \
  "http://localhost:8799/subset/varfont?text=A&wght=400")
echo "  Response: $RESP"
OK=$(echo "$RESP" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.ok&&j.outputSize>0?'true':'false')}catch{console.log('false')}})")
if [ "$OK" = "true" ]; then
  echo "  PASS"
  PASS=$((PASS+1))
else
  echo "  FAIL"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
