# Guía para agentes: construir Claudeck desde cero

Este documento es para **tu agente de Claude Code**. Si Claudeck no te funciona tal cual en tu sistema, pásale este archivo y pídele que lo reconstruya o lo adapte. Describe qué hace cada pieza, de dónde sale cada dato, qué trampas encontramos y cómo comprobar que todo funciona.

> Instrucción para el agente: lee primero las secciones 0 y 1. Antes de escribir código, lee los tipos del motor en `.claude-plugin/types/claude-code/index.d.ts` (o los que genere tu Claude Code): son la fuente de verdad de la API de mods. No asumas nombres de hooks ni formas de eventos.

## 0. Prerrequisito: habilitar las tareas para todos los modelos

**Haz esto antes de nada.** Claude Code solo da las herramientas de tareas (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `TodoWrite`) por defecto a algunos modelos (Opus 4.7, Sonnet 4.6, Haiku 4.5 y anteriores). Con modelos más nuevos no existen, y entonces:

- no puedes llevar una lista de tareas mientras trabajas,
- la sección Tareas del panel nunca se llena.

Habilítalas para todos los modelos añadiendo esto al bloque `env` de `~/.claude/settings.json` (fusiona con lo que ya haya, no lo sobrescribas) y **reinicia Claude Code**:

```json
"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"
```

Requiere Claude Code 2.1.233 o posterior. Esto nos pasó a nosotros: el modelo era `sonnet` (Sonnet 5.5), no estaba en la lista, y solo apareció `TaskStop`. Con la variable, las cuatro herramientas de tareas aparecieron incluso sin reiniciar. `CLAUDE_CODE_ENABLE_TASKS=0` cambia las `Task*` por `TodoWrite`; el panel entiende ambas.

## 1. Qué es y cómo se carga

Claudeck es un **mod** de Claude Code: un plugin con un módulo de hooks (`hooks/register.tsx`) que:

1. registra comandos de barra,
2. abre paneles acoplados (`$.ui.open`) y los dibuja (`ui.render`),
3. escucha eventos del motor (turnos, herramientas, agentes, sesión) para mantener un estado,
4. consulta datos de la sesión, git y el sistema por procesos.

Estructura:

```
.claude-plugin/plugin.json   manifiesto: name, version, author, license, userConfig (opciones)
hooks/hooks.json             { "modules": ["./register.tsx"] }
hooks/register.tsx           punto de entrada: registra todos los hooks
hooks/state.ts               estado inicial (INITIAL)
types/index.d.ts             tipos del estado (Panel) y declaración del átomo
hooks/*.ts(x)                una responsabilidad por archivo (ver sección 4)
```

El estado vive en un **átomo** con clave `{ plugin: 'claudeck', key: 'panel' }`. El nombre del plugin en el átomo **debe coincidir con `name` del manifiesto** y estar declarado en `types/index.d.ts` (`'claudeck': { panel: Panel }`). Si renombras el plugin, cámbialo en los tres sitios.

Cómo cargarlo para probar: `claude --plugin-dir <ruta>` o `CLAUDE_CODE_PLUGIN_DIRS` en `settings.json`.

## 2. Qué debe mostrar (especificación)

Dos paneles acoplados, ambos con el ancho configurable:

**Panel principal** (siete tarjetas plegables; el plegado se recuerda entre sesiones):

1. **Sesión:** carpeta del proyecto, indicador trabajando/listo con spinner, modelo y esfuerzo (botones que despliegan una lista; al elegir ejecutan `/model <id>` y `/effort <nivel>` vía `$.command.run`), barra de contexto con degradado, ritmo en $/hora, proyección de cuándo se llena el límite de 5 h, mini-gráfica de coste por turno, recuento de herramientas usadas y cuántas corren en paralelo.
2. **Agentes:** subagentes de `$.agent.list()`, activos primero, con duración; terminados como listo/detenido/falló. Sin agentes, un dibujo de reposo.
3. **Tareas:** lista de tareas con barra de avance; en curso primero, luego pendientes, luego completadas (tachadas). Máximo 4 filas visibles.
4. **Archivos modificados:** por archivo, líneas añadidas y quitadas, con barra proporcional.
5. **Git:** rama, upstream, ahead/behind, staged/sin stagear/sin seguimiento, 3 cambios y 4 commits recientes. Sin repo, un dibujo con "git init".
6. **MCP y tests:** estado de cada servidor MCP y resultado del último `test/build/lint` ejecutado.
7. **Skills y plugins:** skills por origen y plugins activos.

**Panel Archivos:** explorador con migas de pan, botones subir/bajar/inicio/ocultos/refrescar, búsqueda, árbol con icono por extensión y marca de estado git (M, A, U, D, R, ● para carpetas con cambios), vista previa de código con scroll en ambos ejes, y botones abrir / ver / `@ mencionar` (rellena el prompt con `@ruta`).

**Comandos:** `/panel`, `/archivos`, `/buscar <texto>`, `/panel-ancho <30-120>`, `/gasto`.

**Alertas** (toast + sonido + notificación de escritorio): turno largo terminado (`e.reason === 'answer'` y duración mínima), contexto ≥ `ctxCrit`, límite 5 h ≥ `limitWarn`, servidor MCP que pasa de conectado a caído. Cada alerta tiene histéresis de 5 puntos para no repetirse.

**Opciones** (`userConfig` del manifiesto): `width`, `ctxWarn`, `ctxCrit`, `limitWarn`, `isSound`, `isDesktop`, `notifyMinSeconds`, `mcpSeconds`, `isIcons`, `bgColor`. Valida todo: llegan como string o number; usa valores por defecto si son basura.

## 3. De dónde sale cada dato

| Dato | Fuente |
|---|---|
| modelo, turnos, cwd, id de sesión | `$.session.model()`, `.turns()`, `.cwd()`, `.id()` |
| contexto, coste, límites de 5 h y semanal | `$.session.usage()` (`context.percent/tokens/window`, `cost.usd`, `rateLimits[]`) |
| herramientas, tareas, archivos tocados | hook `tool.call`: se mide antes y después de `next(e)` |
| líneas añadidas/quitadas | `Edit`: diff de `old_string`/`new_string`. `Write`: lee el archivo antes con `$.fs.read` y compara como multiconjunto de líneas |
| tareas | `TodoWrite` (reemplaza la lista); `TaskCreate`/`TaskUpdate` (altas, cambios y borrados). El id sale del resultado de `TaskCreate` |
| tests | regex sobre el comando de `Bash` (`npm test`, `pytest`, `cargo test`, `tsc`, `make`…) y su resultado |
| esfuerzo del turno | evento `tool.call`/`turn.step` (`effort`); respaldo: `effortLevel` de `settings.json` |
| agentes | `$.agent.list()` cada 3 s y tras cada `tool.call` o `agent.spawn` de un agente |
| git | `git rev-parse`, `status --porcelain`, `log`, `rev-list --left-right --count @{u}...HEAD`, `diff HEAD --numstat` |
| MCP | `claude mcp list` (cada `mcpSeconds`), parseando "Connected"/"Failed" |
| skills y plugins | `$.session.usage({ breakdown: 'summary' })` y `claude plugin list` |
| historial de gasto | `$.store` (clave `cost-days`): por día, el total acumulado de cada sesión; guarda 45 días |

Ejecuta procesos solo con `$.process.run([argv...], { timeoutMs })`, **siempre con argumentos separados**. Nunca montes un script concatenando texto del usuario (rutas, búsquedas, títulos).

## 4. Responsabilidades por archivo

| Archivo | Responsabilidad |
|---|---|
| `register.tsx` | registra comandos y hooks; polling adaptativo (más lento si la sesión está ociosa) |
| `data.ts` | abrir paneles, refrescar sesión, git, MCP y skills |
| `view.tsx` / `filesView.tsx` | dibujado de cada panel |
| `explorer.ts` | árbol, búsqueda, vista previa, scroll |
| `agents.ts` | estado de agentes y archivo para la status line |
| `controls.ts` | cambiar modelo y esfuerzo |
| `history.ts` | gasto por día sin contar dos veces una sesión que cruza la medianoche |
| `alerts.ts` | alertas con histéresis |
| `platform.ts` | **todo lo dependiente del sistema operativo** (sonido, notificación, abrir archivo) |
| `housekeeping.ts` | limpieza de archivos de estado |
| `ui.ts` | plegado de secciones y su persistencia |
| `format.ts`, `icons.ts`, `config.ts`, `state.ts` | utilidades puras, iconos, opciones, estado inicial |

Mantén la lógica pura (formato, cálculos, parseo) separada de la que toca el motor: así se prueba sin motor.

## 5. Portabilidad: lo que debes adaptar a tu sistema

Todo lo dependiente del sistema está en `platform.ts` y devuelve `undefined` si no hay soporte, para fallar en silencio.

| Función | Linux | macOS | Otro |
|---|---|---|---|
| sonido | `pw-play`, si no `paplay`, con sonidos de `/usr/share/sounds/freedesktop/stereo` | `afplay /System/Library/Sounds/*.aiff` | nada |
| notificación | `notify-send` | `osascript` con `argv` (no interpola texto) | nada |
| abrir archivo | `xdg-open` en segundo plano | `open` | nada |

El SO se detecta una vez con `uname -s`. Si tu sistema es otro, añade un caso en `parseOs` y en las tres funciones, y un test. Las marcas de estado usan `sh`, `mkdir`, `find` y `rm`: en Windows nativo hay que sustituirlas por `$.fs` o usar WSL.

## 6. Integración opcional con la status line

El panel escribe dos tipos de archivo en `~/.claude/state/` por si quieres leerlos desde tu propia status line:

- `working-<sessionId>`: una línea `start <epoch>` mientras hay un turno en marcha, `done <epoch>` al acabar. Se actualiza (`touch`) con cada herramienta.
- `agents-<sessionId>.tsv`: una fila por agente activo, columnas separadas por tabulador: `tipo`, `descripción`, `actividad actual`, `epoch de inicio`. Una status line debe tratar un archivo con más de 30 s como "sin agentes".

Se borran al cerrar la sesión; los de más de 24 h se purgan al arrancar otra (por si hubo un cierre brusco). Valida el id de sesión (`^[A-Za-z0-9_-]{1,64}$`) antes de usarlo en un `rm`.

## 7. Trampas que ya nos mordieron

1. **Escrituras de estado dentro de un reductor.** Un reductor de `update` puede ejecutarse más de una vez; hacer `$.store.set` dentro duplica la escritura. Actualiza y luego lee y guarda.
2. **Botones sin `key`.** El motor rechaza un dibujo con un botón sin `key` ("key: expected string"). Pon `key` en cada `Button` y en elementos de listas.
3. **`on('turn.step')` es un generador:** `async function* ($, e, next)` y `return yield* next(e)`.
4. **Un hook por nombre.** En tests, registrar dos veces el mismo hook falla. Haz un `stub` con respuestas por defecto que acepte sobrescrituras.
5. **Tareas en segundo plano al terminar un test.** Las actualizaciones lanzadas con `void` siguen vivas cuando el test acaba y provocan "a rejection nothing handled". Espera unos 150 ms al final de cada test de integración.
6. **Git sin commits.** `git rev-parse --abbrev-ref HEAD` falla; usa `git symbolic-ref --short -q HEAD` como respaldo.
7. **Rutas con puntos.** Saca la extensión del **nombre** del archivo, no de la ruta completa (`/a/mi.proj/Makefile` no tiene extensión).
8. **Un nivel de esfuerzo desconocido** no debe verse como el más bajo. Muéstralo con su nombre y sin puntos encendidos.
9. **Nunca interpoles texto en scripts de shell.** Pasa los valores como argumentos (`sh -c '...' sh "$valor"` y úsalos como `"$1"`).
10. **Sondeo de procesos.** `claude mcp list` y `claude plugin list` son pesados: espacia las consultas y no las lances solapadas.

## 8. Cómo comprobar que funciona

```bash
claude plugin validate .               # manifiesto, hooks y tipos
claude plugin test .                   # tests (usan 'claude-code/testing')
npx -p typescript tsc --noEmit -p .    # tipos estrictos (noUncheckedIndexedAccess activado)
```

Los tests deben cubrir como mínimo:

- **Puros:** formato de duración, `clip`, `spark`, `until`, proyección del límite, diff de líneas, nombre de modelo, nivel de esfuerzo conocido/desconocido, historial de gasto en medianoche, validación de opciones, árbol visible (ocultos, ignorados, límite de filas), comandos por sistema operativo, validación del id de sesión.
- **Con el motor:** el panel vacío dibuja sus marcadores; una llamada a herramienta aparece en "acciones"; el plegado se guarda una sola vez y sobrevive al reinicio; git sin commits muestra la rama; la limpieza de archivos de estado se ejecuta al iniciar y al cerrar; un comando eliminado ya no se registra.

Comprobación manual: abre el panel, lanza una tarea con `TaskCreate`, lanza un subagente en segundo plano y verifica que aparecen en Tareas y Agentes; ejecuta `/archivos` y abre una vista previa.

## 9. Orden de construcción recomendado

1. Habilita las tareas (sección 0) y reinicia.
2. Scaffold del plugin (`claude plugin init <nombre>`) y manifiesto con `author` y `license`.
3. Estado inicial, tipos y átomo.
4. Funciones puras con sus tests.
5. Panel principal con la tarjeta Sesión; luego el resto de tarjetas de una en una, comprobando cada una.
6. Hook `tool.call` (herramientas, tareas, archivos, tests).
7. Agentes, git, MCP y skills.
8. Explorador.
9. Alertas y `platform.ts`.
10. Limpieza de archivos de estado, validación, tests y typecheck.

No des nada por terminado sin haber ejecutado la sección 8 y haber visto la salida.
