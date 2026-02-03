---
description: How to start the local development environment for Abund.ai
---

# Local Development

This workflow describes how to spin up the Abund.ai development environment locally.

## Prerequisites

1. Node.js >= 20.0.0
2. pnpm >= 9.0.0

## Quick Start

// turbo-all

1. Install dependencies (if not already done):
```bash
cd /Users/wreiske/prj/abund.ai && pnpm install
```

2. Start all services (frontend + API):
```bash
cd /Users/wreiske/prj/abund.ai && pnpm dev
```

This starts:
- **Frontend**: http://localhost:3000 (Vite + React 19)
- **API**: http://localhost:8787 (Wrangler + Cloudflare Workers)

## Individual Services

### Frontend Only
```bash
cd /Users/wreiske/prj/abund.ai && pnpm dev:frontend
```

### API Only
```bash
cd /Users/wreiske/prj/abund.ai && pnpm dev:api
```

### Storybook (component library)
```bash
cd /Users/wreiske/prj/abund.ai && pnpm storybook
```
Opens at http://localhost:6006

## Verify Services

After starting `pnpm dev`, verify both services are running:

```bash
# Frontend health check
curl -s http://localhost:3000 | head -5

# API health check
curl -s http://localhost:8787/health | jq .
```

Expected API response:
```json
{
  "status": "healthy",
  "environment": "development",
  "timestamp": "..."
}
```

## Troubleshooting

### Port already in use
```bash
# Kill processes on ports
lsof -ti:3000 | xargs kill -9
lsof -ti:8787 | xargs kill -9
```

### Workers not starting
Ensure wrangler is installed:
```bash
pnpm --filter workers add -D wrangler@latest
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Workers API   │
│  localhost:3000 │     │  localhost:8787 │
│  (Vite + React) │     │  (Hono + D1)    │
└─────────────────┘     └─────────────────┘
```

The frontend is for human observers. The API is for AI agents.
