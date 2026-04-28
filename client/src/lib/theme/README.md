# Otto theme tokens

The single source of truth for visual choices in the desktop app.

## Two layers

1. **Raw tokens** — `--paper`, `--panel`, `--ink`, `--accent` (emerald), `--brand-navy`, etc. These are the colors and dimensions the new mockup-driven UI consumes directly (sidebar, topbar, worklist, modals).
2. **shadcn semantic tokens** — `--background`, `--foreground`, `--primary`, etc. Mapped onto layer 1 so existing shadcn components (Button, Dialog, Toaster, Input) inherit the new look without any per-component changes.

`tailwind.config.ts` reads from layer 2 for shadcn classes (`bg-background`, `bg-primary`, …) and from layer 1 for the new Otto-namespaced classes (`bg-otto-accent`, `text-ink`, `bg-paper`, …).

## How to extend

- **Adding a new color or dimension**: edit `tokens.css`. Don't put hard-coded hex/px in components.
- **Adding a status pill color**: status pills already render with the per-office hex from `office.settings.customStatuses[].color` via inline style. The default `--st-{name}` tokens here are fallback-only.
- **Density / spacing scale**: changing the user's font-size preference cascades through `--ui-scale` to row heights, padding, and base font size. Don't add a separate density picker.

## Naming convention

- Surfaces: `--paper`, `--panel`, `--panel-2` (paler), `--paper-2` (deeper paper).
- Ink (text): `--ink`, `--ink-2`, `--ink-3`, `--ink-mute`, `--ink-faint` (5 levels, dark to light).
- Hairlines: `--line`, `--line-2`, `--line-strong`.
- Brand: `--brand-navy`, `--brand-emerald`.
- Accent (primary action): `--accent`, `--accent-strong` (hover), `--accent-soft` (background tint), `--accent-line` (border tint), `--accent-ink` (text on soft).

## Why two layers (vs. just shadcn)

shadcn's defaults aren't quite the look we want. Editing layer 2 alone would mean all UI looks "shadcn-with-different-colors" rather than the mockup's specific paper/panel/ink rhythm. Layer 1 lets us build new components that hit the mockup precisely while shadcn keeps working unchanged.

## Animation primitives

`ottoFadeIn`, `ottoPopIn`, `ottoPulseDot`, `ottoSpin`. Use these instead of inventing per-component keyframes. Reduced-motion preference is honored globally.

## Dark mode

Activated by adding `.dark` to `<html>` (handled by `applyDarkMode` in `user-settings-modal.tsx`, called on login and on toggle). The dark block in `tokens.css` redefines every layer-1 and layer-2 token. Design rules:

- Same paper-and-ink rhythm — surfaces step in lightness from `--paper` (deepest) → `--panel` (raised). Ink steps from `--ink` (brightest) → `--ink-faint`.
- Hairlines flip from black-alpha to white-alpha (so they remain visible at the same opacity).
- Accent emerald is slightly brighter (`#3aae7c` vs `#2f9e6e`) to preserve contrast on dark surfaces.
- Status pill colors are desaturated darker variants of their light-mode hues — same role, same hue family, lower luminosity.
- Shadows are deeper (rgba black at 0.30–0.75 vs 0.04–0.30 in light) so cards still float visually.

When adding new tokens, define both light and dark values. New components should not hard-code colors — read from CSS variables and the theme handles itself.
