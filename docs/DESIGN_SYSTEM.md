# Design system

One visual language for both surfaces: the extension overlay and the
Tampermonkey toolbox. Everything here is defined once, in
`extension/overlay/tokens.js`, and consumed by both.

## Why this exists

Before this document the two surfaces shared **nothing**. A survey of the two
stylesheets found:

| | Extension overlay | Tampermonkey toolbox |
|---|---|---|
| Selectors and custom properties | 88 | 49 |
| Names defined in **both** | 0 | 0 |
| Hardcoded colour literals | 28 | 76 |
| Instagram CSS variables used | 0 | 14 |

Two independent palettes, two naming schemes (`.ia-*` against `.panel`/`.tab`),
104 colour literals between them, and only one of the two integrating with
Instagram's own theme at all. A change to one surface never reached the other,
and dark mode was correct in one place and approximated in the other.

## Instagram integration

Instagram publishes its palette as CSS custom properties on the document. The
tokens read those first and fall back to fixed values, so the panel follows the
page's light and dark treatment without needing to detect the theme:

```css
--aio-accent: rgb(var(--ig-primary-button, 0 149 246));
--aio-text:   rgb(var(--ig-primary-text, 0 0 0));
--aio-line:   rgb(var(--ig-separator, 219 219 219));
```

If Instagram renames a variable the fallback keeps the panel readable rather
than unstyled. This is visual compatibility only. The project is independent and
is not affiliated with or endorsed by Instagram or Meta, and nothing here copies
Instagram assets, marks, or proprietary styling.

## Semantic colour roles

Roles, never raw colours. A component asks for `--aio-danger`, not a hex value.

| Role | Token | Used for |
|---|---|---|
| Surface | `--aio-bg` | Panel body |
| Raised surface | `--aio-bg-raised` | Header, footer, cards |
| Sunken surface | `--aio-bg-sunken` | Tab strip, track fills |
| Text | `--aio-text` | Primary copy |
| Muted text | `--aio-text-muted` | Secondary copy, captions |
| Separator | `--aio-line` | Borders and rules |
| Accent | `--aio-accent` | Primary action, selected tab |
| On accent | `--aio-on-accent` | Text and icons on an accent or danger fill |
| Success | `--aio-success` | Completed, proven removal |
| Warning | `--aio-warning` | Running, paused, incomplete scan |
| Danger | `--aio-danger` | Destructive action, failed, blocked |
| Uncertain | `--aio-uncertain` | Postcondition not proven |
| Focus ring | `--aio-focus` | Keyboard focus |

`--aio-uncertain` is deliberately distinct from `--aio-danger`. An uncertain
outcome is not a failure: the action may have happened. Colouring the two the
same would tell the reader something the tool does not know.

## State palette

Every interactive element resolves to exactly one state.

| State | Treatment |
|---|---|
| `primary` | Accent fill, white text |
| `secondary` | Transparent fill, accent text, accent border |
| `quiet` | Transparent fill, muted text, no border until hover |
| `warning` | Warning border and text |
| `destructive` | Danger fill, white text, requires confirmation |
| `success` | Success text with a check |
| `selected` | Accent underline, `aria-selected="true"` |
| `disabled` | 45% opacity, `not-allowed`, `aria-disabled` |
| `locked` | Muted with a lock, explains what unlocks it |
| `armed` | Danger border with a live countdown |
| `running` | Warning border with progress |
| `paused` | Muted border, resume affordance |
| `stopped` | Danger border, exact stop reason |
| `uncertain` | Uncertain border, states what could not be proven |

`locked`, `armed`, `stopped`, and `uncertain` are visual only. They report the
authorization and safe-stop machinery; they never influence it.

## Typography

Instagram's system stack via `--ig-font-family`, falling back to the platform UI
font. Four sizes only.

| Step | Size / line height | Used for |
|---|---|---|
| `--aio-text-lg` | 15px / 20px | Panel title, run headline |
| `--aio-text-md` | 14px / 20px | Body, controls |
| `--aio-text-sm` | 13px / 18px | Secondary copy |
| `--aio-text-xs` | 12px / 16px | Captions, counts |

Weights: 400 body, 600 emphasis and controls. No other weights, so the panel
never competes with post content beside it.

## Spacing, radii, borders

A 4px scale: `--aio-space-1` 4px through `--aio-space-6` 24px. Nothing between
steps.

Radii follow Instagram's own shapes: `--aio-radius-sm` 6px for inputs,
`--aio-radius-md` 8px for buttons and cards, `--aio-radius-lg` 16px for the
panel.

Borders are always 1px `--aio-line`. Emphasis comes from colour, not thickness.

## Elevation

Three levels. The panel floats over Instagram, so shadows stay soft and shallow
to avoid reading as a modal.

- `--aio-shadow-panel` — the panel against the page
- `--aio-shadow-popover` — settings and menus above the panel
- `--aio-shadow-none` — flat cards inside the panel

## Focus and hit targets

Focus is a 2px `--aio-focus` ring at 2px offset, applied through
`:focus-visible` so pointer users do not see it. It is never removed, only
repositioned.

Interactive targets are at least 44×44px. Visually smaller controls keep the
target via padding or a pseudo-element, so a 20px icon still has a 44px hit box.

## Density and breakpoints

`comfortable` is the default. `compact` reduces vertical padding one step and
leaves font sizes and hit targets untouched — it must not shrink targets.

| Breakpoint | Behaviour |
|---|---|
| `>= 900px` tall | Full panel |
| `< 900px` tall | Short-laptop: header collapses, body scrolls |
| `< 768px` wide | Tablet: single column |
| `< 600px` wide | Mobile: bottom sheet, drag and resize disabled |
| 200% zoom | Treated as the narrow case |

## Motion

Motion explains a state change. It never decorates.

| Token | Duration | Used for |
|---|---|---|
| `--aio-motion-fast` | 120ms | Hover, focus |
| `--aio-motion-base` | 180ms | Tabs, disclosures |
| `--aio-motion-slow` | 240ms | Panel open and close |

Easing is `--aio-ease` `cubic-bezier(.2,.7,.3,1)` — quick to start, settling at
the end.

Rules:

- No ambient or looping motion, no parallax, no large transforms.
- No continuous blur. The panel's backdrop blur is a static value, never animated.
- Progress bars transition width only.
- Under `prefers-reduced-motion: reduce`, all transitions and animations are
  removed. State still changes; it just arrives immediately.
- Focus never moves as a result of a transition.

## Forced colors

Under `forced-colors: active` the tokens step aside: surfaces become `Canvas`,
text `CanvasText`, accents and focus `Highlight`, and every border becomes a
solid 1px `CanvasText` so structure survives without colour. Nothing depends on
a colour that forced-colors mode discards.

## Using the tokens

Both surfaces call the same function and inject the result into their shadow
root:

```js
const styles = globalThis.InstaAioTokens.css({ density: 'comfortable' });
```

Rules for contributors:

1. Never write a colour literal in a component. Add a role if none fits.
2. Never write a pixel spacing value outside the scale.
3. Never remove a focus ring.
4. Never introduce a state outside the table above.
5. Changing a token changes both surfaces — that is the point. Check both.
