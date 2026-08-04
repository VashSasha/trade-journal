---
name: widget-architecture
description: Self-contained widget component rules for this codebase. Load when building any new page section or feature component.
---

# Widget Architecture Rules

## Why
The roadmap includes user-configurable layouts — users will be able to add, remove, and reorder page sections. Every section must be independently renderable today so that layer can be added later without rewrites.

## The Core Rule
Every page section = a standalone component that works when dropped anywhere.

## Checklist for every new section component

### ✅ Must pass
- [ ] All data comes in via @Input() or injected services — never from parent template variables
- [ ] Manages its own loading state internally
- [ ] Manages its own error state internally
- [ ] Manages its own empty state internally
- [ ] No reference to sibling components
- [ ] No logic that assumes a fixed position on the page
- [ ] Could be rendered standalone in a test with just its inputs and providers

### ❌ Must NOT do
- Read from a parent's template variable (`let trade of parent.trades`)
- Rely on a sibling having rendered first
- Use ViewChild to reach into a parent or sibling
- Embed position-specific logic ("this only makes sense after the header")

## Correct pattern
```typescript
@Component({
  selector: 'app-equity-section',
  standalone: true,
  template: `
    @if (loading()) { <app-skeleton /> }
    @else if (trades().length === 0) { <app-empty-state /> }
    @else { <app-equity-curve-chart [trades]="trades()" /> }
  `
})
export class EquitySectionComponent {
  // Data via injected global service
  private tradeService = inject(TradeService);
  private filterService = inject(FilterService);

  // Own internal state
  loading = signal(false);

  // Derived from services — not from parent
  trades = computed(() => this.filterService.filterTrades());
}
```

## What this does NOT require yet
- No drag-and-drop
- No settings UI
- No widget registry
Just keep each section independently renderable.