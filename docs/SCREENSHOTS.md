# Cómo tomar las capturas del README

Las capturas se guardan en esta carpeta (`docs/`) como PNG. Recorta solo la zona del panel, sin el resto de la terminal.

## Preparación

Usa una carpeta de prueba para no mostrar proyectos propios:

```bash
mkdir -p ~/demo-claudeck && cd ~/demo-claudeck && git init -q
printf '# Demo\n' > README.md && printf 'console.log("hola")\n' > app.js
claude --plugin-dir ~/claudeck
```

- No cargues Claudeck dos veces a la vez (por ejemplo, con `CLAUDE_CODE_PLUGIN_DIRS` y `--plugin-dir`): se duplicarían los paneles y los comandos.
- Terminal grande, tema oscuro y fuente legible (con Nerd Font).
- Antes de capturar, revisa que no se vea tu correo, rutas con tu usuario ni nombres de proyectos privados. El panel muestra la carpeta y los mensajes de commit.
- Para ver la sección Tareas necesitas `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (ver [INSTALL.md](../INSTALL.md#4-habilitar-las-tareas-para-todos-tus-modelos)).

## Capturas ya incluidas

`01-vacio.png`, `02-trabajando.png`, `03-completado.png`, `04-explorador.png` y `05-vista-previa.png` están recortadas a la zona del panel y enlazadas en el README. Falta, si se quiere añadir, el selector de modelo o esfuerzo desplegado. Para el explorador, usa **siempre** la carpeta de prueba: el árbol muestra los nombres de tus carpetas y archivos personales.

Un recorte con ImageMagick, quitando metadatos:

```bash
magick captura.png -crop 470x762+1449+55 +repage -strip docs/01-vacio.png
```

## Lista completa de capturas

| Archivo | Qué se ve | Cómo conseguirla |
|---|---|---|
| `01-vacio.png` | Panel en reposo: "el equipo duerme", "sin plan aún", "nada tocado todavía" | Sesión recién abierta, sin escribir nada |
| `02-sin-repo.png` | Sección Git con el dibujo "sin repositorio" | Sesión abierta en una carpeta sin `git init` |
| `03-trabajando.png` | Tareas, agentes activos, archivos modificados, git y línea de tests | Pega el prompt de abajo y captura mientras los agentes corren (20 a 40 s) |
| `04-modelo-esfuerzo.png` | Selector de modelo o de esfuerzo desplegado | Con el panel visible, clic en el modelo o en el esfuerzo |
| `05-explorador.png` | Pestaña Archivos con vista previa de código | `/archivos`, entra a una carpeta, clic en `app.js` y pulsa `ver` |
| `06-alerta.png` (opcional) | Aviso al terminar un turno largo | Baja `notifyMinSeconds` a `5` y deja que termine un turno |

## Prompt para `03-trabajando.png`

```
Haz una lista de tareas con 4 pasos: crear index.html, crear estilo.css, revisar el resultado y escribir un resumen. Ve marcándolas mientras avanzas. Lanza 2 agentes en segundo plano con modelo haiku que ejecuten cada uno una sola vez: for i in $(seq 1 40); do echo $i; sleep 1; done. Mientras corren, crea index.html y estilo.css con una página sencilla de bienvenida y edita cada uno una vez. Al final ejecuta npx tsc --version.
```

Captura antes de que pasen los 40 s: después los agentes pasan a "listo".
