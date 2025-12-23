type StatusTextMode = 'server' | 'proxy'

interface StatusTextOptions {
  mode: StatusTextMode
  baseUrl: string
  isLocalOnly?: boolean
  tunnelActive?: boolean
}

const MODEL_MAPPING_LINES = [
  'Model mapping: API key format is "o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx"',
  '- Cursor requests "o3" → routes to "claude-opus-4-5-20251101"',
  '- Cursor requests "o3-mini" → routes to "claude-sonnet-4-5-20250514"',
]

export function buildStatusText(options: StatusTextOptions): string {
  const { mode, baseUrl } = options
  const baseUrlForV1 = baseUrl.replace(/\/$/, '')

  if (mode === 'server') {
    const lines = [
      'Sub Bridge is running.',
      '',
      `Setup URL: ${baseUrl}?to=cursor`,
      "Open this URL in your browser where you're logged into ChatGPT or Claude.",
      '',
      'To configure Cursor:',
      '1. Authenticate with ChatGPT or Claude in the web UI',
      '2. Copy the generated API key',
      '3. In Cursor Settings → Models → API Keys',
      '   - Paste the API key from the web UI',
      `   - Set Base URL from the web UI`,
      '',
      ...MODEL_MAPPING_LINES,
    ]

    if (options.isLocalOnly && !options.tunnelActive) {
      lines.push('', 'Note: Using local URL. If Cursor needs a public URL, enable a tunnel in the web UI.')
    }

    lines.push('', `Setup screenshot: ${baseUrl}/assets/setup.png`)
    return lines.join('\n')
  }

  return [
    'Sub Bridge server not reachable.',
    '',
    'To set up:',
    `1. Open ${baseUrl}?to=cursor in your browser where you're logged into ChatGPT or Claude`,
    '2. Authenticate and copy the generated API key',
    `3. In Cursor: Settings → Models → API Keys, paste the key and set Base URL from the web UI`,
    '',
    ...MODEL_MAPPING_LINES,
    `Setup screenshot: ${baseUrl}/assets/setup.png`,
  ].join('\n')
}
