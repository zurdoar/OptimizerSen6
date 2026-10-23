# OptimizerSen6

Un mod para [Claude Code](https://claude.com/claude-code) que **ahorra tokens sin bajar la calidad** y te muestra en todo momento **qué modelo y qué herramienta están trabajando**.

## Qué hace

**1. Elige el modelo justo para cada subagente.** Las tareas mecánicas (buscar, listar, renombrar, transcribir, inventarios) van a **Haiku**, las generales a **Sonnet**, y lo creativo o delicado (guiones, diseño, depurar) se queda en el modelo principal. Lo decide con reglas fijas, sin gastar tokens en decidir. Nunca toca un agente que ya trae su propio modelo.

**2. `/optimizersen6:flujo <tarea>`: planifica, reparte y revisa.** El modelo principal arma el plan, reparte el trabajo entre obreros por nivel y revisa todo lo que entregan antes de aceptarlo:

| Nivel | Modelo | Para qué |
| --- | --- | --- |
| ligero | Haiku 5.5 | mecánico y repetitivo, correr scripts, resumir lecturas largas vía Gemini |
| medio | Sonnet 5.5 · medium | trabajo estándar, textos, auditorías |
| cuidadoso | Opus 5.5 · high | lo delicado que no puede romper nada |
| pesado | Opus 5.5 · xhigh | entender código difícil, depurar la causa raíz |
| fable | Fable 5.1 · high | solo lo más difícil |

**3. Un panel con muñecos Claude.** Cada agente tiene su tarjeta, con un Claude en pixel art que lleva el sombrero de su modelo (casco para Opus, gorro marinero para Sonnet, gorra para Haiku, mago para Fable). La tarjeta muestra el rol, el modelo y el esfuerzo, lo que está haciendo en ese momento (Whisper, Gemini, FFmpeg, HyperFrames, terminal…), el contexto, los tokens, el costo estimado, el tiempo y una barra de avance. Las tareas se agrupan en curso, terminadas y en espera. Mientras corre `/flujo`, arriba de la caja de texto aparece una barra con el avance del plan.

**4. Aprovecha Gemini y las herramientas locales.** Si tenés una herramienta de Gemini conectada (por ejemplo un MCP con `ask_gemini`), las lecturas largas se resumen ahí. La voz, la transcripción y el render se hacen con los scripts del proyecto, no con el modelo.

## Instalar

En Claude Code, en la terminal:

```
/plugin install optimizersen6 --marketplace zurdoar/OptimizerSen6
```

Respondé `y` para agregar el marketplace y elegí el alcance **user**, así se activa en todos los chats.

Desde una consola:

```bash
claude plugin install optimizersen6 --marketplace zurdoar/OptimizerSen6
```

En la app de escritorio, donde `/plugin` no está disponible: tocá **+** al lado de la caja de texto → **Plugins** → **Add marketplace** con `zurdoar/OptimizerSen6` → **Add plugin**.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/optimizersen6:flujo <tarea>` | planifica, reparte entre obreros y revisa |
| `/optimizer` | abre el panel |
| `/optimizer off` · `/optimizer on` | pausa o reactiva el ruteo de modelos |
| `/optimizer cerrar` | cierra el panel |

El panel se abre solo la primera vez que arranca un subagente o un plan de `/flujo`.

## Notas

- El costo de cada tarjeta es una **estimación** hecha con los tokens y los precios públicos de cada modelo. El total de la sesión es el que lleva Claude Code.
- La conversación principal no cambia de modelo: hacerlo a mitad de una charla rompe la caché y termina costando más. El ahorro está en los subagentes.
- En la terminal el panel se ve en texto, sin muñecos.

## Créditos

La habilidad `/flujo` y los obreros están adaptados de [savvy-flow](https://github.com/johnnyvizz/claude-kit) de johnnyvizz (MIT), con los niveles reasignados a modelos más baratos donde alcanza. Licencia MIT; ver [LICENSE](LICENSE).
