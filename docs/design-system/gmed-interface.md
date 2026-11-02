# GMED interface foundations

Current adoption: patient portal and staff shell, navigation, shared tables/forms and dashboards. The public lead cabinet retains its own theme.

## Sources of truth

- `frontend/src/components/ui/gmed-theme.css`: reusable light/dark semantic colour and density tokens, enabled by `.gmed-theme`.
- `frontend/src/components/app-shell/gmed-shell-theme.css`: common navigation, icon and profile-card recipes for both workspaces.
- `frontend/src/components/app-shell/staff-portal-theme.css`: staff canvas, table surfaces, form labels and dashboard density, scoped by `.staff-portal-theme`. Tables retain their existing row measurement and density controls.
- `frontend/src/components/app-shell/patient-portal-theme.css`: portal layout recipes, scoped by `.patient-portal-theme`. Do not put feature layout in the palette file.
- `frontend/src/pages/patients/ui/portal-page-layout.tsx`: shared section, information row, list item, summary and date components.
- `frontend/src/components/ui/gmed-controls.css`: compact staff button variants (30 px desktop, 40 px on phones), shared focus and disabled states.
- `frontend/src/components/ui/status-chip.tsx`: semantic status colours. Primary action colour is not a status colour.

## Visual rules

- Cool grey-lavender canvas, white surfaces, near-black text and graphite primary actions. Use semantic tokens rather than hard-coded feature colours.
- Onest for labels and prose. Monospace is reserved for technical identifiers where it aids reading.
- Field labels: 14 px with 20 px line height; values: 15 px with 22 px line height. Compact dates: 13 px, normal tracking and weight, tabular numerals, 13 px calendar icon.
- Navigation and shortcut icons: 22 px, without decorative backgrounds. Preserve readable labels and explicit selection/focus states.
- Compactness comes from fewer nested surfaces, shorter gaps and aligned rows. Keep actionable touch targets usable on phones.
- One enclosing card per logical section. Group details using columns and quiet dividers instead of another box around each field.
- Request forms use the shared scaffold in dialog mode: paired fields on desktop, one column on phones, a scrolling body and a visible action footer. Use `.portal-request-form` for compact section dividers.
- Service summaries use `portalServiceContext` so a linked appointment cannot repeat the service heading on either the dashboard or the services page.
- Preserve warning, error, payment and clinical status semantics. Never hide urgent priorities to reduce clutter.
- Keep the date period in one place; do not repeat it in every subsection. Remove repeated category badges only when a group label still provides that information.

## Staff navigation and density

- Category headers use 28 px desktop rows and 4 px gaps; on phones they keep 40 px touch targets. Collapsed groups are stored locally, with the active group revealed on route changes.
- Patient workspace rails are white, 248 px wide on desktop, with unboxed 20 px icons.
- Patient sections use 12 px vertical gaps; order sections use 8 px. Workspace action buttons use graphite with 8 px corners; filters and unselected navigation controls remain neutral.
- Tables use neutral gray hover, alternate and selection tokens; explicit semantic row colours remain intact.
- Table headers are straight across the full width, with no rounded inner corners. The surrounding toolbar/card may retain its own radius.
- Order stages use a compact, horizontally scrollable navigation strip. Each stage focuses its corresponding section; process state comes from the server. Keep stage numbers and icons unboxed.
- Order planning uses plain summary rows with dividers, compact appointment lists and paired settings at sufficient container width. Reuse the shared small button variant for plan, PDF and interpreter actions.
- Signed-document date and method share one status chip; source/provenance notes use neutral chips. Allow wrapping at narrow widths.
- Colour reference: cool gray canvas, white surfaces, near-black graphite actions. Orange is not a default table or button fill.

## Theme lifecycle and overlays

`AppShellFrame` applies `.gmed-theme` and the current workspace class (`.patient-portal-theme` or `.staff-portal-theme`) to its root and to `document.body`. Dialogs, sheets and menus render through React portals into the body and inherit the same tokens. The layout effect removes the previous classes on logout or a role change. The lead cabinet does not opt in.

Staff forms use 13 px / 18 px labels and 14 px section headings. Shared `data-slot` hooks identify fields, sections, statistics and table surfaces without depending on a page's incidental utility classes. Preserve table row heights: virtualized tables measure them in JavaScript. Change their density contract, not cell height through CSS.

## Migrating another feature

1. Opt into `.gmed-theme` at its shell and include its portal/overlay host in the same lifecycle.
2. Reuse semantic colour variables and shared UI controls. Extract a reusable component if the same pattern appears twice; avoid per-page colour overrides.
3. Keep feature-specific density and layout in a scoped recipe; do not apply patient layout rules to staff tables automatically.
4. Inspect populated, empty, disabled, loading and error states at desktop and 390 px widths, plus dark mode.
5. Verify overlays, focus, keyboard navigation, text wrapping, long names, dates, amounts and absence of horizontal overflow. Run affected existing flows before broadening adoption.
