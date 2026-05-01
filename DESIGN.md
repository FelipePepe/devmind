# DevMind Design System

> Exportado en formato Google Stitch · Paleta Claude Design · Componentes Material Design 3 (Firebase)  
> Este archivo es la **fuente de verdad** para todos los agentes de codificación. Seguir al pie de la letra.

---

## BRAND INTENT

DevMind es una suite de programación local con IA. La estética mezcla tres fuentes:

- **Google Stitch** — estructura de tokens, formato de exportación, escala de espaciado
- **Claude Design** — paleta de color (warm dark, coral accent), tipografía, tono minimalista
- **Material Design 3** — sistema de elevación, estados de componentes, naming de roles

La interfaz es **IDE-first**: oscura por defecto, información densa, sin decoración innecesaria.  
Prioridad: legibilidad del código y claridad del flujo de agente.

---

## COLOR TOKENS

### Paleta base (Claude warm dark)

```css
:root {
  /* === BACKGROUNDS === */
  --bg-app:          #1C1A19;   /* fondo raíz — warm near-black */
  --bg-sidebar:      #211F1D;   /* panel lateral */
  --bg-surface:      #2A2826;   /* tarjetas, paneles flotantes */
  --bg-surface-2:    #333130;   /* nivel superior de elevación */
  --bg-input:        #252321;   /* inputs, code blocks */
  --bg-overlay:      rgba(0,0,0,0.6); /* modales */

  /* === TEXT === */
  --text-primary:    #EEEBE6;   /* cuerpo principal — warm white */
  --text-secondary:  #9B9791;   /* labels, metadata */
  --text-tertiary:   #6B6762;   /* disabled, placeholders */
  --text-inverse:    #1C1A19;   /* texto sobre fondos claros */
  --text-code:       #E8D5B7;   /* código inline */

  /* === ACCENT — Claude coral/terracotta === */
  --accent:          #D97757;   /* primary CTA, links activos */
  --accent-hover:    #E8895F;   /* estado hover */
  --accent-muted:    rgba(217, 119, 87, 0.15); /* fondos de badge, highlights */
  --accent-on:       #FFFFFF;   /* texto sobre accent */

  /* === SEMANTIC — Material Design 3 roles === */
  --color-success:   #65C25B;
  --color-success-bg: rgba(101, 194, 91, 0.12);
  --color-warning:   #E5A638;
  --color-warning-bg: rgba(229, 166, 56, 0.12);
  --color-error:     #E3534E;
  --color-error-bg:  rgba(227, 83, 78, 0.12);
  --color-info:      #5B9FE5;
  --color-info-bg:   rgba(91, 159, 229, 0.12);

  /* === BORDERS === */
  --border-subtle:   rgba(255,255,255,0.07);
  --border-default:  rgba(255,255,255,0.12);
  --border-strong:   rgba(255,255,255,0.22);
  --border-accent:   var(--accent);

  /* === STITCH SEMANTIC ALIASES (Google Stitch compat) === */
  --color-primary:              var(--accent);
  --color-on-primary:           var(--accent-on);
  --color-primary-container:    var(--accent-muted);
  --color-background:           var(--bg-app);
  --color-surface:              var(--bg-surface);
  --color-surface-variant:      var(--bg-surface-2);
  --color-on-background:        var(--text-primary);
  --color-on-surface:           var(--text-primary);
  --color-outline:              var(--border-default);
  --color-outline-variant:      var(--border-subtle);
}
```

### Escala completa de color (Claude Brand)

```css
:root {
  /* Coral scale */
  --coral-50:  #FDF4F0;
  --coral-100: #FAE3D8;
  --coral-200: #F5C3A8;
  --coral-300: #EDA07A;
  --coral-400: #E38A64;
  --coral-500: #D97757;   /* BASE — accent principal */
  --coral-600: #C45E3D;
  --coral-700: #A34830;
  --coral-800: #7A3522;
  --coral-900: #512216;

  /* Warm neutral scale */
  --neutral-50:  #FAF9F6;
  --neutral-100: #F0EDE8;
  --neutral-200: #DDD9D3;
  --neutral-300: #C4BFB8;
  --neutral-400: #9B9791;
  --neutral-500: #6B6762;
  --neutral-600: #4A4743;
  --neutral-700: #333130;
  --neutral-800: #2A2826;
  --neutral-900: #1C1A19;   /* BASE — bg-app */
}
```

---

## TYPOGRAPHY

```css
:root {
  /* === FONT FAMILIES === */
  --font-sans:  'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;

  /* === TYPE SCALE (Google Stitch / M3 compatible) === */
  --text-xs:    0.75rem;    /* 12px — labels, badges */
  --text-sm:    0.8125rem;  /* 13px — meta, secondary */
  --text-base:  0.9375rem;  /* 15px — body principal */
  --text-md:    1rem;       /* 16px — body large */
  --text-lg:    1.125rem;   /* 18px — subtítulos */
  --text-xl:    1.25rem;    /* 20px — títulos de panel */
  --text-2xl:   1.5rem;     /* 24px — títulos de sección */
  --text-3xl:   1.875rem;   /* 30px — títulos de página */

  /* === LINE HEIGHTS === */
  --leading-tight:   1.25;
  --leading-snug:    1.375;
  --leading-normal:  1.5;
  --leading-relaxed: 1.625;
  --leading-code:    1.7;   /* para bloques de código */

  /* === FONT WEIGHTS === */
  --weight-regular:  400;
  --weight-medium:   500;
  --weight-semibold: 600;
  --weight-bold:     700;

  /* === LETTER SPACING === */
  --tracking-tight:  -0.025em;
  --tracking-normal:  0em;
  --tracking-wide:    0.025em;
  --tracking-caps:    0.08em;   /* para labels en mayúsculas */
}
```

### Jerarquía tipográfica

| Rol            | Tamaño     | Peso       | Uso                           |
|----------------|------------|------------|-------------------------------|
| `display`      | `--text-3xl` | `semibold` | Titulares de onboarding       |
| `heading-1`    | `--text-2xl` | `semibold` | Título de vista principal     |
| `heading-2`    | `--text-xl`  | `semibold` | Título de panel/sección       |
| `heading-3`    | `--text-lg`  | `medium`   | Subtítulos de card            |
| `body`         | `--text-base`| `regular`  | Cuerpo de texto, chat         |
| `body-sm`      | `--text-sm`  | `regular`  | Metadata, timestamps          |
| `label`        | `--text-xs`  | `medium`   | Labels, badges                |
| `code`         | `--text-sm`  | `regular`  | Código inline, monospace      |
| `code-block`   | `--text-sm`  | `regular`  | Bloques de código (Monaco)    |

---

## SPACING

```css
:root {
  /* Google Stitch 4px base grid */
  --space-0:   0;
  --space-1:   0.25rem;   /* 4px */
  --space-2:   0.5rem;    /* 8px */
  --space-3:   0.75rem;   /* 12px */
  --space-4:   1rem;      /* 16px */
  --space-5:   1.25rem;   /* 20px */
  --space-6:   1.5rem;    /* 24px */
  --space-8:   2rem;      /* 32px */
  --space-10:  2.5rem;    /* 40px */
  --space-12:  3rem;      /* 48px */
  --space-16:  4rem;      /* 64px */
  --space-20:  5rem;      /* 80px */

  /* Alias semánticos */
  --gap-xs:    var(--space-1);
  --gap-sm:    var(--space-2);
  --gap-md:    var(--space-4);
  --gap-lg:    var(--space-6);
  --gap-xl:    var(--space-8);

  --padding-card:    var(--space-4);
  --padding-panel:   var(--space-6);
  --padding-compact: var(--space-2) var(--space-3);
}
```

---

## BORDER RADIUS

```css
:root {
  --radius-xs:   2px;    /* inputs de código, badges pequeños */
  --radius-sm:   4px;    /* botones compactos, chips */
  --radius-md:   8px;    /* tarjetas, paneles, inputs */
  --radius-lg:   12px;   /* modales, drawers */
  --radius-xl:   16px;   /* popovers grandes */
  --radius-full: 9999px; /* pills, avatares */
}
```

---

## ELEVATION (Material Design 3)

```css
:root {
  /* Sombras — warm toned para coincidir con la paleta */
  --shadow-sm:  0 1px 2px rgba(0,0,0,0.4);
  --shadow-md:  0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px var(--border-subtle);
  --shadow-lg:  0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px var(--border-subtle);
  --shadow-xl:  0 16px 48px rgba(0,0,0,0.7);

  /* Surface overlay tint (M3 elevation tint) */
  --tint-1:  rgba(255,255,255,0.05);  /* level 1 */
  --tint-2:  rgba(255,255,255,0.08);  /* level 2 */
  --tint-3:  rgba(255,255,255,0.11);  /* level 3 */
  --tint-4:  rgba(255,255,255,0.12);  /* level 4 */
  --tint-5:  rgba(255,255,255,0.14);  /* level 5 */
}
```

---

## MOTION

```css
:root {
  /* Duraciones */
  --duration-fast:    100ms;
  --duration-default: 200ms;
  --duration-slow:    350ms;

  /* Easings (M3 Emphasized) */
  --ease-standard:    cubic-bezier(0.2, 0.0, 0, 1.0);
  --ease-decelerate:  cubic-bezier(0.0, 0.0, 0, 1.0);
  --ease-accelerate:  cubic-bezier(0.3, 0.0, 1.0, 1.0);
  --ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1.0);
}
```

---

## COMPONENTES

### Reglas globales

- **Todos los componentes** usan las variables CSS — nunca colores hardcodeados
- **Background por defecto**: `var(--bg-surface)` sobre `var(--bg-app)`
- **Bordes**: siempre con `var(--border-default)`, no `solid 1px #333`
- **Focus ring**: `outline: 2px solid var(--accent); outline-offset: 2px`
- **Transiciones**: siempre `transition: <prop> var(--duration-default) var(--ease-standard)`

---

### Button

```css
/* Base */
.btn {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--duration-default) var(--ease-standard);
}

/* Primary — Claude coral */
.btn-primary {
  background: var(--accent);
  color: var(--accent-on);
  border-color: var(--accent);
}
.btn-primary:hover  { background: var(--accent-hover); }
.btn-primary:active { opacity: 0.85; }

/* Secondary — outlined */
.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border-default);
}
.btn-secondary:hover { background: var(--tint-1); border-color: var(--border-strong); }

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
}
.btn-ghost:hover { background: var(--tint-2); color: var(--text-primary); }

/* Danger */
.btn-danger {
  background: var(--color-error);
  color: #fff;
}

/* Tamaños */
.btn-sm { font-size: var(--text-xs); padding: var(--space-1) var(--space-3); }
.btn-lg { font-size: var(--text-md); padding: var(--space-3) var(--space-6); }
.btn-icon { padding: var(--space-2); aspect-ratio: 1; }
```

---

### Input / Textarea

```css
.input {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-primary);
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  width: 100%;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.input::placeholder { color: var(--text-tertiary); }
.input:hover        { border-color: var(--border-strong); }
.input:focus        { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-muted); }
.input:disabled     { opacity: 0.4; cursor: not-allowed; }

/* Code input — monospace */
.input-code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-code);
  background: var(--bg-app);
  border-color: var(--border-subtle);
}
```

---

### Card / Panel

```css
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--padding-card);
  box-shadow: var(--shadow-sm);
}

.card-elevated {
  background: var(--bg-surface-2);
  box-shadow: var(--shadow-md);
}

.panel {
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
  padding: var(--padding-panel);
}
```

---

### Badge / Chip

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
}

.badge-default  { background: var(--bg-surface-2);   color: var(--text-secondary); }
.badge-accent   { background: var(--accent-muted);    color: var(--accent);         border-color: var(--accent); }
.badge-success  { background: var(--color-success-bg); color: var(--color-success); }
.badge-warning  { background: var(--color-warning-bg); color: var(--color-warning); }
.badge-error    { background: var(--color-error-bg);   color: var(--color-error);   }
.badge-info     { background: var(--color-info-bg);    color: var(--color-info);    }
```

---

### Chat Message (Claude-style)

```css
.message {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  line-height: var(--leading-relaxed);
}

/* Burbuja de usuario */
.message-user .message-content {
  background: var(--bg-surface-2);
  border-radius: var(--radius-md) var(--radius-md) var(--radius-xs) var(--radius-md);
  padding: var(--space-3) var(--space-4);
  max-width: 80%;
}

/* Respuesta del asistente — sin burbuja, full-width */
.message-assistant .message-content {
  flex: 1;
  color: var(--text-primary);
}

/* Bloques de código en mensajes */
.message pre {
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-code);
  overflow-x: auto;
}

/* Tool call indicator */
.tool-call {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin: var(--space-2) 0;
}
.tool-call .tool-name { color: var(--accent); }
```

---

### Scrollbar (IDE-style)

```css
::-webkit-scrollbar       { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: var(--radius-full); }
::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
```

---

### Layout — 3 paneles (DevMind App)

```
┌─────────────────────────────────────────────────────────────────┐
│  TopBar (48px) — bg-sidebar + border-bottom                      │
├───────────────┬────────────────────────────────┬─────────────────┤
│               │                                │                 │
│  FileExplorer │      CodeEditor (Monaco)       │   ChatPanel     │
│  240px fixed  │      flex: 1                   │   360px fixed   │
│  bg-sidebar   │      bg-app                    │   bg-sidebar    │
│               │                                │                 │
│               ├────────────────────────────────┤                 │
│               │  Terminal (xterm.js) — 200px   │                 │
│               │  bg-app, collapsible           │                 │
├───────────────┴────────────────────────────────┴─────────────────┤
│  AgentConsole (drawer) — 300px, bg-surface, collapsible          │
└─────────────────────────────────────────────────────────────────┘
```

```css
.app-layout {
  display: grid;
  grid-template-rows: 48px 1fr auto;
  grid-template-columns: 240px 1fr 360px;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

.top-bar {
  grid-column: 1 / -1;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
  gap: var(--space-4);
  height: 48px;
}

.file-explorer {
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}

.editor-area {
  display: grid;
  grid-template-rows: 1fr auto;
  overflow: hidden;
}

.chat-panel {
  background: var(--bg-sidebar);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.agent-console {
  grid-column: 1 / -1;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-default);
  transition: height var(--duration-slow) var(--ease-decelerate);
}
```

---

### Monaco Editor Theme

El editor debe usar estos valores como tema custom:

| Token         | Color     |
|---------------|-----------|
| Background    | `#1C1A19` |
| Current line  | `#252321` |
| Selection     | `rgba(217,119,87,0.2)` |
| Keyword       | `#C792EA` |
| String        | `#A3E48D` |
| Number        | `#F78C6C` |
| Comment       | `#5C6370` |
| Function      | `#82AAFF` |
| Variable      | `#EEEBE6` |
| Type          | `#FFCB6B` |
| Operator      | `#D97757` ← accent |

---

### AutonomyMatrix (Risk colors)

| Nivel    | Color                 | CSS var           |
|----------|-----------------------|-------------------|
| `low`    | `var(--color-success)` | verde             |
| `medium` | `var(--color-warning)` | ámbar             |
| `high`   | `var(--color-error)`   | rojo              |

---

## REGLAS PARA AGENTES DE CODIFICACIÓN

> Estas reglas son **obligatorias** al generar cualquier código UI para DevMind.

1. **Nunca** usar colores hex directamente en componentes — siempre `var(--token)`
2. **Nunca** usar `black` o `white` — usar `var(--text-primary)` o `var(--bg-app)`
3. Todo componente nuevo hereda `font-family: var(--font-sans)` del body
4. Los bloques de código siempre usan `font-family: var(--font-mono)`
5. El accent `var(--accent)` es coral — no es azul, no es verde
6. Los bordes se expresan con `var(--border-subtle/default/strong)` — no `rgba` manual
7. Los estados de hover añaden `var(--tint-1)` o `var(--tint-2)` — no un color distinto
8. El focus ring es siempre `outline: 2px solid var(--accent); outline-offset: 2px`
9. Los estados de error usan `var(--color-error)` y `var(--color-error-bg)` juntos
10. Spacing: múltiplos de `--space-*` — no valores arbitrarios como `padding: 7px`

---

## FUENTES EXTERNAS A IMPORTAR

```html
<!-- En index.html del frontend -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

```css
/* En tokens.css del design-system */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--bg-app);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

