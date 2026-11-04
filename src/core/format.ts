export function money(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** plural(1, 'part', 'parts') is "1 part"; plural(3, 'part', 'parts') is "3 parts". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "Oct 14", or "Today" for today's date. */
export function shortDate(iso: string, today: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * The whole number typed into a Stepper, raised to the minimum, or null if
 * nothing usable is typed (an empty box, or not a number).
 */
export function parseCount(text: string, min: number): number | null {
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return null
  return Math.max(min, Math.round(value))
}
