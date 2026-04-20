# UI Shell — style architecture

Single import surface for consistent look across all screens.
`import { ... } from "@/components/ui-shell"`.

## When to use which

| Need | Use | Notes |
|---|---|---|
| Wrap a tab body | `TabShell` | adds `space-y-4 mt-4 min-h-[400px]` |
| Page-level title + actions row | `PageHeader` | title, description, actions |
| Content section with title and optional accessory | `Section` | replaces ad-hoc cards; brand dot + h3 + accessory slot |
| One row in a list of things | `ListItem` | pass `onClick` for clickable card with hover |
| Top-of-tab KPI card | `StatCard` | label + big number + caption |
| Pill coloured by business status | `StatusBadge status="active"` | auto-picks tone; override via `tone="warning"` |
| Label/value read-only pair | `InfoRow` | optional hover-pencil `onEdit` |
| Count badge next to section title | `CountBadge` | muted outline pill |
| "Nothing here yet" placeholder | `EmptyCell` | dashed muted box |
| Loading state inside a tab | `TabLoader` | centred spinner |
| Form field with label on top | `Field` | pairs with `inputClass` / `textareaClass` |

## Tokens

```ts
import { tokens, inputClass, textareaClass, STATUS_TONE } from "@/components/ui-shell";

tokens.radius.md          // "rounded-xl"
tokens.surface.card       // "border border-border/50 bg-card"
tokens.text.eyebrow       // "text-[11px] font-semibold uppercase ..."
tokens.control.inputHeight // "h-9"
```

Use tokens when you build a one-off block; compose with `cn()`.

## Status tones

Six semantic tones: `success` | `warning` | `error` | `info` | `neutral` | `brand`.
`toneForStatus(status)` maps business strings (`"active"`, `"overdue"`, `"draft"`...) to one of those.
Extend `STATUS_TONE_MAP` in `ui-shell.tsx` when a new status appears.

## Tab layout recipe

```tsx
<TabsContent value="cases" className="space-y-4 mt-4 min-h-[400px]">
  <Section
    title={l("Fälle", "Кейсы", "Cases")}
    accessory={
      <div className="flex items-center gap-2">
        <CountBadge>{items.length}</CountBadge>
        <Button size="sm" className="h-8 rounded-lg" onClick={openWorkspace}>
          {l("Bereich öffnen", "Открыть раздел", "Open workspace")}
        </Button>
      </div>
    }
  >
    {loading ? (
      <TabLoader />
    ) : items.length === 0 ? (
      <EmptyCell>{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</EmptyCell>
    ) : (
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((it) => (
          <ListItem key={it.id} onClick={() => open(it.id)}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-muted-foreground">{it.ref}</span>
              <StatusBadge status={it.status}>{label(it.status)}</StatusBadge>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{it.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{fmtDate(it.created_at)}</p>
          </ListItem>
        ))}
      </div>
    )}
  </Section>
</TabsContent>
```

## Migration checklist for an old screen

1. Replace local `card()` / hand-rolled `rounded-[1.75rem] shadow` wrappers → `Section`.
2. Replace lists of `<div className="rounded-xl border ...">` → `ListItem`.
3. Replace `<Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[x])}>` → `StatusBadge status={x}`.
4. Replace KPI tiles with 11px-eyebrow + 2xl number → `StatCard`.
5. Replace raw `text-slate-*` / `bg-slate-*` / `border-slate-*` → semantic tokens (`text-foreground`, `text-muted-foreground`, `bg-card`, `bg-muted/25`, `border-border/50`).
6. Replace `bg-slate-950 text-white hover:bg-slate-800` (fake primary) → default `<Button>` (no className).
7. Replace per-screen empty-state divs → `EmptyCell`.
8. Replace per-screen spinners centred in a box → `TabLoader`.

## Don'ts

- No raw `slate-*` colours. They don't theme.
- No new `rounded-[1.75rem]` / `rounded-2xl` outliers. Stick to `tokens.radius.*`.
- Don't duplicate status colour maps per page. Extend `STATUS_TONE_MAP`.
- Don't wrap `Section` inside another `Section` — nest inner content with plain `ListItem`s or divs.
- Don't introduce `bg-slate-950` primary buttons. Use default `<Button>` variant.
