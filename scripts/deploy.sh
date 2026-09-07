#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Abund.ai Deployment Script
# Deploys both the API Worker and the server-rendering frontend Worker
# ═══════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color


echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                    🚀 Abund.ai Deployment                      ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Pre-flight checks...${NC}"

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}✗ npx not found. Please install Node.js and pnpm.${NC}"
    exit 1
fi

# Find project root (use git root or fallback to pwd)
if git rev-parse --show-toplevel &> /dev/null; then
    PROJECT_ROOT=$(git rev-parse --show-toplevel)
else
    PROJECT_ROOT=$(pwd)
fi

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/package.json" ] || ! grep -q '"abund.ai"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
    echo -e "${RED}✗ Must be run from the abund.ai project directory${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Pre-flight checks passed${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Build Frontend
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Building MCP package (imported by the API for /mcp)...${NC}"
cd "$PROJECT_ROOT"
pnpm --filter abundai-mcp build
echo -e "${GREEN}✓ MCP package built${NC}"
echo ""

echo -e "${YELLOW}▶ Building frontend...${NC}"
cd "$PROJECT_ROOT/frontend"
pnpm build
echo -e "${GREEN}✓ Frontend built successfully${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Deploy API Workers
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Deploying API workers to Cloudflare...${NC}"
cd "$PROJECT_ROOT/workers"

# Deploy using top-level config (includes all bindings)
# Use --env="" to explicitly target root config and suppress warning
npx wrangler deploy 2>&1 | grep -v "WARNING" || true

echo -e "${GREEN}✓ API deployed to https://api.abund.ai${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 3.5: Apply Database Migrations
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Applying database migrations to production...${NC}"
cd "$PROJECT_ROOT/workers"

# Apply any pending migrations to the remote production DB
npx wrangler d1 migrations apply abund-db --remote 2>&1 | grep -v "WARNING\|Please add\|not inherited\|env.production" || true

echo -e "${GREEN}✓ Database migrations applied${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Deploy the server-rendering frontend Worker
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Deploying frontend Worker to Cloudflare...${NC}"
cd "$PROJECT_ROOT/workers"

# Read account ID from wrangler.toml (same as API deploy uses)
ACCOUNT_ID=$(grep 'account_id' wrangler.toml | head -1 | sed 's/.*= *"\([^"]*\)".*/\1/')

if [ -z "$ACCOUNT_ID" ]; then
    echo -e "${RED}✗ Could not find account_id in wrangler.toml${NC}"
    exit 1
fi

# wrangler reads the account from this env var.
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

# The frontend is a Worker now, not a Pages project: `react-router build`
# produced build/client (static assets) and build/server/index.js (the SSR
# bundle that server/worker.ts imports), and `wrangler deploy` ships both.
#
# The old `wrangler pages deploy --branch main` gotcha is gone with Pages -
# Workers have no branch concept, so a deploy from a worktree can no longer
# silently become a preview.
cd "$PROJECT_ROOT/frontend"

DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT" | grep -v "WARNING" || true

DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[^[:space:]]*\.workers\.dev' | head -1)

if [ -n "$DEPLOY_URL" ]; then
    echo -e "${GREEN}✓ Frontend Worker deployed (${DEPLOY_URL})${NC}"
else
    echo -e "${GREEN}✓ Frontend Worker deployed${NC}"
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                    ✨ Deployment Complete!                     ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}API:${NC}      https://api.abund.ai"
echo -e "  ${CYAN}Frontend:${NC} https://abund.ai"
if [ -n "$DEPLOY_URL" ]; then
    echo -e "  ${CYAN}Worker:${NC}   ${DEPLOY_URL}"
fi
echo ""
