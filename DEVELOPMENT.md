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
    "watch",
    "/ABS/PATH/TO/sub-bridge/src/cli.ts",
    "--verbose"
  ]
}
```

Replace `/ABS/PATH/TO/sub-bridge` with your local checkout path.

In Cursor chat, call the tool: `get_connection`.
- Optional: pass `provider=claude` or `provider=openai` to show only that section.
- It returns `publicUrl` plus a Claude OAuth authorize URL.
- Option A: call `get_connection` with `oauth_code` and `provider=claude` (paste full callback URL or `code#state`) to exchange and return a token.
- Option B: use the optional curl snippet shown in `get_connection`.
Then set your OpenAI API Base URL to `<publicUrl>/v1` and OpenAI API Key to `<Claude access token> <OpenAI key>` (space-separated).
If using ChatGPT login, use `<chatgpt_access_token>#<chatgpt_account_id>` for the OpenAI key.
