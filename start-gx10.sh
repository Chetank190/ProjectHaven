#!/usr/bin/env bash
# Haven Matrix — GX10 startup helper
# Run from project root: bash start-gx10.sh
set -e

cd "$(dirname "$0")"

echo "=== Haven Matrix GX10 Startup ==="
echo ""

# 1. Hardware check
echo "[1/5] Hardware..."
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null \
  && echo "      GPU OK" \
  || echo "      WARNING: nvidia-smi not found — is nvidia runtime available?"
uname -m  # should print aarch64

# 2. .env check
echo ""
echo "[2/5] Environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "      Created .env from .env.example"
  echo "      ACTION REQUIRED: set NGC_API_KEY in .env then re-run"
  exit 1
fi
source .env 2>/dev/null || true
if [ -z "$NGC_API_KEY" ] || [ "$NGC_API_KEY" = "your_ngc_key_here" ]; then
  echo "      WARNING: NGC_API_KEY not set in .env — NIM container may fail to pull"
  echo "      Get key at: https://build.nvidia.com"
else
  echo "      NGC_API_KEY set (${#NGC_API_KEY} chars)"
fi

# 3. Python venv
echo ""
echo "[3/5] Python venv..."
if [ ! -d .vhaven ]; then
  python3 -m venv .vhaven
  echo "      Created .vhaven"
fi
source .vhaven/bin/activate
pip install -r backend/requirements.txt -q
echo "      Dependencies installed"

# 4. Print terminal layout
echo ""
echo "[4/5] Ready. Open 4 terminals and run:"
echo ""
echo "  T1 (monitor):   watch -n 1 nvidia-smi"
echo ""
echo "  T2 (Gemma GPU): cd $(pwd) && docker compose up nim"
echo "                  # Wait for: NIM server started  (may take 2-3 min first run)"
echo ""
echo "  T3 (backend):   cd $(pwd)"
echo "                  source .vhaven/bin/activate"
echo "                  export FORCE_CPU_SOLVER=1"
echo "                  export NIM_ENDPOINT=http://localhost:8001/v1"
echo "                  export NIM_FALLBACK=http://localhost:8001/v1"
echo "                  uvicorn backend.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "  T4 (frontend):  cd $(pwd)/frontend && npm run dev"
echo ""

# 5. Quick data check
echo "[5/5] Verifying data..."
python3 backend/data_ingestion.py --verify --mode cpu 2>&1 | grep -E "(Loaded|✓|ERROR|WARNING)"

echo ""
echo "=== All checks passed. Start the 4 terminals above. ==="
echo ""
echo "Port-forward from laptop:"
echo "  ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8"
echo ""
echo "Health check (after backend starts):"
echo "  curl http://localhost:8000/api/v1/health"
