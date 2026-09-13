---
name: transitions-dev
description: Add, fix, or review CSS transitions and motion tokens in web UI. Use for animation work or explicit transitions commands, not ordinary component layout, validation, or business logic changes.
---

# Transitions.dev

CSS transition examples with semantic custom properties and reduced-motion support. Use the existing component and motion conventions; adapt an example when it helps the requested interaction.

## Choose the relevant guidance

- Find an effect in the [catalog](./catalog.md), then read only its reference for CSS, state hooks, and any JavaScript orchestration.
- For token normalization or shared installation, read the annotated [_root.css](./_root.css). Match tokens by purpose, not merely by numeric similarity; leave unmatched values unchanged.
- For close-state, replay, or browser-specific problems, consult the applicable [integration notes](./integration-notes.md).

Choose a modest effect consistent with the current UI when the user leaves routine design details open. Ask for clarification only when the target or desired behavior is materially ambiguous.

## Commands and scope

- `transitions reveal`: list the catalog's effects with short descriptions and reference links. No repository scan is needed.
- `transitions review`: review animation in the requested files or area and report actionable findings with file locations. Review the whole project only when that is the requested scope. This command alone does not authorize edits.
- `transitions apply`: implement the named effect or the best fit for the specified interaction. The apply request authorizes that local edit; do not require a second confirmation for the same work.
- `transitions refine`: normalize motion timing and easing in the requested area using tokens with matching purposes. If the user asks only for an audit or proposals, report suggestions without editing. Inspect inline styles, utility classes, and stylesheets as relevant to that area.

An ordinary request to review a project does not invoke an animation audit. Preserve the user's requested scope and any existing authorization.

## Integration

- Reuse installed tokens. For one effect, add only the variables it needs; use the full root block when a shared installation is appropriate. Avoid duplicate declarations and collisions with existing tokens.
- Treat reference snippets as examples that can be adapted to the framework and component state model. Preserve the relationships among state hooks, CSS properties, timing, and cleanup; avoid a second competing lifecycle or DOM controller.
- Preserve `prefers-reduced-motion` behavior and existing keyboard, focus, and ARIA semantics. Keep essential feedback visible even when motion is disabled.
- Use explicit animated properties instead of `transition: all`. Keep JavaScript timing synchronized with CSS variables where orchestration needs it, and clean up timers/listeners on interruption or unmount.
- Keep changes local to the requested interaction; a CSS transition does not require introducing a motion library.

Verify the changed interaction in the browser, including closing/reopening or interruption when applicable and reduced-motion behavior. Run affected checks according to the repository guidance; catalog or instruction edits need only content/link validation.
