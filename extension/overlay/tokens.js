(() => {
  'use strict';

  // Single source of visual truth for the extension overlay and the
  // Tampermonkey toolbox. See docs/DESIGN_SYSTEM.md.
  //
  // Both surfaces previously carried their own palette — 104 colour literals
  // between them and no shared name — so a fix in one never reached the other.
  // Everything visual now resolves to a role defined here.
  //
  // Instagram publishes its palette as CSS custom properties on the document.
  // Each role reads Instagram's value first and falls back to a fixed one, so
  // the panel follows the page's light and dark treatment without detecting it,
  // and stays readable if Instagram renames a variable. This is visual
  // compatibility only; the project is independent of Instagram and Meta.

  const SPACE = ['0', '4px', '8px', '12px', '16px', '20px', '24px'];

  function palette() {
    return {
      '--aio-bg': 'rgb(var(--ig-primary-background, 255 255 255))',
      '--aio-bg-raised': 'rgb(var(--ig-elevated-background, 255 255 255))',
      '--aio-bg-sunken': 'rgb(var(--ig-secondary-background, 250 250 250))',
      '--aio-text': 'rgb(var(--ig-primary-text, 0 0 0))',
      '--aio-text-muted': 'rgb(var(--ig-secondary-text, 115 115 115))',
      '--aio-line': 'rgb(var(--ig-separator, 219 219 219))',
      '--aio-accent': 'rgb(var(--ig-primary-button, 0 149 246))',
      '--aio-on-accent': '#fff',
      '--aio-success': 'rgb(var(--ig-success, 0 148 84))',
      '--aio-warning': '#b26a00',
      '--aio-danger': 'rgb(var(--ig-error-or-destructive, 237 73 86))',
      // Deliberately not the danger colour: an uncertain outcome may well have
      // succeeded, and colouring it as a failure would assert what we do not know.
      '--aio-uncertain': '#7a5cc4',
      '--aio-focus': 'rgb(var(--ig-primary-button, 0 149 246))',
    };
  }

  function scale(density) {
    const tight = density === 'compact';
    return {
      '--aio-space-1': SPACE[1],
      '--aio-space-2': SPACE[2],
      '--aio-space-3': SPACE[3],
      '--aio-space-4': SPACE[4],
      '--aio-space-5': SPACE[5],
      '--aio-space-6': SPACE[6],
      // Compact trims vertical rhythm only. Hit targets and font sizes are
      // never reduced, so a denser panel stays as usable as a roomy one.
      '--aio-pad-y': tight ? SPACE[2] : SPACE[3],
      '--aio-pad-x': tight ? SPACE[3] : SPACE[4],
      '--aio-gap': tight ? SPACE[2] : SPACE[3],
      '--aio-radius-sm': '6px',
      '--aio-radius-md': '8px',
      '--aio-radius-lg': '16px',
      '--aio-border': '1px',
      '--aio-target': '44px',
      '--aio-text-lg': '15px',
      '--aio-text-md': '14px',
      '--aio-text-sm': '13px',
      '--aio-text-xs': '12px',
      '--aio-leading-lg': '20px',
      '--aio-leading-md': '20px',
      '--aio-leading-sm': '18px',
      '--aio-leading-xs': '16px',
      '--aio-weight-normal': '400',
      '--aio-weight-strong': '600',
      '--aio-font': 'var(--ig-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif)',
      '--aio-shadow-panel': '0 12px 40px rgba(0, 0, 0, .18)',
      '--aio-shadow-popover': '0 8px 24px rgba(0, 0, 0, .16)',
      '--aio-shadow-none': 'none',
      '--aio-motion-fast': '120ms',
      '--aio-motion-base': '180ms',
      '--aio-motion-slow': '240ms',
      '--aio-ease': 'cubic-bezier(.2, .7, .3, 1)',
    };
  }

  function declarations(density) {
    return Object.entries({ ...palette(), ...scale(density) })
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ');
  }

  // Shared primitives. Component styles live with their surface; anything that
  // decides colour, focus, target size, or motion lives here.
  function primitives() {
    return `
    .aio-focusable:focus { outline: none; }
    .aio-focusable:focus-visible {
      outline: 2px solid var(--aio-focus);
      outline-offset: 2px;
    }
    /* A control may look small but must never be small to hit. */
    .aio-target { min-width: var(--aio-target); min-height: var(--aio-target); }
    .aio-state-locked { color: var(--aio-text-muted); }
    .aio-state-armed { border-color: var(--aio-danger); color: var(--aio-danger); }
    .aio-state-running { border-color: var(--aio-warning); color: var(--aio-warning); }
    .aio-state-paused { border-color: var(--aio-line); color: var(--aio-text-muted); }
    .aio-state-stopped { border-color: var(--aio-danger); color: var(--aio-danger); }
    .aio-state-uncertain { border-color: var(--aio-uncertain); color: var(--aio-uncertain); }
    .aio-state-success { color: var(--aio-success); }
    .aio-state-selected { color: var(--aio-accent); }
    [disabled], [aria-disabled="true"] { opacity: .45; cursor: not-allowed; }

    @media (prefers-reduced-motion: reduce) {
      /* State still changes; it simply arrives without travel. */
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }

    @media (forced-colors: active) {
      /* Structure has to survive without colour, so every edge becomes real. */
      .aio-surface, .aio-raised, .aio-sunken { background: Canvas; color: CanvasText; }
      .aio-surface, .aio-raised, .aio-sunken, .aio-card { border: 1px solid CanvasText; }
      .aio-focusable:focus-visible { outline-color: Highlight; }
      .aio-state-selected { color: Highlight; }
    }`;
  }

  const api = Object.freeze({
    css(options = {}) {
      const density = options.density === 'compact' ? 'compact' : 'comfortable';
      const scope = options.scope || ':host';
      return `${scope} { ${declarations(density)} }\n${primitives()}`;
    },
    declarations,
    palette,
    scale,
    // Exposed so tests can assert the contract rather than re-reading strings.
    roles: Object.freeze(Object.keys(palette())),
    steps: Object.freeze(Object.keys(scale('comfortable'))),
  });

  Object.defineProperty(globalThis, 'InstaAioTokens', {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();
