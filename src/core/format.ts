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
