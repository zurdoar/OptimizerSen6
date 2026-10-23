export type Agente = {
  id: string
  agentId?: string
  tipo: string
  descripcion: string
  titulo: string
  rol: string
  modelo: string
  effort?: string
  isDone: boolean
  pasos: number
  accion: string
  pasoTotal?: number
  pasoHecho?: number
  tokens: number
  costo: number
  ctx: number
  inicio: number
  fin?: number
}

export type TareaPlan = { titulo: string; nivel: string; despues: number[] }

export type Fase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type Flujo = {
  titulo: string
  total: number
  hecho: number
  fase: Fase
  isTerminado: boolean
  tareas: TareaPlan[]
}

declare module 'claude-code' {
  interface PluginState {
    'optimizer-model': {
      agentes: Agente[]
      flujo: Flujo | null
      ahora: number
      costoSesion: number
      isActivo: boolean
    }
  }
}
