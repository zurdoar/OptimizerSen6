import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'optimizer-model',
  component: 'Pane',
  requestId: 'optimizer-model',
  props: {
    title: 'Optimizer Model',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('rutea lo genérico, respeta a los obreros y muestra el flujo', async ($, on) => {
  const pedidos: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'optimizer' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__optimizer-model__${(e as { name: string }).name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: { id: 't' } }))
  on('agent.spawn', (_, e) => {
    pedidos.push(e.model)
    const model = e.model === 'haiku' ? 'claude-haiku-5-5' : e.subagentType.endsWith('obrero-ligero') ? 'claude-haiku-5-5' : 'claude-opus-5-5'
    return { model, agentId: `a${pedidos.length}` }
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__optimizer-model__progreso',
    title: 'Paquete de publicación',
    total: 3,
    phase: 'delegate',
    tasks: [
      { title: 'Transcribir el audio', tier: 'ligero' },
      { title: 'Escribir la descripción', tier: 'medio', after: [1] },
      { title: 'Revisar capítulos', tier: 'cuidadoso', after: [2] },
    ],
  })
  await $.agent.spawn({ prompt: 'Buscá todos los .mp3 y listalos', description: 'Inventario mp3', subagentType: 'general-purpose' })
  await $.agent.spawn({ prompt: 'Buscá y transcribí el audio', description: 'Transcribir el audio', subagentType: 'optimizer-model:obrero-ligero' })
  await $.agent.spawn({ prompt: 'Escribí el guion', description: 'Guion', subagentType: 'general-purpose' })
  await $.tool.call({ tool: 'mcp__optimizer-model__paso', total: 4, done: 1, note: 'Corriendo Whisper', agentId: 'a2' })
  await $.tool.call({ tool: 'Bash', command: 'python whisper_run.py audio.mp3', agentId: 'a1' })

  expect(pedidos[0]).toBe('haiku')
  expect(pedidos[1]).toBe(undefined)
  expect(pedidos[2]).toBe(undefined)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const hay = async (re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined
    expect(await hay(/Inventario mp3/)).toBe(true)
    expect(await hay(/Whisper/)).toBe(true)
    expect(await hay(/Haiku 5\.5/)).toBe(true)
    expect(await hay(/Corriendo Whisper/)).toBe(true)
    expect(await hay(/Escribir la descripción/)).toBe(true)
    expect(await hay(/Transcribir el audio/)).toBe(true)
    await ui.unmount()
  }
})
