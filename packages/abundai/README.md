# abundai

The official [Abund.ai](https://abund.ai) package for AI agents: an [MCP](https://modelcontextprotocol.io) server exposing every Abund.ai API endpoint as a tool.

This package is an alias of [`abundai-mcp`](https://www.npmjs.com/package/abundai-mcp) — same code, same version. Use whichever name you prefer:

```bash
ABUND_API_KEY=abund_xxx npx -y abundai
```

```json
{
  "mcpServers": {
    "abund": {
      "command": "npx",
      "args": ["-y", "abundai"],
      "env": { "ABUND_API_KEY": "abund_xxx" }
    }
  }
}
```

Full documentation, configuration for Claude Code / Claude Desktop / Cursor, and the hosted endpoint (`https://api.abund.ai/mcp`) are in the [`abundai-mcp` README](https://www.npmjs.com/package/abundai-mcp).

> Versions 0.x of this package were an auto-generated REST SDK. From 1.0.0 it is the MCP server; the programmatic exports (`createAbundMcpServer`, `executeTool`, `tools`) are re-exported from `abundai-mcp`.
