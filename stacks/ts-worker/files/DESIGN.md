# Design brief: {{APP_NAME}}

Decide this **before** writing UI code, then keep to it (method: `guides/design-brief.md` in
shipify). The values below are the stack's neutral starting point. Replace them with
choices specific to this app.

- **Subject, audience, primary job:** {{APP_DESCRIPTION}}
- **Screens:** the main screen and its one primary action. List any others the same way.
- **Tone:** three adjectives, plus one or two real-world references.
- **Palette** (tokens in `src/web/ui/tokens.css`, light / dark):

  | Token | Role | Light | Dark |
  |---|---|---|---|
  | `--color-bg` | page | `#f5f6f8` | `#0f151c` |
  | `--color-surface` | cards, inputs | `#ffffff` | `#161f29` |
  | `--color-text` | body text | `#17202a` | `#e3eaf1` |
  | `--color-muted` | secondary text (at least 4.5:1) | `#5a6776` | `#97a6b6` |
  | `--color-accent` | the one action colour | `#2f5bd0` | `#86a6ff` |
  | `--color-ok` / `warn` / `danger` | states only | | |

- **Type:** the system stack by default. If you add a face, self-host it with a fallback. The size
  scale is `--text-sm` / `md` / `lg` / `xl`.
- **Layout and density:** preset `{{PRESET_ID}}`, mobile first at 360px. `--space` is 3px for
  compact, 4px by default, 5px for roomy.
- **The one memorable element:** decide it here.
- **States:** empty, loading and error, each with copy that says what to do next.

## Rules

- Style only through tokens. There are no hex colours or pixel font sizes inside components.
- Follow the quality bar (`guides/quality-bar.md`). The shared tests check 360px, tap targets and
  the JS budget.
- Avoid the generic defaults listed in `guides/design-brief.md`.
