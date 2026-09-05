/** Tracks values, rather than whether a field has ever received an input event. */
export function createOverlayDirtyTracker() {
  const fields = new Map<unknown, { initial: string; current: string }>()

  return {
    update(key: unknown, previous: string, current: string) {
      const field = fields.get(key)
      fields.set(key, { initial: field?.initial ?? previous, current })
    },
    isDirty() {
      return Array.from(fields.values()).some(({ initial, current }) => initial !== current)
    },
    reset() {
      fields.clear()
    },
  }
}
