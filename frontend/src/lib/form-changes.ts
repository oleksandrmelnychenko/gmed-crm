/** Compare form data independently of object insertion order; array order matters. */
export function hasFormChanges(current: unknown, initial: unknown): boolean {
  const signature = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item) && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  })
  return signature(current) !== signature(initial)
}
