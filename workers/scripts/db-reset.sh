#!/bin/bash
#
# Database Reset Script for Abund.ai
#
# Usage:
#   ./scripts/db-reset.sh          # Reset local dev database
#   ./scripts/db-reset.sh --force  # Force reset without confirmation
#
# This script:
# 1. Removes local D1 state
# 2. Applies all migrations
# 3. Seeds the database with test data
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"

cd "$WORKERS_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🗄️  Abund.ai Database Reset${NC}"
echo ""

# Check for --force flag
if [[ "$1" != "--force" ]]; then
  echo -e "${YELLOW}⚠️  This will delete all local database data.${NC}"
  read -p "Are you sure? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
  fi
fi

echo -e "${YELLOW}Step 1: Removing local D1 state...${NC}"
rm -rf .wrangler/state/v3/d1
echo -e "${GREEN}✓ Local D1 state removed${NC}"

echo ""
echo -e "${YELLOW}Step 2: Applying migrations...${NC}"

# wrangler's `d1 migrations apply` creates this bookkeeping table itself;
# `d1 execute` does not, so create it here so migration files that stamp
# themselves (e.g. 0014) apply cleanly on a fresh local database.
npx wrangler d1 execute abund-db --local --command \
  "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);" \
  > /dev/null 2>&1 || true

# Apply migrations in order (a failure is reported, not hidden)
for migration in src/db/migrations/*.sql; do
  if [ -f "$migration" ]; then
    # Skip no-op migrations (comment-only files kept for history)
    if ! grep -qvE '^[[:space:]]*(--.*)?$' "$migration"; then
      echo "  Skipping (no-op): $(basename $migration)"
      continue
    fi
    echo "  Applying: $(basename $migration)"
    if ! npx wrangler d1 execute abund-db --local --file="$migration" > /dev/null 2>&1; then
      echo -e "  ${RED}✗ Failed: $(basename $migration)${NC}"
      npx wrangler d1 execute abund-db --local --file="$migration" 2>&1 | grep -i "error" | head -3 || true
    fi
  fi
done
echo -e "${GREEN}✓ Migrations applied${NC}"

echo ""
echo -e "${YELLOW}Step 3: Seeding database...${NC}"
npx wrangler d1 execute abund-db --local --file=./src/db/seed.sql 2>/dev/null || true
echo -e "${GREEN}✓ Database seeded${NC}"

echo ""
echo -e "${GREEN}✅ Database reset complete!${NC}"
echo ""
echo "You can now start the development server with: pnpm dev"
