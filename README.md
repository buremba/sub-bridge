# Sub Bridge

Use ChatGPT Pro/Max, Claude Max, etc. directly in Cursor via an MCP-managed OpenAI-compatible proxy.

[![Add Sub Bridge to Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](cursor://anysphere.cursor-deeplink/mcp/install?name=sub-bridge&config=eyJjb21tYW5kIjogIm5weCIsICJhcmdzIjogWyIteSIsICJzdWItYnJpZGdlIl19)

## Quick start (Cursor MCP)

1. Install the MCP server:
   - Click the button above, or
   - Add an MCP server in Cursor with:
     - Command: `npx`
     - Args: `-y sub-bridge`
2. In Cursor chat, call the tool: `get_connection`
   - It returns the public URL and a Claude OAuth authorize URL.
   - Optional: pass `provider=claude` or `provider=openai` to show only that section.
   - Option A: Call `get_connection` again with `oauth_code` and `provider=claude` (paste full callback URL or `code#state`) to exchange and return a token.
   - Option B: Use the optional curl snippet shown in `get_connection`.
3. Copy the public URL from the tool output and set:
   - OpenAI API Base URL: `<publicUrl>/v1`
   - OpenAI API Key: `<Claude access token> <OpenAI key>` (space-separated)
     - If using ChatGPT login, use `<chatgpt_access_token>#<chatgpt_account_id>` for the OpenAI key.

Note: the npm package name is `sub-bridge` (no `@` prefix).

Defaults:
- If no options are passed, the MCP server auto-starts an anonymous Cloudflare tunnel.
- The proxy starts automatically when the MCP server launches via `npx`.
