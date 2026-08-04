---
name: angular-signals
description: Angular 21 Signals patterns for this codebase — inject(), signal(), computed(), effect(), scoped state. Load when writing or reviewing any service or component.
---

# Angular Signals Patterns

## Dependency Injection
ALWAYS use inject() — never constructor injection.

```typescript
// ✅ Correct
export class MyComponent {
  private tradeService = inject(TradeService);
  private filterService = inject(FilterService);
}

// ❌ Wrong
export class MyComponent {
  constructor(private tradeService: TradeService) {}
}
```

## Signals — Reading and Writing
```typescript
// Define
count = signal(0);
trades = signal<Trade[]>([]);

// Read (always call as function)
const current = this.count();

// Write
this.count.set(5);
this.count.update(n => n + 1);

// Derived (never use BehaviorSubject for this)
total = computed(() => this.trades().reduce((sum, t) => sum + t.pnl, 0));
```

## Effects
Use effect() for side effects that react to signal changes (e.g. persisting to localStorage).
```typescript
constructor() {
  effect(() => {
    localStorage.setItem('trades', JSON.stringify(this.trades()));
  });
}
```

## Scoped State Pattern (Journal)
State classes scoped to a feature component — NOT providedIn: 'root'.
```typescript
// State class
@Injectable()
export class JournalFormState {
  date = signal(new Date());
  isDirty = signal(false);
  save() { ... }
}

// Component
@Component({
  providers: [JournalFormState], // scoped here
})
export class DailyJournalComponent {
  state = inject(JournalFormState);
}
```

## Global vs Scoped
- providedIn: 'root' → TradeService, FilterService, ThemeService, AuthService, SyncService
- No providedIn → JournalFormState, JournalNewsState, JournalRulesState, JournalTagsState, JournalTemplatesState

## NEVER use
- BehaviorSubject / Subject / ReplaySubject
- NgRx store / actions / reducers
- NgModules
- async pipe with Observables (convert to signals with toSignal())