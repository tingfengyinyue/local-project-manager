# Design — Local Project Manager

A locked design system for this app. Every page reads this file before visual changes. Extend this system instead of creating route-specific themes.

## Genre

Atmospheric, technical, compact, and instrument-like.

## Macrostructure family

- App pages: **Workbench**. The project, its runtime steps, and its logs are the primary content.
- Home: operational index with a compact project rail and explicit command surfaces.
- Detail: asymmetric split workspace; process sequence supports the larger live-output pane.
- Forms: one unbroken configuration sheet, grouped by execution sequence.

## Theme

**Lumen / Night Foundry**, adapted for an application rather than a marketing page.

- Cool violet-black paper and soft near-white ink.
- Molten brass appears only as a signal: primary action, focus, active status, and links.
- Blueprint rules give large empty surfaces quiet technical structure.
- Graphite-black is reserved for live process output.

## Typography

- Display: Instrument Serif, weight 400, roman.
- Body: Geist, weight 400–600.
- Mono: JetBrains Mono, weight 400–600, only for paths, commands, status, and logs.
- Display tracking: `-0.03em`.
- Type scale: major third, with app headings capped below marketing-display sizes.

## Spacing

4-point named scale in `tokens.css`. Components consume named tokens; raw spacing values are reserved for one-pixel rules and unavoidable geometry.

## Motion

- Easings: named exponential curves from `tokens.css`.
- Button feedback: one-pixel press, 120–180 ms.
- Overlay: opacity plus small scale, 260 ms.
- Runtime state: colour and opacity only.
- Reduced motion: opacity-only, no spatial movement, at most 150 ms.

## Microinteractions stance

- Silent success when the changed state is already visible.
- Errors name the failed operation and retain recovery context.
- Search palette opens with click or `⌘K` / `Ctrl K`, closes with Escape, and keeps keyboard focus.
- No decorative looping animation; static glow is allowed around active signals.

## CTA voice

- Primary: molten-brass fill, pill radius, concrete verb.
- Secondary: paper surface, visible rule, concrete verb.
- Destructive: error ink on error-tinted paper; confirmation remains because deleting a project registry entry is irreversible in this UI.

## Per-page allowances

- App pages do not use decorative enrichment.
- The log console is the only full graphite surface.
- Project marks may use user-provided text or emoji; the surrounding chrome does not introduce emoji icons.

## What pages MUST share

- Header and search-command language.
- Lumen signal placement.
- Instrument Serif + Geist + JetBrains Mono roles.
- Button, input, focus, status, rule, and spacing tokens.
- Workbench layout hierarchy.

## What pages MAY differ on

- Home uses an operational project index.
- Detail gives the log console more area than the step list.
- Configuration uses a right-side sheet on wide screens and a full-height sheet on narrow screens.

## Exports

The canonical CSS export is `tokens.css` at the repository root.

### Tailwind v4

```css
@theme {
  --color-paper: oklch(13% 0.014 265);
  --color-paper-2: oklch(17% 0.016 265);
  --color-ink: oklch(96% 0.006 262);
  --color-ink-2: oklch(82% 0.01 262);
  --color-rule: oklch(30% 0.018 265);
  --color-accent: oklch(76% 0.17 50);
  --color-focus: oklch(84% 0.16 50);
  --font-display: "Instrument Serif", serif;
  --font-body: "Geist", sans-serif;
  --font-mono: "JetBrains Mono", monospace;
  --spacing-xs: 0.5rem;
  --spacing-sm: 0.75rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2.5rem;
  --radius-card: 0.625rem;
  --radius-input: 0.375rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(13% 0.014 265)", "$type": "color" },
    "ink": { "$value": "oklch(96% 0.006 262)", "$type": "color" },
    "accent": { "$value": "oklch(76% 0.17 50)", "$type": "color" },
    "focus": { "$value": "oklch(84% 0.16 50)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Instrument Serif, serif", "$type": "fontFamily" },
    "body": { "$value": "Geist, sans-serif", "$type": "fontFamily" },
    "mono": { "$value": "JetBrains Mono, monospace", "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "0.75rem", "$type": "dimension" },
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui

```css
:root {
  --background: 13% 0.014 265;
  --foreground: 96% 0.006 262;
  --card: 17% 0.016 265;
  --card-foreground: 96% 0.006 262;
  --primary: 76% 0.17 50;
  --primary-foreground: 13% 0.014 265;
  --secondary: 22% 0.018 263;
  --secondary-foreground: 82% 0.01 262;
  --muted: 30% 0.018 265;
  --muted-foreground: 60% 0.016 263;
  --destructive: 68% 0.17 28;
  --destructive-foreground: 13% 0.014 265;
  --border: 30% 0.018 265;
  --input: 42% 0.02 263;
  --ring: 84% 0.16 50;
  --radius: 0.625rem;
}
```
