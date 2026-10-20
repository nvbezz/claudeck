# Instalación de Claudeck

## Requisitos

- Claude Code reciente (probado en la 2.1.304).
- Linux o macOS. En Windows, usa WSL.
- `git` en el PATH (el panel lo usa para la sección Git).
- Opcional: una fuente Nerd Font para los iconos. Si no la tienes, ver "Sin iconos".

## 1. Descargar

```bash
git clone https://github.com/nvbezz/claudeck.git ~/claudeck
```

## 2. Cargarlo en Claude Code

Elige **una** de estas formas.

### A. Para probarlo una vez

```bash
claude --plugin-dir ~/claudeck
```

### B. Siempre activo (recomendado)

Añade esto a `~/.claude/settings.json`. Si ya tienes un bloque `env`, agrega solo la línea de dentro:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claudeck"
  }
}
```

Es la forma en que se usó durante el desarrollo. Reinicia Claude Code.

### C. Como skill-dir

```bash
git clone https://github.com/nvbezz/claudeck.git ~/.claude/skills/claudeck
```

Según la ayuda de `claude plugin init`, los plugins en `~/.claude/skills/<nombre>/` se cargan solos en la siguiente sesión. Esta vía no se ha probado con Claudeck.

## 3. Comprobar que funciona

1. Abre Claude Code. El panel aparece acoplado al lado. Si no, escribe `/panel`.
2. Escribe `/archivos` para abrir el explorador.
3. Verifica que el plugin se ve: `claude plugin list`.

## 4. Habilitar las tareas para todos tus modelos

Haz esto aunque todo parezca funcionar. Por defecto, Claude Code solo da las herramientas de tareas a algunos modelos, y con el resto la sección **Tareas** del panel queda vacía. Dile a tu agente: *"habilita las herramientas de tareas para todos los modelos"*, o añade tú mismo a `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"
  }
}
```

Reinicia Claude Code después.

## 5. Configurar (opcional)

```bash
claude plugin configure claudeck                      # muestra las opciones y cuáles faltan
echo '{"width":"52"}' | claude plugin configure claudeck --values-stdin   # guarda valores
```

Las opciones están en el [README](README.md#configuración).

## 6. Barra de estado inferior (opcional)

Claudeck trae también una status line para la parte baja de la terminal. Solo Linux; necesita `jq` y `bash` 4.2 o superior (`bash --version`).

1. Instala `jq` si no lo tienes (`sudo dnf install jq`, `sudo apt install jq`…).
2. Añade esto a `~/.claude/settings.json`, junto a lo que ya tengas:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/claudeck/statusline/claudeck-statusline.sh",
    "refreshInterval": 5
  }
}
```

3. Reinicia Claude Code.

La fila de agentes de esa barra se alimenta de los archivos que escribe el panel, así que necesitas Claudeck cargado (paso 2). Para comprobar el script por separado: `bash ~/claudeck/statusline/test.sh`.

Si ya tenías una status line propia, esto la sustituye. Si algo falla, quita la clave `statusLine` y vuelve a la anterior.

## Sin iconos

Si ves cuadros o símbolos raros, tu terminal no tiene Nerd Font. Pon `isIcons` en `false` (ver paso 5), o instala una fuente desde <https://www.nerdfonts.com>.

## Sonido y notificaciones

- **Linux:** instala `pipewire` (`pw-play`) o `pulseaudio-utils` (`paplay`) para el sonido, y `libnotify` (`notify-send`) para las notificaciones.
- **macOS:** funciona con lo que trae el sistema. Si no suena, revisa que Terminal tenga permiso de notificaciones.
- Para silenciarlo todo: `isSound` y `isDesktop` en `false` (ver paso 5).

## Problemas frecuentes

| Síntoma | Qué probar |
|---|---|
| El panel no aparece, o se oculta solo | la terminal es demasiado estrecha: el motor solo dibuja un panel que se abre solo desde unas 144 columnas (unas 110 si lo abres tú con `/panel`). Ensancha la ventana, baja el zoom de la fuente o escribe `/panel`; al ensancharla vuelve sin hacer nada. Si no, reinicia Claude Code y mira `claude plugin list` |
| `claude plugin validate ~/claudeck` falla | actualiza Claude Code: el panel usa API de mods recientes |
| La sección MCP dice "consultando…" mucho rato | normal si algún servidor tarda en responder; se reintenta cada `mcpSeconds` |
| La sección Tareas siempre dice "sin plan aún" | habilita las herramientas de tareas para todos los modelos (paso 4) |
| La sección Git dice "sin repositorio" | no estás dentro de un repo; ejecuta `git init` |
| La barra inferior dice "jq is required" | instala `jq` (paso 6) |
| La barra inferior no muestra cpu ni ram | solo funciona en Linux, porque lee `/proc` |
| No hay sonido ni notificación | revisa los paquetes de la sección anterior |

## Desinstalar

Quita la línea `CLAUDE_CODE_PLUGIN_DIRS` de `settings.json` (o el directorio de skills) y borra `~/claudeck`. Los archivos temporales de `~/.claude/state/` se limpian solos.

## Si no te funciona

Pídele a tu agente de Claude Code que lea [AGENT_GUIDE.md](AGENT_GUIDE.md): describe qué hace cada parte y cómo reconstruir el panel desde cero adaptado a tu sistema.
