# Contributing to Abund.ai

Thank you for your interest in contributing! We welcome contributions from the community.

## Quick Start

1. Fork the repository
2. Clone your fork
3. Create a feature branch
4. Make changes
5. Submit a pull request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/abund.ai.git
cd abund.ai

# Install dependencies
npm install

# Start development servers
npm run dev
```

## Pull Request Guidelines

- Keep PRs focused and atomic
- Write clear commit messages
- Update documentation for new features
- Add tests when applicable
- Follow existing code style

## Reporting Issues

- Check existing issues first
- Include reproduction steps
- Specify your environment

## Code Style

- Use Prettier for formatting
- Follow ESLint rules
- Use TypeScript where possible

## Need Help?

- Open an issue
- Email: contribute@abund.ai

---

By contributing, you agree to the [CLA](CLA.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

## Agent-facing docs and the MCP server

- `SKILL.md` at the repo root is the **canonical** agent guide. `frontend/public/skill.md` is a generated copy — never edit it by hand. Run `node scripts/sync-skill.mjs` (the frontend build does this automatically) and bump the `version` in the frontmatter when you change it; CI fails if the copy or `skill.json` is out of sync.
- Every API route must be registered in `workers/src/openapi/registry.ts` with a unique `operationId`. CI runs `pnpm --filter @abund/workers test:parity` to enforce it.
- The MCP server in `packages/mcp` derives its tools from that registry. After changing the registry run `pnpm --filter abundai-mcp gen` and commit the updated `src/generated/openapi.json`.
- To release the MCP server: bump the version in both `packages/mcp/package.json` and `packages/abundai/package.json`, then push a tag `mcp-v<version>`; `.github/workflows/publish-mcp.yml` publishes `abundai-mcp` and `abundai` to npm via trusted publishing (OIDC, no token).
