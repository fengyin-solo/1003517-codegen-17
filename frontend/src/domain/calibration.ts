import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta, runAction as genericRunAction } from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

// 仪器检定临期台账：历史记录没有有效期时，按检定日期加默认检定周期（12 个月）回填。
export const DEFAULT_CALIBRATION_MONTHS = 12
export const EXPIRE_SOON_DAYS = 30

export const LEDGER_STATUSES = ['待送检', '送检中', '已合格'] as const
const EXCLUDED_STATUSES = ['不合格', '已停用']

const ACTION_PER_STATUS: Record<string, string[]> = {
  待送检: ['送出检定'],
  送检中: ['确认合格', '标记不合格'],
  已合格: [],
  不合格: [],
  已停用: [],
}

export type LedgerRow = {
  id: number
  row: EntryRow
  记录编号: string
  仪器编号: string
  仪器名称: string
  检定单位: string
  检定日期: string
  有效期至: string
  有效期回填: boolean
  检定结论: string
  系统建议: string
  人工复核: string
  结论冲突: boolean
  红线覆盖: boolean
  状态: string
  临期状态: '已失效' | '已过期' | '临期' | '正常' | '无有效期'
  剩余天数: number | null
  到期月份: string
  可送检: boolean
  可执行动作: string[]
}

export type LedgerFilters = {
  month?: string
  unit?: string
  keyword?: string
}

export function parseDate(value: string | number | boolean | undefined): Date | null {
  if (typeof value !== 'string') {
    return null
  }
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value.trim())
  if (!matched) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  // 统一按 UTC 零点比较，避免本地时区把日期往前挪一天。
  return new Date(Date.UTC(year, month - 1, day))
}

export function formatDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addMonths(isoDate: string, months: number): string {
  const date = parseDate(isoDate)
  if (!date) {
    return isoDate
  }
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  base.setUTCMonth(base.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
  base.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return formatDate(base)
}

export function effectiveExpiry(row: EntryRow): { date: string; backfilled: boolean } {
  const raw = String(row['有效期至'] ?? '').trim()
  if (parseDate(raw)) {
    return { date: raw, backfilled: false }
  }
  const calibrated = String(row['检定日期'] ?? '').trim()
  if (parseDate(calibrated)) {
    return { date: addMonths(calibrated, DEFAULT_CALIBRATION_MONTHS), backfilled: true }
  }
  return { date: '', backfilled: false }
}

export function daysBetween(from: Date, to: Date): number {
  const dayMs = 24 * 60 * 60 * 1000
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / dayMs)
}

// 人工复核取「检定结论」字段：历史数据里的占位文字不算结论，按无复核处理。
const REAL_CONCLUSIONS = ['合格', '不合格']

export function manualConclusion(row: EntryRow): string {
  const raw = String(row['检定结论'] ?? '').trim()
  if (!raw) {
    return ''
  }
  if (raw.includes('不合格')) {
    return '不合格'
  }
  if (raw.includes('合格')) {
    return '合格'
  }
  return ''
}

export function suggestedConclusion(status: string, remaining: number | null): string {
  if (status === '不合格') {
    return '不合格'
  }
  if (status === '已停用') {
    return '不合格'
  }
  if (remaining !== null && remaining < 0) {
    return '不合格'
  }
  if (status === '已合格') {
    return '合格'
  }
  if (status === '送检中') {
    return '合格'
  }
  return '待检定'
}

// 台账判定：人工复核结论优先于系统建议；但已合格却超过有效期的，安全红线优先，一律判已失效。
export function resolveLedger(row: EntryRow, todayInput?: Date): LedgerRow | null {
  const status = String(row.status ?? '')
  if (EXCLUDED_STATUSES.includes(status)) {
    return null
  }
  if (!LEDGER_STATUSES.includes(status as (typeof LEDGER_STATUSES)[number])) {
    return null
  }

  const today = todayInput ?? new Date()
  const expiry = effectiveExpiry(row)
  const expiryDate = parseDate(expiry.date)
  const remaining = expiryDate ? daysBetween(today, expiryDate) : null
  const manual = manualConclusion(row)
  const suggested = suggestedConclusion(status, remaining)

  let ledgerStatus: LedgerRow['临期状态']
  if (!expiryDate) {
    ledgerStatus = '无有效期'
  } else if (remaining! < 0) {
    // 已合格证书过期是失效仪器；待送检/送检中仪器没有在用证书，只按到期提醒。
    ledgerStatus = status === '已合格' ? '已失效' : '已过期'
  } else if (remaining! <= EXPIRE_SOON_DAYS) {
    ledgerStatus = '临期'
  } else {
    ledgerStatus = '正常'
  }

  // 安全红线：已合格却超过有效期的，无论人工复核写了什么，一律判失效，结论按失效计。
  const safetyOverride = ledgerStatus === '已失效'
  const conflict = Boolean(
    manual && suggested !== '待检定' && manual !== suggested && !safetyOverride,
  )

  // 失效仪器不能显示成可送检：只有「待送检」且非失效状态才给出送检入口。
  const sendable = status === '待送检' && ledgerStatus !== '已失效'
  const actions = sendable ? [...ACTION_PER_STATUS[status]] : ACTION_PER_STATUS[status]

  return {
    id: Number(row.id),
    row,
    记录编号: String(row['记录编号'] ?? ''),
    仪器编号: String(row['仪器编号'] ?? ''),
    仪器名称: String(row['仪器名称'] ?? ''),
    检定单位: String(row['检定单位'] ?? ''),
    检定日期: String(row['检定日期'] ?? ''),
    有效期至: expiry.date,
    有效期回填: expiry.backfilled,
    检定结论: safetyOverride ? '已失效' : manual || suggested,
    系统建议: suggested,
    人工复核: manual,
    结论冲突: conflict,
    红线覆盖: safetyOverride && Boolean(manual && manual !== '不合格'),
    状态: status,
    临期状态: ledgerStatus,
    剩余天数: remaining,
    到期月份: expiryDate ? `${expiryDate.getUTCFullYear()}-${String(expiryDate.getUTCMonth() + 1).padStart(2, '0')}` : '',
    可送检: sendable,
    可执行动作: actions,
  }
}

export function buildExpiringLedger(filters: LedgerFilters = {}, today?: Date): LedgerRow[] {
  const rows = listRows('calibration')
    .map((row) => resolveLedger(row, today))
    .filter((item): item is LedgerRow => item !== null)

  const month = (filters.month ?? '').trim()
  const unit = (filters.unit ?? '').trim()
  const keyword = (filters.keyword ?? '').trim()
  const filtered = rows.filter((item) => {
    if (month && item.到期月份 !== month) {
      return false
    }
    if (unit && !item.检定单位.includes(unit)) {
      return false
    }
    if (keyword) {
      const haystack = `${item.记录编号}${item.仪器编号}${item.仪器名称}`
      if (!haystack.includes(keyword)) {
        return false
      }
    }
    return true
  })

  // 排列规则：有效期至的月份 → 检定单位 → 结论（失效优先），同组内剩余天数少的在前。
  const statusRank: Record<LedgerRow['临期状态'], number> = {
    已失效: 0,
    已过期: 1,
    临期: 2,
    正常: 3,
    无有效期: 4,
  }
  return filtered.sort((a, b) => {
    const ma = a.到期月份 || '9999-99'
    const mb = b.到期月份 || '9999-99'
    if (ma !== mb) {
      return ma < mb ? -1 : 1
    }
    if (a.检定单位 !== b.检定单位) {
      return a.检定单位 < b.检定单位 ? -1 : 1
    }
    if (statusRank[a.临期状态] !== statusRank[b.临期状态]) {
      return statusRank[a.临期状态] - statusRank[b.临期状态]
    }
    if (a.检定结论 !== b.检定结论) {
      return a.检定结论 < b.检定结论 ? -1 : 1
    }
    const da = a.剩余天数 ?? Number.MAX_SAFE_INTEGER
    const db = b.剩余天数 ?? Number.MAX_SAFE_INTEGER
    return da - db
  })
}

// 把回填的有效期写回历史记录，之后再打开台账就不用重复推导。
export function persistBackfilledExpiry(ids?: number[]): void {
  const rows = listRows('calibration')
  let changed = false
  const next = rows.map((row) => {
    if (ids && !ids.includes(Number(row.id))) {
      return row
    }
    const raw = String(row['有效期至'] ?? '').trim()
    if (parseDate(raw)) {
      return row
    }
    const expiry = effectiveExpiry(row)
    if (!expiry.date) {
      return row
    }
    changed = true
    return { ...row, 有效期至: expiry.date }
  })
  if (changed) {
    saveRows('calibration', next)
  }
}

// 检定动作的领域守卫：失效仪器不能送出检定，其他动作也必须符合当前状态。
export function runCalibrationAction(id: number, action: string): ActionResult {
  const meta = moduleMeta('calibration')
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `仪器检定记录没有登记「${action}」这个动作` }
  }
  const rows = listRows('calibration')
  const current = rows.find((row) => Number(row.id) === id)
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器检定记录` }
  }
  if (action === '送出检定') {
    const ledger = resolveLedger(current)
    if (!ledger) {
      return { ok: false, message: '不合格或已停用仪器不能送检，请先重新登记检定' }
    }
    if (!ledger.可送检) {
      return { ok: false, message: '该仪器证书已失效，需先转回待送检后再安排送检' }
    }
  }
  return genericRunAction('calibration', id, action)
}
