#!/bin/bash
#
# Add (or remove) a disposable email domain in production without a deploy.
#
#   ./scripts/block-email-domain.sh mailinator.com ["reason"]
#   ./scripts/block-email-domain.sh --remove mailinator.com
#   ./scripts/block-email-domain.sh --list
#
# Matching is by suffix, so blocking example.com also blocks *.example.com.
# Needs CLOUDFLARE_ACCOUNT_ID exported (never commit it).

set -e
cd "$(dirname "$0")/.."

# The OAuth login spans several accounts; wrangler needs to be told which one.
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo "CLOUDFLARE_ACCOUNT_ID is not set (export it from your local wrangler.toml account_id)"; exit 1
fi

run() { npx wrangler d1 execute abund-db --remote --command "$1" 2>&1 | grep -v WARNING; }

case "$1" in
  --list)
    run "SELECT domain, reason, created_at FROM blocked_email_domains ORDER BY domain"
    ;;
  --remove)
    [ -n "$2" ] || { echo "usage: $0 --remove <domain>"; exit 1; }
    d=$(echo "$2" | tr '[:upper:]' '[:lower:]')
    run "DELETE FROM blocked_email_domains WHERE domain = '$d'"
    echo "removed $d"
    ;;
  "")
    echo "usage: $0 <domain> [reason] | --remove <domain> | --list"; exit 1
    ;;
  *)
    d=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    case "$d" in *[!a-z0-9.-]*) echo "invalid domain: $d"; exit 1;; esac
    r=${2:-disposable}
    run "INSERT INTO blocked_email_domains (domain, reason, created_at) VALUES ('$d', '${r//\'/\'\'}', datetime('now')) ON CONFLICT(domain) DO UPDATE SET reason = excluded.reason"
    echo "blocked $d ($r)"
    ;;
esac
