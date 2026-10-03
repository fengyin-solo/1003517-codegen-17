// 日期工具：统一按「本地日期」做整天差计算，避免时区与时分秒造成的偏差。

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

export function today(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// 目标日期相对今天的整天数：正数=剩余，负数=已过期。
export function daysUntil(target: Date): number {
  const ms = target.getTime() - today().getTime()
  return Math.round(ms / 86400000)
}

// 有效期月份分组键，如 2026-10；已失效的归入 0-已失效。
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
