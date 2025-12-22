/**
 * Shared MCP proxy functionality
 */

export interface McpToolResult {
  [x: string]: unknown
  content: Array<{ type: 'text'; text: string }>
}

/**
 * Call a tool on the HTTP server
 */
export async function callTool(port: number, name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
  const response = await fetch(`http://localhost:${port}/mcp/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ arguments: args }),
  })

  if (!response.ok) {
    const error = await response.text()
    return {
      content: [{ type: 'text' as const, text: `Error calling tool ${name}: ${error}` }],
    }
  }

  return response.json() as Promise<McpToolResult>
}

/**
 * Start MCP server and register tools that forward to HTTP server
 */
export async function startMcpServer(serverPort: number, log: (...args: any[]) => void) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')

  const server = new McpServer({
    name: 'Sub Bridge',
    version: '2.1.0',
  })

  // Register tools that forward to HTTP server
  server.tool(
    'get_status',
    'Get Sub Bridge status and login URL for Claude/ChatGPT authentication',
    {},
    async () => callTool(serverPort, 'get_status'),
  )

  // Start MCP transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log('[mcp] MCP server started, connected to HTTP server on port', serverPort)
}
