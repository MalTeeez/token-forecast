export type Forecast = {
  /** Context tokens at the end of each of the last 13 turns (13 so the oldest of 12 has a delta). */
  hist: number[]
  window: number
  model: string
  /** Points of the five-hour usage limit this session / the last prompt consumed. */
  sessionPct: number
  promptPct: number
  /** Last five-hour reading seen, to diff the next one against. */
  last5h: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-forecast': { forecast: Forecast }
  }
}
