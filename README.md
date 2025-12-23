# Sub Bridge

Use ChatGPT Pro/Max, Claude Max, etc. directly in Cursor via an MCP-managed OpenAI-compatible proxy.

[![Add Sub Bridge to Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](cursor://anysphere.cursor-deeplink/mcp/install?name=sub-bridge&config=eyJjb21tYW5kIjogIm5weCIsICJhcmdzIjogWyIteSIsICJzdWItYnJpZGdlIl19)

Links:
- Repo: https://github.com/buremba/sub-bridge
- Landing page: https://buremba.github.io/sub-bridge/

## Why Sub Bridge

- Subscriptions win: Claude Code and ChatGPT Max typically deliver 3x to 5x more tokens per dollar than usage pricing.
- Use existing subscriptions: keep what you already pay for and route usage into Cursor.
- Keep Cursor UX: chat, agents, and tools continue to work; autocomplete still needs a Cursor plan.

## How it works

Cursor -> Sub Bridge MCP server -> Local OpenAI-compatible proxy -> Claude / OpenAI APIs

Tokens stay local in your browser storage. If you enable a tunnel, it only forwards requests to your machine; Sub Bridge does not store credentials server-side.

## Visual setup (from the landing page)

1) Install Sub Bridge in Cursor

<img src="public/assets/setup.png" alt="Install Sub Bridge in Cursor" width="420">

2) Log in with Claude (required)

<img src="public/assets/ui.png" alt="Login and connect accounts" width="420">

3) Paste the Base URL and API key into Cursor

<img src="public/assets/chat.png" alt="Use the generated key in Cursor" width="420">

Demo video (click to open the live landing page):

<a href="https://buremba.github.io/sub-bridge/">
  <video src="https://raw.githubusercontent.com/buremba/sub-bridge/main/public/assets/demo.mp4" width="640" controls muted playsinline poster="https://raw.githubusercontent.com/buremba/sub-bridge/main/public/assets/setup.png"></video>
</a>

## Quick start (Cursor MCP)

1. Install the MCP server in Cursor:
   - Click the button above, or
   - Add an MCP server with:
     - Command: `npx`
     - Args: `-y sub-bridge`
2. In Cursor chat, call the tool: `get_connection` and complete the Claude OAuth login (required).
   - It returns the public URL and the Claude authorize URL.
   - Optional: pass `provider=claude` to show only the Claude section.
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

## API key format and parsing

Sub Bridge reads the `Authorization: Bearer ...` header and supports multiple tokens so you can route Cursor models to Claude while still passing an OpenAI or ChatGPT token.

Rules:
- Tokens are space-separated. Comma separation is supported as a fallback.
- A routed key contains mappings before the last `:` and the API key after it.
- A mapping is `cursor_model=claude_model`, and multiple mappings are comma-separated.
- A plain token (no `=`) is treated as the default key.
- If a token contains `#account_id`, the suffix is used as the ChatGPT account id.
- Model aliases `opus-4.5` and `sonnet-4.5` expand to their full Claude model IDs.
- If the default key is a JWT or has an account id, requests go to the ChatGPT backend; otherwise they go to the OpenAI API.

Examples:

```text
Authorization: Bearer o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx sk-openai-xxx
```

Routes `o3` and `o3-mini` to Claude using `sk-ant-xxx`, while `sk-openai-xxx` becomes the default token.

```text
Authorization: Bearer o3=opus-4.5:sk-ant-xxx,sk-openai-xxx
```

Comma fallback: splits into a routed Claude token plus a default token.

```text
Authorization: Bearer sk-chatgpt-xxx#account_id
```

Single default token routed to the ChatGPT backend.
