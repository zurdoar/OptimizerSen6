import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Agente, Fase, Flujo, TareaPlan } from '../types'

// Optimizer Model: elige el modelo de cada subagente según la tarea (sin gastar
// tokens en decidirlo), registra las herramientas de progreso que usa /flujo y
// dibuja un panel con un muñeco Claude por agente y una barra sobre el prompt.

const PANE = 'optimizer-model'
const TITULO_PANEL = 'Optimizer Model'
const agentes = atom({ plugin: 'optimizer-model', key: 'agentes' } as const, [])
const flujo = atom({ plugin: 'optimizer-model', key: 'flujo' } as const, null)
const ahora = atom({ plugin: 'optimizer-model', key: 'ahora' } as const, 0)
const costoSesion = atom({ plugin: 'optimizer-model', key: 'costoSesion' } as const, 0)
const isActivo = atom({ plugin: 'optimizer-model', key: 'isActivo' } as const, true)

// --- Niveles de obrero -------------------------------------------------------

const NIVELES = ['ligero', 'medio', 'cuidadoso', 'pesado', 'fable'] as const

const MODELO_NIVEL: Record<string, [string, string]> = {
  ligero: ['claude-haiku-5-5', 'medium'],
  medio: ['claude-sonnet-5-5', 'medium'],
  cuidadoso: ['claude-opus-5-5', 'high'],
  pesado: ['claude-opus-5-5', 'xhigh'],
  fable: ['claude-fable-5-1', 'high'],
}

// `optimizer-model:obrero-ligero` → `ligero`; '' para cualquier otro tipo.
function nivelDe(tipo: string): string {
  const pelado = tipo.replace(/^[^:]*:/, '')
  const n = pelado.replace(/^obrero-/, '')

  return pelado.startsWith('obrero-') && (NIVELES as readonly string[]).includes(n) ? n : ''
}

// --- Reglas de ruteo ---------------------------------------------------------

type Eleccion = { modelo: string; rol: string }

const POR_TIPO: Record<string, Eleccion> = {
  Explore: { modelo: 'haiku', rol: 'búsqueda' },
  'claude-code-guide': { modelo: 'haiku', rol: 'consulta' },
  'statusline-setup': { modelo: 'haiku', rol: 'config' },
}

// Solo se rutean los subagentes genéricos; un tipo con modelo propio (los
// obreros, los de otros plugins, los agentes del usuario) se respeta tal cual.
const RUTEABLES = new Set(['general-purpose', 'claude', ...Object.keys(POR_TIPO)])

// Trabajo que pide criterio fino: se queda en el modelo principal.
const PESADO =
  /\b(guion|gui[oó]n|dise[ñn]|arquitect|estrateg|decid|depur|debug|bug|refactor|planific|investig|redact|escrib|design|architect|write)/i
// Trabajo mecánico o repetitivo: alcanza con Haiku.
const MECANICO =
  /\b(busc|list|renombr|mov[eé]|copi|cont[aá]|transcrib|extra[eé]|descarg|verific[aá] que|chequ|orden[aá]|find|rename|grep|count|download|inventor|inventari)/i

function elegir(tipo: string, prompt: string): Eleccion {
  const fijo = POR_TIPO[tipo]
  if (fijo) {
    return fijo
  }
  if (PESADO.test(prompt)) {
    return { modelo: 'inherit', rol: 'creativa' }
  }
  if (MECANICO.test(prompt) && prompt.length < 4000) {
    return { modelo: 'haiku', rol: 'mecánica' }
  }

  return { modelo: 'sonnet', rol: 'general' }
}

// --- Qué herramienta es cada llamada -----------------------------------------

const POR_COMANDO: [RegExp, string][] = [
  [/whisper/i, 'Whisper'],
  [/qwen|tts/i, 'TTS (voz)'],
  [/hyperframes/i, 'HyperFrames'],
  [/gemini/i, 'Gemini CLI'],
  [/notebooklm/i, 'NotebookLM'],
  [/ffmpeg|ffprobe/i, 'FFmpeg'],
  [/\bssh\b/i, 'SSH'],
  [/\bgit\b/i, 'Git'],
  [/\bnpm\b|\bnpx\b|\bnode\b/i, 'Node'],
  [/python|\.py\b/i, 'Python'],
]

function herramienta(tool: string, input: Record<string, unknown>): string {
  if (tool.startsWith('mcp__optimizer-model__')) return ''
  if (tool.startsWith('mcp__llms__') || /gemini/i.test(tool)) return 'Gemini (API)'
  if (tool.startsWith('mcp__Claude_Browser__')) return 'Navegador'
  if (tool.startsWith('mcp__claude-in-chrome__')) return 'Chrome'
  if (tool.startsWith('mcp__ccd_')) return ''
  if (tool.startsWith('mcp__')) return tool.split('__')[1] ?? tool
  if (tool === 'Bash' || tool === 'PowerShell') {
    const comando = String(input.command ?? '')
    const hit = POR_COMANDO.find(([re]) => re.test(comando))

    return hit ? hit[1] : 'Terminal'
  }
  if (tool === 'Skill') return `Skill ${String(input.skill ?? '')}`
  if (tool === 'Agent') return 'Lanzando obrero'
  if (tool === 'Read') return 'Leyendo archivo'
  if (/^(Edit|Write|NotebookEdit)$/.test(tool)) return 'Escribiendo archivo'
  if (/^(Glob|Grep)$/.test(tool)) return 'Buscando en archivos'
  if (/^Web(Search|Fetch)$/.test(tool)) return 'Web'

  return tool
}

// --- Modelos: nombre, color, precio ------------------------------------------

type Familia = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'otro'

function familia(modelo: string): Familia {
  const m = modelo.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'

  return 'otro'
}

const COLOR: Record<Familia, string> = {
  opus: '#E8913A',
  fable: '#8B7CF6',
  sonnet: '#4C8DF6',
  haiku: '#34C38F',
  otro: '#9CA3AF',
}

const VERDE = '#34C38F'

// US$ por millón de tokens: entrada, salida, lectura de caché (escritura = 1,25 × entrada).
const PRECIO: Record<Familia, [number, number, number]> = {
  fable: [10, 50, 0.25],
  opus: [4, 20, 0.2],
  sonnet: [2, 10, 0.2],
  haiku: [0.1, 0.5, 0.01],
  otro: [4, 20, 0.2],
}

function nombre(modelo: string): string {
  const hit = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(modelo)
  if (!hit) {
    return modelo.charAt(0).toUpperCase() + modelo.slice(1)
  }
  const fam = hit[1] ?? ''

  return `${fam.charAt(0).toUpperCase()}${fam.slice(1)} ${hit[2]}${hit[3] ? `.${hit[3]}` : ''}`
}

function costo(modelo: string, u: ModelUsage): number {
  const [entrada, salida, cache] = PRECIO[familia(modelo)]

  return (
    (u.input_tokens * entrada +
      u.cache_creation_input_tokens * entrada * 1.25 +
      u.cache_read_input_tokens * cache +
      u.output_tokens * salida) /
    1_000_000
  )
}

// --- El muñeco Claude, en pixel art ------------------------------------------

type Pixel = [number, number, number, number, string]

const NARANJA = '#D97757'
const OSCURO = '#2B1A14'

const CUERPO: Pixel[] = [
  [2, 4, 10, 6, NARANJA],
  [0, 6, 2, 2, NARANJA],
  [12, 6, 2, 2, NARANJA],
  [4, 5, 1, 2, OSCURO],
  [9, 5, 1, 2, OSCURO],
  [3, 10, 1, 2, NARANJA],
  [5, 10, 1, 2, NARANJA],
  [8, 10, 1, 2, NARANJA],
  [10, 10, 1, 2, NARANJA],
]

const SOMBRERO: Record<Familia, Pixel[]> = {
  // Casco de obra amarillo
  opus: [
    [4, 1, 6, 1, '#F2B53A'],
    [3, 2, 8, 1, '#F2B53A'],
    [1, 3, 12, 1, '#E0A12A'],
    [6, 1, 2, 2, '#FFD36B'],
  ],
  // Gorro de marinero
  sonnet: [
    [5, 0, 4, 1, '#F4F6FA'],
    [3, 1, 8, 2, '#F4F6FA'],
    [3, 3, 8, 1, '#3B6FD8'],
    [6, 0, 2, 1, '#3B6FD8'],
  ],
  // Gorra verde con visera
  haiku: [
    [4, 1, 6, 1, '#34C38F'],
    [3, 2, 7, 2, '#34C38F'],
    [10, 3, 4, 1, '#22966B'],
  ],
  // Sombrero de mago violeta con estrella
  fable: [
    [6, 0, 2, 1, '#8B7CF6'],
    [5, 1, 4, 1, '#8B7CF6'],
    [4, 2, 6, 1, '#8B7CF6'],
    [2, 3, 10, 1, '#6D5DE0'],
    [7, 1, 1, 1, '#FFD36B'],
  ],
  otro: [],
}

function muneco(modelo: string, isTenue = false): string {
  const pixeles = [...SOMBRERO[familia(modelo)], ...CUERPO]
  const rects = pixeles
    .map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 16 14" shape-rendering="crispEdges"><g opacity="${isTenue ? 0.45 : 1}">${rects}</g></svg>`
}

function barra(parte: number, color: string): string {
  const ancho = Math.round(Math.max(0, Math.min(1, parte)) * 1000)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 6" preserveAspectRatio="none"><rect width="1000" height="6" rx="3" fill="#8884"/><rect width="${ancho}" height="6" rx="3" fill="${color}"/></svg>`
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// La banda sobre el prompt: un solo dibujo (título, barra y cuenta), porque el
// escritorio parte en renglones los elementos hermanos.
function banda(f: Flujo, ancho: number): string {
  const parte = progreso(f)
  const color = f.isTerminado ? VERDE : NARANJA
  const tituloW = Math.min(220, Math.round(ancho * 0.35))
  const barraX = tituloW + 12
  const barraW = Math.max(40, ancho - barraX - 150)
  const lleno = Math.round(barraW * parte)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="22" viewBox="0 0 ${ancho} 22">
<style>text{font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:12px;fill:#8a8580}.t{fill:currentColor;font-weight:600}</style>
<circle cx="6" cy="11" r="4" fill="${color}"/>
<text x="16" y="15" class="t" style="fill:${color}">${xml(f.titulo.length > 28 ? `${f.titulo.slice(0, 27)}…` : f.titulo)}</text>
<rect x="${barraX}" y="8" width="${barraW}" height="6" rx="3" fill="#8884"/>
<rect x="${barraX}" y="8" width="${lleno}" height="6" rx="3" fill="${color}"/>
<text x="${barraX + barraW + 10}" y="15">${xml(etiqueta(f))} · ${Math.round(parte * 100)}%</text>
</svg>`
}

// --- Formato -----------------------------------------------------------------

function miles(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`

  return String(n)
}

function duracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function titulo(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (limpio === '') return 'Chat principal'

  return limpio.length > 42 ? `${limpio.slice(0, 41)}…` : limpio
}

function norma(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

// --- El flujo (lo que reporta /flujo) ----------------------------------------

const FASES: readonly Fase[] = ['plan', 'design', 'delegate', 'review', 'close']

type EntradaProgreso = {
  title?: string
  total?: number
  done?: number
  phase?: string
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

const vacio = (): Flujo => ({ titulo: 'flujo', total: 0, hecho: 0, fase: 'plan', isTerminado: false, tareas: [] })

function isNuevo(prev: Flujo | null, e: EntradaProgreso): boolean {
  return !prev || prev.isTerminado || (e.title !== undefined && e.title.trim() !== prev.titulo)
}

function fusionar(prev: Flujo | null, e: EntradaProgreso): Flujo {
  const base = isNuevo(prev, e) || !prev ? vacio() : prev
  const tareas: TareaPlan[] = e.tasks
    ? e.tasks
        .filter(t => t.title?.trim())
        .slice(0, 40)
        .map(t => ({
          titulo: (t.title ?? '').trim(),
          nivel: (NIVELES as readonly string[]).includes(String(t.tier)) ? String(t.tier) : '',
          despues: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0).slice(0, 8),
        }))
    : base.tareas
  const total = Math.max(0, Math.round(e.total ?? (e.tasks ? tareas.length : base.total)))
  const hecho = Math.min(total || Infinity, Math.max(0, Math.round(e.done ?? base.hecho)))
  const fase = FASES.includes(e.phase as Fase) ? (e.phase as Fase) : base.fase

  return {
    titulo: e.title?.trim() || base.titulo,
    total,
    hecho,
    fase: e.finished ? 'close' : fase,
    isTerminado: e.finished === true,
    tareas,
  }
}

function etiqueta(f: Flujo): string {
  if (f.isTerminado) return 'terminado'
  if (f.fase === 'plan') return 'planificando'
  if (f.fase === 'design') return 'diseñando'
  const cuenta = f.total ? `${f.hecho}/${f.total}` : ''

  return `${f.fase === 'review' ? 'revisando' : 'tareas'} ${cuenta}`.trim()
}

function progreso(f: Flujo): number {
  return f.isTerminado ? 1 : f.total ? f.hecho / f.total : 0
}

// --- Estado ------------------------------------------------------------------

async function cambiar($: EngineInterface, id: string, fn: (a: Agente) => Agente) {
  await update($, agentes, lista => lista.map(a => (a.id === id || a.agentId === id ? fn(a) : a)))
}

type Alta = Pick<Agente, 'id' | 'tipo' | 'descripcion' | 'rol' | 'modelo'> & Partial<Pick<Agente, 'agentId' | 'effort'>>

async function alta($: EngineInterface, a: Alta) {
  const nuevo: Agente = {
    ...a,
    titulo: titulo(a.descripcion),
    inicio: await $.clock.now(),
    isDone: false,
    pasos: 0,
    tokens: 0,
    costo: 0,
    ctx: 0,
    accion: 'Pensando',
  }
  await update($, agentes, lista => {
    const vivos = lista.filter(x => !x.isDone && x.id !== a.id)
    const listos = lista.filter(x => x.isDone && x.id !== a.id).slice(-12)

    return [...listos, ...vivos, nuevo]
  })
}

function avance(a: Agente): number {
  if (a.isDone) return 1
  if (a.pasoTotal) return Math.min(1, (a.pasoHecho ?? 0) / a.pasoTotal)

  return Math.min(0.92, 0.08 + a.pasos / 14)
}

const GUIA = `# Optimizer Model (mod activo)
Ahorrá tokens sin perder calidad:
- Delegá a un subagente (Agent) las tareas mecánicas o repetitivas: buscar, listar, renombrar, contar, transcribir, verificar archivos, inventarios. Optimizer Model les asigna Haiku o Sonnet solo; no pases \`model\` salvo que haga falta otro.
- Lo creativo y lo delicado (textos para el público, diseño, decisiones, depurar) lo hacés vos.
- Para leer o resumir textos largos (PDFs, informes, páginas, transcripciones) usá una herramienta de Gemini si está disponible (por ejemplo mcp__llms__ask_gemini) en vez de meter todo en tu contexto.
- Lo que ya hace una herramienta del proyecto (tests, builds, conversores, scripts) lo corre la herramienta, no el modelo.
- Para trabajos grandes de varios pasos, sugerí \`/optimizer-model:flujo <tarea>\`: planifica, reparte entre obreros por nivel (Haiku, Sonnet, Opus, Fable) y revisa.`

// Se abre solo la primera vez que hay algo que mostrar; después, con /optimizer.
let isPanelVisto = false

async function abrir($: EngineInterface) {
  isPanelVisto = true
  const t = await $.clock.now()
  await update($, ahora, () => t)
  await $.ui.open({ id: PANE, title: TITULO_PANEL })
}

export const register: Register = on => {
  const turnos: Record<string, string> = {}
  isPanelVisto = false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'optimizer',
      description: 'Optimizer Model: abrir el panel; "on" / "off" activa o pausa el ruteo de modelos; "cerrar" cierra el panel',
    })
    await $.tool.register({
      name: 'progreso',
      description:
        'Reporta el avance de /flujo a la barra sobre el prompt y al panel de Optimizer Model. ' +
        'Llamala al presentar el plan (title, total, tasks, phase "delegate"), cada vez que aceptás una tarea (done), ' +
        'al cambiar de fase o re-planificar (tasks), y una vez al final con finished: true. Lo que no pases conserva su valor. ' +
        'Solo para la sesión principal: los obreros reportan con `paso`.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nombre corto del trabajo, pocas palabras.' },
          total: { type: 'integer', minimum: 0, description: 'Cantidad de tareas de obreros planeadas.' },
          done: { type: 'integer', minimum: 0, description: 'Tareas aceptadas después de revisarlas.' },
          phase: { type: 'string', enum: [...FASES] },
          finished: { type: 'boolean', description: 'true cuando el flujo cerró.' },
          tasks: {
            type: 'array',
            description:
              'Las tareas planeadas en orden, numeradas desde 1. Cada title tiene que ser igual a la `description` con la que se delega en Agent, así el panel empareja corridas con tareas.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Pocas palabras; se reusa tal cual como description de Agent.' },
                tier: { type: 'string', enum: [...NIVELES] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Números de las tareas que espera.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'paso',
      description:
        'Para obreros de /flujo: reporta el avance de tu propia tarea al panel. Apenas leas el brief, llamala con `total` ' +
        '(tu plan en 3-8 pasos) y `done: 0`; volvé a llamarla al terminar cada paso. Barata y silenciosa: solo dibuja una barra.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Pasos terminados.' },
          total: { type: 'integer', minimum: 1, description: 'Pasos planeados; puede cambiar.' },
          note: { type: 'string', description: 'El paso en curso, pocas palabras.' },
        },
        required: ['done'],
      },
      isDeferred: false,
    })
    // Hace correr los relojes de las tarjetas mientras algo trabaja.
    $.clock.every(1000, () => {
      void (async () => {
        const lista = await read($, agentes)
        if (!lista.some(a => !a.isDone)) return
        const t = await $.clock.now()
        await update($, ahora, () => t)
      })()
    })

    return r
  })

  on('command.run', { command: 'optimizer' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isActivo, () => arg === 'on')

      return {
        text:
          arg === 'on'
            ? 'Optimizer Model activo: elige el modelo de cada subagente.'
            : 'Optimizer Model en pausa: los subagentes usan su modelo por defecto.',
      }
    }
    if (arg === 'cerrar') {
      await $.ui.close({ id: PANE })

      return { text: 'Panel de Optimizer Model cerrado.' }
    }
    await abrir($)

    return { text: 'Panel de Optimizer Model abierto.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, isActivo))) {
      return r
    }

    return { sections: [...r.sections, { id: 'optimizer-model:guia', text: GUIA, scope: 'session' as const }] }
  })

  // /flujo reporta el plan y el avance; solo vale desde la sesión principal.
  on('tool.call', { tool: 'mcp__optimizer-model__progreso' }, async ($, e) => {
    if (e.agentId) return { result: 'ignorado: solo la sesión principal reporta el flujo' }
    const entrada = e as unknown as EntradaProgreso
    const prev = await read($, flujo)
    if (isNuevo(prev, entrada) && entrada.title !== undefined) {
      await update($, agentes, lista => lista.filter(a => !a.isDone))
    }
    const f = await update($, flujo, p => fusionar(p, entrada))
    if (entrada.tasks?.length && !isPanelVisto) {
      await abrir($)
    }

    return { result: `ok: ${f ? etiqueta(f) : ''}` }
  })

  // El avance propio de un obrero: corre en su loop, así que agentId lo nombra.
  on('tool.call', { tool: 'mcp__optimizer-model__paso' }, async ($, e) => {
    const entrada = e as unknown as { done?: number; total?: number; note?: string }
    if (!e.agentId) return { result: 'ignorado: solo los obreros reportan pasos' }
    await cambiar($, e.agentId, a => {
      const total = Math.max(0, Math.round(entrada.total ?? a.pasoTotal ?? 0))
      const hecho = Math.max(0, Math.round(entrada.done ?? a.pasoHecho ?? 0))

      return {
        ...a,
        pasoTotal: total,
        pasoHecho: total ? Math.min(total, hecho) : hecho,
        accion: entrada.note?.trim() || a.accion,
      }
    })

    return { result: 'ok' }
  })

  // Cada turno del chat principal es una tarjeta, titulada con el pedido.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const id = `main:${e.turnId}`
      turnos[e.turnId] = id
      await alta($, { id, tipo: 'principal', descripcion: e.text, rol: 'principal', modelo: await $.session.model() })
    }

    return r
  })

  // Cada pedido al modelo: suma tokens y costo a la tarjeta que corresponde.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? turnos[e.turnId] ?? ''
    const r = yield* next(e)
    const u = (r as { usage?: ModelUsage }).usage
    if (id !== '' && u) {
      const entrada = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      await cambiar($, id, a => ({
        ...a,
        modelo: e.model,
        effort: typeof e.effort === 'string' ? e.effort : a.effort,
        tokens: a.tokens + entrada + u.output_tokens,
        costo: a.costo + costo(e.model, u),
        ctx: Math.round((entrada / 1_000_000) * 100),
      }))
    }

    return r
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? turnos[e.turnId] ?? ''
    if (id !== '') {
      const fin = await $.clock.now()
      await cambiar($, id, a => ({ ...a, isDone: true, fin, accion: 'Listo', pasoHecho: a.pasoTotal ?? a.pasoHecho }))
    }
    if (e.agentId === undefined) {
      delete turnos[e.turnId]
      const uso = await $.session.usage()
      await update($, costoSesion, () => uso.cost?.usd ?? 0)
      $.ui.status(undefined)
    }

    return next(e)
  })

  // Cada subagente: Optimizer Model elige su modelo si es genérico y nadie lo fijó.
  on('agent.spawn', async ($, e, next) => {
    const activo = await read($, isActivo)
    const nivel = nivelDe(e.subagentType)
    let eleccion: Eleccion = {
      modelo: e.model ?? 'inherit',
      rol: e.model ? 'a mano' : nivel || e.subagentType,
    }
    const ruteado = activo && !e.fork && e.model === undefined && RUTEABLES.has(e.subagentType)
    if (ruteado) {
      eleccion = elegir(e.subagentType, e.prompt)
    }
    if (e.fork) {
      eleccion = { modelo: 'inherit', rol: 'fork' }
    }
    const r = await next(eleccion.modelo === 'inherit' || e.fork ? e : { ...e, model: eleccion.modelo })
    if (r.deny !== undefined) {
      return r
    }
    const modelo = r.model || e.parentModel
    await alta($, {
      id: r.agentId ?? e.tool_use_id,
      agentId: r.agentId,
      tipo: e.subagentType,
      descripcion: e.description,
      rol: eleccion.rol,
      modelo,
      effort: nivel ? MODELO_NIVEL[nivel]?.[1] : undefined,
    })
    if (nivel) {
      await update($, flujo, prev => {
        const base = prev && !prev.isTerminado ? prev : vacio()

        return { ...base, fase: base.fase === 'plan' ? 'delegate' : base.fase }
      })
    }
    if (ruteado && eleccion.modelo !== 'inherit') {
      $.ui.toast(`🧭 ${e.description} → ${nombre(modelo)} (${eleccion.rol})`)
    }
    if (!isPanelVisto) {
      await abrir($)
    }

    return r
  })

  // Herramientas: Gemini, Whisper, TTS, HyperFrames, FFmpeg...
  on('tool.call', async ($, e, next) => {
    const que = herramienta(String(e.tool), e as unknown as Record<string, unknown>)
    const id = e.agentId ?? Object.values(turnos).at(-1) ?? ''
    if (que === '' || id === '') {
      return next(e)
    }
    await cambiar($, id, a => ({ ...a, pasos: a.pasos + 1, accion: a.pasoTotal ? a.accion : que }))
    if (e.agentId === undefined) {
      $.ui.status(`🧭 ${que}`)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flujo)
    if (f === null || e.props.hasSurvey) return next(e)
    const dibujado = await Promise.resolve(next(e)).catch(() => null)
    const debajo = dibujado && typeof dibujado === 'object' && (dibujado as { type?: string }).type !== 'engine' ? dibujado : null
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const lista = await read($, agentes)
    const cuantos = lista.filter(a => !a.isDone).length
    const botones = [
      <Button key="os6-panel" label={`×${cuantos}`} plain onPress={() => void abrir($)} />,
      <Button key="os6-cerrar" label="✕" plain role="dismiss" onPress={() => update($, flujo, () => null)} />,
    ]

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const ancho = Math.max(200, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={banda(f, ancho)} alt={`${f.titulo}: ${etiqueta(f)}`} width={ancho} height={22} />
            {botones}
          </Box>
          {debajo}
        </Box>
      )
    }

    const ancho = Math.max(6, Math.min(40, e.props.bodyColumns - 50))
    const llenos = Math.round(progreso(f) * ancho)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={f.isTerminado ? VERDE : NARANJA} wrap="truncate-end">
            ● {f.titulo}
          </Text>
          <Text color={f.isTerminado ? VERDE : NARANJA}>{'█'.repeat(llenos) + '░'.repeat(ancho - llenos)}</Text>
          <Text bold>{etiqueta(f)}</Text>
          {botones}
        </Box>
        {debajo}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [lista, f, total, activo, t] = await Promise.all([
      read($, agentes),
      read($, flujo),
      read($, costoSesion),
      read($, isActivo),
      read($, ahora),
    ])
    const reloj = Math.max(t, ...lista.map(a => a.fin ?? a.inicio))
    const vivos = lista.filter(a => !a.isDone)
    const listos = lista.filter(a => a.isDone).reverse()
    const vistos = new Set(lista.map(a => norma(a.descripcion)))
    const planeadas = (f && !f.isTerminado ? f.tareas : [])
      .map((p, i) => ({ ...p, n: i + 1 }))
      .filter(p => !vistos.has(norma(p.titulo)))

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const fila = (a: Agente) => (
        <Text dimColor={a.isDone}>
          {a.isDone ? '✓' : '●'} {a.titulo} <Text color={COLOR[familia(a.modelo)]}>{nombre(a.modelo)}</Text> · {a.accion} · {miles(a.tokens)} ≈${a.costo.toFixed(2)}
        </Text>
      )

      return (
        <Box flexDirection="column">
          {vivos.map(fila)}
          {listos.length > 0 && <Text bold>Terminados · {listos.length}</Text>}
          {listos.map(fila)}
          {planeadas.length > 0 && <Text bold>En espera · {planeadas.length}</Text>}
          {planeadas.map(p => (
            <Text dimColor>
              ○ {p.n}. {p.titulo} · {p.nivel}
            </Text>
          ))}
          <Text dimColor>
            Sesión ≈${total.toFixed(2)} · ruteo {activo ? 'activo' : 'en pausa'}
          </Text>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const tarjeta = (a: Agente) => {
      const color = COLOR[familia(a.modelo)]
      const paso = a.pasoTotal ? `${a.pasoHecho ?? 0}/${a.pasoTotal}` : String(a.pasos)

      return (
        <Box key={a.id} flexDirection="row" gap={1} paddingY={1}>
          <Svg source={muneco(a.modelo)} alt={`Claude con ${nombre(a.modelo)}`} width={36} height={32} />
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold" wrap="truncate-end">
                {a.titulo}
              </Text>
              <Text color={a.isDone ? VERDE : color}>{a.isDone ? '✓' : '●'}</Text>
            </Box>
            <Text size="footnote">
              <Text color={color}>{a.rol}</Text>{' '}
              <Text dimColor>
                {nombre(a.modelo)}
                {a.effort ? ` · ${a.effort}` : ''}
              </Text>
            </Text>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text size="footnote" weight="medium" wrap="truncate-end">
                {paso} · {a.accion}
              </Text>
              <Text size="footnote" dimColor tabular>
                ctx {a.ctx}% · {miles(a.tokens)} ≈${a.costo.toFixed(2)} {duracion((a.fin ?? reloj) - a.inicio)}
              </Text>
            </Box>
            <Svg source={barra(avance(a), color)} alt={a.isDone ? 'terminado' : 'en curso'} height={5} />
          </Box>
        </Box>
      )
    }
    const espera = (p: TareaPlan & { n: number }) => {
      const [modelo, effort] = MODELO_NIVEL[p.nivel] ?? ['', '']

      return (
        <Box key={`plan-${p.n}`} flexDirection="row" gap={1} paddingY={1}>
          <Svg source={muneco(modelo, true)} alt={`En espera: ${p.titulo}`} width={36} height={32} />
          <Box flexDirection="column" flexGrow={1}>
            <Text weight="semibold" dimColor wrap="truncate-end">
              {p.n}. {p.titulo}
            </Text>
            <Text size="footnote" dimColor>
              <Text color={COLOR[familia(modelo)]}>{p.nivel || 'obrero'}</Text> {modelo ? `${nombre(modelo)} · ${effort}` : ''}
              {p.despues.length ? ` · después de ${p.despues.join(', ')}` : ''}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {vivos.length === 0 && listos.length === 0 && planeadas.length === 0 && (
          <Text dimColor>Todavía no hay agentes en esta sesión.</Text>
        )}
        {vivos.map(tarjeta)}
        {listos.length > 0 && (
          <Text weight="semibold" dimColor>
            ▾ Terminados · {listos.length}
          </Text>
        )}
        {listos.map(tarjeta)}
        {planeadas.length > 0 && (
          <Text weight="semibold" dimColor>
            En espera · {planeadas.length}
          </Text>
        )}
        {planeadas.map(espera)}
        <Box flexDirection="row" justifyContent="space-between" paddingY={1}>
          <Text size="footnote" dimColor>
            Sesión ≈${total.toFixed(2)} · ruteo {activo ? 'activo' : 'en pausa'}
          </Text>
          <Button key="toggle" label={activo ? 'Pausar ruteo' : 'Activar ruteo'} onPress={() => update($, isActivo, v => !v)} />
        </Box>
      </Box>
    )
  })
}
