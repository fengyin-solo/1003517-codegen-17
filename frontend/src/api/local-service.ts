import { MODULE_BY_KEY } from '@/data/modules'
import {
  completeReviewTodo,
  ensureReviewTodo,
  listReviewTodos,
} from '@/data/review-store'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CalibrationLedgerGroup,
  CalibrationLedgerItem,
  CalibrationLedgerResult,
  ConfirmLedgerResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReviewTodo,
} from '@/data/types'
import { addMonths, daysUntil, formatDate, monthKey, parseDate, today } from '@/utils/date'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const CALIBRATION_KEY = 'calibration'
const LEDGER_SOURCE = 'calibration-ledger'
// 历史记录缺少有效期时的默认检定周期：检定日期 + 12 个月。
const DEFAULT_CALIBRATION_PERIOD_MONTHS = 12
// 剩余天数不超过该阈值即视为临期。
const NEAR_EXPIRY_DAYS = 30
const LEDGER_STATUSES = ['待送检', '送检中', '已合格']
const MANUAL_CONCLUSIONS = ['合格', '不合格']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 仪器检定历史记录里「有效期至」缺失或不可识别时，按检定日期 + 默认周期回填并落库，
// 回填过的记录打上标记，台账上能区分哪些日期是系统补的。
function normalizeCalibrationRows(): EntryRow[] {
  const rows = listRows(CALIBRATION_KEY)
  let changed = false
  const next = rows.map((row) => {
    if (parseDate(row['有效期至'])) {
      return row
    }
    const calibratedAt = parseDate(row['检定日期'])
    if (!calibratedAt) {
      return row
    }
    changed = true
    return {
      ...row,
      有效期至: formatDate(addMonths(calibratedAt, DEFAULT_CALIBRATION_PERIOD_MONTHS)),
      有效期回填: true,
    }
  })
  if (changed) {
    saveRows(CALIBRATION_KEY, next)
    return next
  }
  return rows
}

function moduleRows(key: string): EntryRow[] {
  return key === CALIBRATION_KEY ? normalizeCalibrationRows() : listRows(key)
}


export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(moduleRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = moduleRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 失效仪器不能再送检：硬拦截，即使人工复核结论写的是合格也不允许。
  if (key === CALIBRATION_KEY && action === '送出检定') {
    const expiry = parseDate(rows[index]['有效期至'])
    if (expiry && daysUntil(expiry) < 0) {
      return { ok: false, message: '仪器已超过有效期，不能送检，请先停用或重新登记检定' }
    }
    if (!expiry) {
      return { ok: false, message: '该记录缺少有效期，无法判断是否可送检，请先补全检定信息' }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// 某一行仪器当前允许执行的动作：失效仪器不再出现「送出检定」，改给「停用仪器」。
export function calibrationActions(row: EntryRow): string[] {
  const status = String(row.status)
  const expiry = parseDate(row['有效期至'])
  const expired = expiry !== null && daysUntil(expiry) < 0
  switch (status) {
    case '待送检':
      return expired ? ['停用仪器'] : ['送出检定', '停用仪器']
    case '送检中':
      return ['确认合格', '标记不合格']
    case '已合格':
      return expired ? ['停用仪器'] : []
    default:
      return []
  }
}

function buildLedgerItem(row: EntryRow): CalibrationLedgerItem {
  const expiryDate = parseDate(row['有效期至'])
  const daysLeft = expiryDate ? daysUntil(expiryDate) : null
  const expired = daysLeft !== null && daysLeft < 0
  const nearExpiry = daysLeft !== null && daysLeft >= 0 && daysLeft <= NEAR_EXPIRY_DAYS
  const manualConclusion = MANUAL_CONCLUSIONS.includes(String(row['检定结论'] ?? ''))
  // 系统建议结论：按有效期推导；人工复核结论优先，二者不一致时标记冲突。
  let suggested: string
  if (daysLeft === null) {
    suggested = '信息缺失'
  } else if (expired) {
    suggested = '失效停用'
  } else if (String(row.status) === '送检中') {
    suggested = '待出证'
  } else if (nearExpiry) {
    suggested = '尽快送检'
  } else {
    suggested = '合格'
  }
  const conclusion = manualConclusion ? String(row['检定结论']) : suggested
  const conclusionConflict = manualConclusion && suggested !== String(row['检定结论'])
  return {
    id: Number(row.id),
    row,
    expiry: expiryDate ? formatDate(expiryDate) : '',
    expiryMonth: expiryDate ? monthKey(expiryDate) : '',
    daysLeft,
    expired,
    nearExpiry,
    backfilled: row['有效期回填'] === true,
    statusLabel: String(row.status),
    conclusion,
    suggested,
    manualConclusion,
    conclusionConflict,
    // 失效仪器不能显示成可送检。
    canSend: !expired && daysLeft !== null && String(row.status) === '待送检',
  }
}

export function loadCalibrationLedger(): CalibrationLedgerResult {
  const items = normalizeCalibrationRows()
    .filter((row) => LEDGER_STATUSES.includes(String(row.status)))
    .map(buildLedgerItem)
  // 排列：先按有效期月份（失效、缺失沉底），再检定单位，再结论，同组内剩余天数升序。
  items.sort((a, b) => {
    const monthOrder = (item: CalibrationLedgerItem): string => {
      if (item.daysLeft === null) {
        return '9999-99'
      }
      if (item.expired) {
        return '9999-98'
      }
      return item.expiryMonth
    }
    const byMonth = monthOrder(a).localeCompare(monthOrder(b))
    if (byMonth !== 0) {
      return byMonth
    }
    const byUnit = String(a.row['检定单位'] ?? '').localeCompare(String(b.row['检定单位'] ?? ''))
    if (byUnit !== 0) {
      return byUnit
    }
    const byConclusion = a.conclusion.localeCompare(b.conclusion)
    if (byConclusion !== 0) {
      return byConclusion
    }
    const aDays = a.daysLeft ?? Number.MAX_SAFE_INTEGER
    const bDays = b.daysLeft ?? Number.MAX_SAFE_INTEGER
    return aDays - bDays
  })

  const groupsMap = new Map<string, CalibrationLedgerGroup>()
  for (const item of items) {
    let month: string
    let monthLabel: string
    if (item.daysLeft === null) {
      month = 'unknown'
      monthLabel = '未登记有效期'
    } else if (item.expired) {
      month = 'expired'
      monthLabel = '已失效'
    } else {
      month = item.expiryMonth
      monthLabel = `${item.expiryMonth} 到期`
    }
    const group = groupsMap.get(month)
    if (group) {
      group.items.push(item)
    } else {
      groupsMap.set(month, { month, monthLabel, items: [item] })
    }
  }
  const groups = [...groupsMap.values()]

  const stats = [
    { label: '待送检', value: items.filter((item) => item.statusLabel === '待送检').length },
    { label: '送检中', value: items.filter((item) => item.statusLabel === '送检中').length },
    { label: '已合格', value: items.filter((item) => item.statusLabel === '已合格').length },
    { label: '临期（30天内）', value: items.filter((item) => item.nearExpiry).length },
    { label: '已失效', value: items.filter((item) => item.expired).length },
    { label: '结论冲突', value: items.filter((item) => item.conclusionConflict).length },
  ]

  const confirmedTodos = listReviewTodos('stationhouse').filter(
    (todo) => todo.source === LEDGER_SOURCE,
  )
  const lastConfirmedAt = confirmedTodos.length
    ? confirmedTodos.map((todo) => todo.createdAt).sort().pop() ?? ''
    : ''

  return {
    groups,
    items,
    stats,
    confirmed: confirmedTodos.length > 0,
    lastConfirmedAt,
  }
}

// 视图确认后：站房维护台账、巡检待办各生成一条核查事项；重复确认不重复生成。
export function confirmCalibrationLedger(): ConfirmLedgerResult {
  const { items, stats } = loadCalibrationLedger()
  const detailSummary = `待送检 ${stats[0].value} 台、送检中 ${stats[1].value} 台、已合格 ${stats[2].value} 台，临期 ${stats[3].value} 台、失效 ${stats[4].value} 台`
  const created: string[] = []

  const stationhouse = ensureReviewTodo({
    source: LEDGER_SOURCE,
    target: 'stationhouse',
    title: '仪器检定临期核查',
    detail: `请核查临期/失效仪器的站房维护安排（${detailSummary}）`,
  })
  if (stationhouse.created) {
    created.push('stationhouse')
  }
  const inspection = ensureReviewTodo({
    source: LEDGER_SOURCE,
    target: 'inspection',
    title: '仪器检定临期核查',
    detail: `请将临期/失效仪器核查列入巡检待办（${detailSummary}；台账共 ${items.length} 台）`,
  })
  if (inspection.created) {
    created.push('inspection')
  }

  return created.length === 0
    ? { ok: true, message: '核查事项此前已生成，重复确认不重复生成', created }
    : { ok: true, message: '已在站房维护台账与巡检待办各生成一条核查事项', created }
}

export function reviewTodos(target: ReviewTodo['target']): ReviewTodo[] {
  return listReviewTodos(target)
}

export function finishReviewTodo(id: number): ActionResult {
  const todo = completeReviewTodo(id)
  if (!todo) {
    return { ok: false, message: '没有找到这条核查事项' }
  }
  return { ok: true, message: `「${todo.title}」已核查完成` }
}

