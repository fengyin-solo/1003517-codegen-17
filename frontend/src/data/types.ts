/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 台账确认后派发到站房维护台账、巡检待办的核查事项。
export type ReviewTodo = {
  id: number
  source: string
  target: 'stationhouse' | 'inspection'
  title: string
  detail: string
  done: boolean
  createdAt: string
  completedAt: string
}

export type CalibrationLedgerItem = {
  id: number
  row: EntryRow
  expiry: string
  expiryMonth: string
  daysLeft: number | null
  expired: boolean
  nearExpiry: boolean
  backfilled: boolean
  statusLabel: string
  conclusion: string
  suggested: string
  manualConclusion: boolean
  conclusionConflict: boolean
  canSend: boolean
}

export type CalibrationLedgerGroup = {
  month: string
  monthLabel: string
  items: CalibrationLedgerItem[]
}

export type CalibrationLedgerResult = {
  groups: CalibrationLedgerGroup[]
  items: CalibrationLedgerItem[]
  stats: { label: string; value: number }[]
  confirmed: boolean
  lastConfirmedAt: string
}

export type ConfirmLedgerResult = {
  ok: boolean
  message: string
  created: string[]
}
