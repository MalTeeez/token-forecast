import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Forecast } from '../types'

const EMPTY: Forecast = { hist: [], window: 0, model: '', sessionPct: 0, promptPct: 0, last5h: null }
const forecast = atom({ plugin: 'token-forecast', key: 'forecast' } as const, EMPTY)

const WEATHER = [
  { below: 25, icon: '○', word: 'Clear', color: 'yellow' },
  { below: 50, icon: '◔', word: 'Cloudy', color: 'cyan' },
  { below: 75, icon: '◑', word: 'Showers', color: 'blueBright' },
  { below: 90, icon: '◕', word: 'Storm', color: 'magenta' },
  { below: Infinity, icon: '●', word: 'Compact soon', color: 'red' },
]

const fmt = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${n}`

const pct = (n: number) => `${+n.toFixed(n < 10 ? 1 : 0)}%`

// "claude-opus-5-5[1m]" or "Opus 5.5 (1M context)" -> "opus 5.5"
const shortModel = (m: string) => {
  const s = m.toLowerCase().replace(/\[.*?\]|\(.*?\)/g, '').replace(/^claude-/, '').trim()
  const g = s.match(/^([a-z]+)[- ](\d+)(?:[-.](\d{1,2})(?!\d))?/)
  return g ? `${g[1]} ${g[2]}${g[3] ? `.${g[3]}` : ''}` : s
}

// Braille bars for the last 12 turns, two per cell, 0-4 dots high, scaled to the tallest turn.
// Turns not taken yet draw a flat bottom dot; returns [cells with no turn yet, the rest].
const LEFT = [0x40, 0x04, 0x02, 0x01]
const RIGHT = [0x80, 0x20, 0x10, 0x08]
const spark = (vals: number[]): [string, string] => {
  const max = Math.max(...vals, 1)
  const lvl = (v: number | null) => (v === null ? 1 : v <= 0 ? 0 : Math.max(1, Math.round((v / max) * 4)))
  const slots = [...Array<null>(12 - vals.length).fill(null), ...vals]
  let empty = ''
  let filled = ''
  for (let i = 0; i < 12; i += 2) {
    const [l = null, r = null] = slots.slice(i, i + 2)
    let bits = 0
    for (let d = 0; d < lvl(l); d++) bits |= LEFT[d] ?? 0
    for (let d = 0; d < lvl(r); d++) bits |= RIGHT[d] ?? 0
    const cell = String.fromCharCode(0x2800 + bits)
    if (l === null && r === null) empty += cell
    else filled += cell
  }
  return [empty, filled]
}

const fiveHour = (u: SessionUsage) => u.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed

// Reads the window and the five-hour limit now and adds this turn to the history.
async function record($: EngineInterface) {
  const usage = await $.session.usage()
  const model = await $.session.model()
  const now = fiveHour(usage)
  const tokens = usage.context.tokens

  await update($, forecast, f => {
    // ponytail: the five-hour window is account-wide, so other sessions running at the same time count here too
    const d = now === undefined || f.last5h === null ? 0 : now >= f.last5h ? now - f.last5h : now
    return {
      hist: tokens === undefined ? f.hist : [...f.hist, tokens].slice(-13),
      window: usage.context.window,
      model: shortModel(model),
      sessionPct: f.sessionPct + d,
      promptPct: f.promptPct + d,
      last5h: now ?? f.last5h,
    }
  })
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const now = fiveHour(await $.session.usage())
    await update($, forecast, f => ({ ...f, promptPct: 0, last5h: f.last5h ?? now ?? null }))
    return next(e)
  })

  // Fires on load and every reload: show the current fill right away instead of after the next turn.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (!(await read($, forecast)).window) await record($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await record($)
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, forecast, () => EMPTY)
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const f = await read($, forecast)
    if (!f.window) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const used = f.hist.at(-1) ?? 0
    const prev = f.hist.at(-2)
    const p = (used / f.window) * 100
    const w = WEATHER.find(x => p < x.below)!
    const delta = prev === undefined ? null : used - prev
    const sep = (k: string) => <Text key={k} dimColor> · </Text>

    // Keep the engine's own mode labels (`focus`, ...) in front of the forecast.
    const modes = e.props.modes.length ? [<Text key="modes" dimColor>{e.props.modes.join(' & ')}</Text>, sep('s0')] : []
    const parts = [
      ...modes,
      <Text key="icon" color={w.color} dimColor>{` ${w.icon} `}</Text>,
      <Text key="sky" color={w.color} bold>{` ${w.word} ${Math.round(p)}%`}</Text>,
      sep('s1'),
      <Text key="used">{`${fmt(used)} / ${fmt(f.window)}`}</Text>,
      <Text key="model" dimColor>{` @ ${f.model}`}</Text>,
    ]
    const [noTurns, turns] = spark(f.hist.slice(-12))
    parts.push(sep('s2'), <Text key="sparkEmpty" color="gray">{noTurns}</Text>, <Text key="spark" color={w.color}>{turns}</Text>)
    if (f.last5h !== null) {
      parts.push(
        sep('s4'),
        <Text key="l1" dimColor>5h limit: </Text>,
        <Text key="session" bold>{pct(f.sessionPct)}</Text>,
        <Text key="l2" dimColor> session, </Text>,
        <Text key="prompt" bold>{pct(f.promptPct)}</Text>,
        <Text key="l3" dimColor> last prompt</Text>,
      )
    }
    if (delta !== null) {
      parts.push(
        <Text key="d1" dimColor>{f.last5h !== null ? ' (' : ' · ('}</Text>,
        <Text key="delta" color={delta > 0 ? w.color : 'green'}>
          {`${delta >= 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(delta))}`}
        </Text>,
        <Text key="d2" dimColor>)</Text>,
      )
    }
    return <Box>{parts}</Box>
  })
}
