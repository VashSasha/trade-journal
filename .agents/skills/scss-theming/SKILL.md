---
name: scss-theming
description: SCSS and theming rules for this codebase — CSS custom properties, BEM naming, no Tailwind. Load when writing any component styles.
---

# SCSS Theming Rules

## The Hard Rules
- NO Tailwind utility classes — ever
- NO @apply
- NO hardcoded colors (no #fff, no rgba(0,0,0,0.5), no named colors)
- All theme-aware values → CSS custom properties only

## Available CSS Variables
```scss
// Backgrounds
var(--color-bg-base)         // page background
var(--color-bg-surface)      // card / panel background
var(--color-bg-surface-2)    // nested surface
var(--color-bg-surface-3)    // deepest nesting

// Borders & Text
var(--color-border)          // all borders
var(--color-text-primary)    // headings, important text
var(--color-text-secondary)  // body text
var(--color-text-muted)      // labels, placeholders

// Accent
var(--color-accent)          // primary CTA, active states
var(--color-accent-hover)    // hover on accent
var(--color-accent-subtle)   // accent backgrounds, badges
```

## BEM Naming
```scss
// Block
.trade-card { }

// Element
.trade-card__header { }
.trade-card__body { }
.trade-card__pnl { }

// Modifier
.trade-card--positive { }
.trade-card--negative { }
.trade-card__pnl--highlighted { }
```

## Correct component SCSS
```scss
.equity-section {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;

  &__header {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  &__value {
    color: var(--color-text-secondary);

    &--positive { color: var(--color-accent); }
    &--negative { color: #e74c3c; } // ❌ wrong — use a var
  }
}
```

## Responsive
Use @media directly in component SCSS — no shared breakpoint mixins required.
```scss
.trade-card {
  display: grid;
  grid-template-columns: 1fr 1fr;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}
```

## Dark mode
Handled automatically via CSS variables — you never need to write [data-theme="dark"] overrides in component SCSS. Just use var(--color-*) and ThemeService handles the rest.