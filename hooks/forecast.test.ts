import { expect, test } from 'claude-code/testing'

test('band shows weather, tokens, braille chart, delta and usage', async ($, on) => {
  let tokens = 0
  let fiveHour = 10
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 200_000, percent: Math.round(tokens / 2000) },
      rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour }],
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('ui.render', () => null as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const turn = async (t: number, h: number) => {
    await $.prompt.submit({ text: 'go' } as never)
    tokens = t
    fiveHour = h
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${t}`, reason: 'answer' })
  }
  await turn(36_100, 50)
  await turn(134_400, 54)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'token-forecast',
      surface,
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })
    expect((await ui.find({ type: 'Box' }))?.text).toBe(
      'focus ·  ◑  Showers 67% · 134.4k / 200k @ opus 5.5 · ⣀⣀⣀⣀⣀⣸ · 5h limit: 44% session, 4% last prompt (▲ +98.3k)',
    )
  }
})

test('fresh session shows 0% before the first response', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.start', (_, e) => e as never)
  on('ui.render', () => null as never)

  await $.session.start({ source: 'startup', cwd: 'E:/x' } as never)
  const ui = await $.ui.mount({ plugin: 'token-forecast', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await ui.find({ type: 'Box' }))?.text).toBe(' ○  Clear 0% · 0 / 1M @ opus 5.5 · ⣀⣀⣀⣀⣀⣀')
})
