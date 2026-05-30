#!/usr/bin/env bash
# Run from Mac project root. Sets up NIM models on GX10 only (not backend/frontend).
# Usage: NGC_API_KEY=nvapi-... bash scripts/gx10-setup-models.sh
# Or:    bash scripts/gx10-setup-models.sh   (reads NGC_API_KEY from .env)
set -euo pipefail

GX10_HOST="${GX10_HOST:-100.81.85.39}"
GX10_USER="${GX10_USER:-asus}"
GX10_PASS="${GX10_PASS:-password}"
REMOTE_DIR="${REMOTE_DIR:-~/ProjectHaven}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a && source .env && set +a
fi

if [ -z "${NGC_API_KEY:-}" ] || [ "$NGC_API_KEY" = "your_ngc_key_here" ]; then
  echo "ERROR: Set NGC_API_KEY in .env or environment"
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Installing sshpass..."
  brew install hudochenkov/sshpass/sshpass
fi

SSH="sshpass -p ${GX10_PASS} ssh -o StrictHostKeyChecking=no ${GX10_USER}@${GX10_HOST}"
SCP="sshpass -p ${GX10_PASS} scp -o StrictHostKeyChecking=no"
RSYNC="sshpass -p ${GX10_PASS} rsync -avz --progress"

echo "=== Syncing docker-compose.yml to GX10 ==="
$SSH "mkdir -p ${REMOTE_DIR}"
$SCP docker-compose.yml "${GX10_USER}@${GX10_HOST}:${REMOTE_DIR}/"

echo "=== Writing GX10 .env (NGC_API_KEY only) ==="
$SSH "cat > ${REMOTE_DIR}/.env << 'ENVEOF'
NGC_API_KEY=${NGC_API_KEY}
ENVEOF
chmod 600 ${REMOTE_DIR}/.env"

echo "=== Starting Gemma NIM on GPU ==="
$SSH "cd ${REMOTE_DIR} && docker compose up nim -d"

echo "=== Waiting for NIM (may take several minutes on first pull) ==="
for i in $(seq 1 60); do
  if $SSH "curl -sf http://localhost:8001/v1/models >/dev/null 2>&1"; then
    echo "NIM ready on :8001"
    break
  fi
  echo "  ... still starting ($i/60)"
  sleep 10
done

echo "=== Status ==="
$SSH "cd ${REMOTE_DIR} && docker compose ps && curl -s http://localhost:8001/v1/models | head -c 200 && echo && nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader"

echo ""
echo "=== Mac .env reminder ==="
echo "NIM_ENDPOINT=http://${GX10_HOST}:8001/v1"
echo "NIM_FALLBACK=http://${GX10_HOST}:8001/v1"
echo "FORCE_CPU_SOLVER=1"
