import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 临期台账确认后的联动：站房维护台账与巡检待办各落一条「仪器核查」事项。
export const CALIBRATION_CHECK_TYPE = '仪器核查'
const STATIONHOUSE_NO = 'CALI-CHECK-HOUSE'
const INSPECTION_NO = 'CALI-CHECK-PATROL'
const CONFIRM_FLAG_KEY = 'hydrology-monitor-station:calibration-ledger-confirmed'

export type ConfirmResult = {
  ok: boolean
  alreadyConfirmed: boolean
  created: { stationhouse: boolean; inspection: boolean }
  message: string
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function hasCheckItem(rows: EntryRow[], marker: string): boolean {
  return rows.some(
    (row) =>
      String(row['记录编号'] ?? '') === marker ||
      String(row['维护类型'] ?? '') === CALIBRATION_CHECK_TYPE ||
      String(row['检查项目'] ?? '') === CALIBRATION_CHECK_TYPE,
  )
}

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function buildStationhouseCheck(id: number, count: number): EntryRow {
  return {
    id,
    status: '待安排',
    pending: true,
    abnormal: false,
    记录编号: STATIONHOUSE_NO,
    站点编号: '全站点',
    维护类型: CALIBRATION_CHECK_TYPE,
    维护内容: `依据仪器检定临期台账核查 ${count} 台在管仪器的证书有效期与送检安排`,
    维护单位: '仪器检定临期台账',
    维护日期: todayText(),
    费用支出: 0,
    维护状态: '待安排',
  }
}

function buildInspectionCheck(id: number, count: number): EntryRow {
  return {
    id,
    status: '待巡检',
    pending: true,
    abnormal: false,
    记录编号: INSPECTION_NO,
    站点编号: '全站点',
    巡检日期: todayText(),
    巡检人员: '待分配',
    检查项目: CALIBRATION_CHECK_TYPE,
    发现问题: `对照临期台账核查 ${count} 台仪器的检定状态与剩余有效期`,
    处理措施: '现场核对仪器标识与证书，临近失效的及时安排送检',
    巡检状态: '待巡检',
  }
}

export function ledgerConfirmed(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  return window.localStorage.getItem(CONFIRM_FLAG_KEY) === '1'
}

function markConfirmed(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CONFIRM_FLAG_KEY, '1')
  }
}

// 重复打开台账不重复生成：固定记录编号 + 来源标记双重去重，确认标记只用于按钮状态。
export function confirmExpiringLedger(instrumentCount: number): ConfirmResult {
  const wasConfirmed = ledgerConfirmed()

  const houseRows = listRows('stationhouse')
  const patrolRows = listRows('inspection')
  const houseExists = hasCheckItem(houseRows, STATIONHOUSE_NO)
  const patrolExists = hasCheckItem(patrolRows, INSPECTION_NO)

  if (wasConfirmed && houseExists && patrolExists) {
    return {
      ok: true,
      alreadyConfirmed: true,
      created: { stationhouse: false, inspection: false },
      message: '临期台账已确认过，站房核查事项与巡检待办均已存在，未重复生成',
    }
  }

  if (!houseExists) {
    saveRows('stationhouse', [...houseRows, buildStationhouseCheck(nextId(houseRows), instrumentCount)])
  }
  if (!patrolExists) {
    saveRows('inspection', [...patrolRows, buildInspectionCheck(nextId(patrolRows), instrumentCount)])
  }
  markConfirmed()

  return {
    ok: true,
    alreadyConfirmed: wasConfirmed,
    created: { stationhouse: !houseExists, inspection: !patrolExists },
    message: '已确认临期台账，站房维护台账与巡检待办各生成一条仪器核查事项',
  }
}

export function pendingStationhouseChecks(): EntryRow[] {
  return listRows('stationhouse').filter(
    (row) =>
      String(row['维护类型'] ?? '') === CALIBRATION_CHECK_TYPE &&
      String(row.status) === '待安排',
  )
}

export function pendingInspectionChecks(): EntryRow[] {
  return listRows('inspection').filter(
    (row) =>
      String(row['检查项目'] ?? '') === CALIBRATION_CHECK_TYPE &&
      String(row.status) === '待巡检',
  )
}
