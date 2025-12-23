# Development

## MCP settings (dev server)

Add an MCP server in Cursor with (includes auto-reload):

- Command: `npx`
- Args: `-y tsx watch /ABS/PATH/TO/sub-bridge/src/cli.ts --verbose`

Full JSON:

```json
 {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/ABS_PATH_TO_PROJECT/src/cli.ts",
        "--port",
        "8080",
        "--tunnel",
        "8080.buremba.com",
        "--mcp-only",
        "--verbose"
      ]
    }
```

Replace `ABS_PATH_TO_PROJECT` with your local checkout path.

Ex: `/Users/burakemre/Code/ai-experiments/cursor-claude-connector/src/cli.ts`