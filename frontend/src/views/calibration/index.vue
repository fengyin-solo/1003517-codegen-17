<template>
  <section class="page" data-module="calibration">
    <header class="page-head">
      <div>
        <h2>仪器检定管理</h2>
        <p class="page-desc">维护仪器检定记录，围绕记录编号、仪器编号、仪器名称、检定单位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记仪器检定记录</button>
        <button class="btn" type="button" @click="exportRows">导出仪器检定清单</button>
      </div>
    </header>

    <div class="tab-row">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'list' }"
        type="button"
        @click="switchTab('list')"
      >
        检定记录
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'ledger' }"
        type="button"
        @click="switchTab('ledger')"
      >
        临期台账
      </button>
    </div>

    <template v-if="activeTab === 'list'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>
              {{ row.status }}
              <span v-if="isExpiredRow(row)" class="tag tag-danger">已失效</span>
            </td>
            <td class="row-actions">
              <template v-if="rowActions(row).length">
                <button
                  v-for="action in rowActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无仪器检定数据，可先登记仪器检定记录</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条仪器检定记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <div class="stat-row">
        <article v-for="item in ledger.stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <div class="confirm-bar">
        <div class="confirm-info">
          <strong>临期仪器台账</strong>
          <span class="text-muted">
            按有效期月份、检定单位、结论排列待送检 / 送检中 / 已合格仪器；确认后向站房维护台账与巡检待办各派发一条核查事项。
          </span>
          <span v-if="ledger.confirmed" class="tag tag-ok">
            已确认 · 核查事项生成于 {{ formatDateTime(ledger.lastConfirmedAt) }}
          </span>
        </div>
        <button class="btn primary" type="button" @click="confirmLedger">
          {{ ledger.confirmed ? '再次确认（不重复生成）' : '确认视图并生成核查事项' }}
        </button>
      </div>
      <p v-if="confirmMessage" class="confirm-message" :class="{ 'error-text': !confirmOk }">
        {{ confirmMessage }}
      </p>

      <table class="data-table ledger-table">
        <thead>
          <tr>
            <th>有效期月份</th>
            <th>仪器编号</th>
            <th>仪器名称</th>
            <th>检定单位</th>
            <th>有效期至</th>
            <th>剩余天数</th>
            <th>状态</th>
            <th>系统建议结论</th>
            <th>展示结论</th>
            <th>可送检</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in ledger.groups" :key="group.month">
            <tr class="month-row">
              <td colspan="11">{{ group.monthLabel }}（{{ group.items.length }} 台）</td>
            </tr>
            <tr v-for="item in group.items" :key="item.id" :class="{ 'row-expired': item.expired }">
              <td>{{ group.monthLabel }}</td>
              <td>{{ item.row['仪器编号'] }}</td>
              <td>{{ item.row['仪器名称'] }}</td>
              <td>{{ item.row['检定单位'] }}</td>
              <td>
                {{ item.expiry || '未登记' }}
                <span v-if="item.backfilled" class="tag tag-warn" title="历史记录缺少有效期，按检定日期 + 12 个月回填">
                  系统回填
                </span>
              </td>
              <td>
                <span v-if="item.daysLeft === null" class="text-muted">日期缺失</span>
                <span v-else-if="item.expired" class="tag tag-danger">已失效 {{ -item.daysLeft }} 天</span>
                <span v-else :class="['days-left', { 'days-urgent': item.nearExpiry }]">
                  剩余 {{ item.daysLeft }} 天
                </span>
              </td>
              <td>
                {{ item.statusLabel }}
                <span v-if="item.nearExpiry" class="tag tag-warn">临期</span>
              </td>
              <td class="text-muted">{{ item.suggested }}</td>
              <td>
                {{ item.conclusion }}
                <span v-if="item.conclusionConflict" class="tag tag-danger" title="人工复核结论优先，系统建议仅作提示">
                  结论冲突·以人工复核为准
                </span>
              </td>
              <td>
                <span v-if="item.canSend" class="tag tag-ok">可送检</span>
                <span v-else-if="item.expired" class="tag tag-danger">失效·不可送检</span>
                <span v-else class="text-muted">—</span>
              </td>
              <td class="row-actions">
                <template v-if="ledgerActions(item).length">
                  <button
                    v-for="action in ledgerActions(item)"
                    :key="action"
                    class="link"
                    type="button"
                    @click="runAction(action, item.row)"
                  >
                    {{ action }}
                  </button>
                </template>
                <span v-else class="text-muted">—</span>
              </td>
            </tr>
          </template>
          <tr v-if="!ledger.items.length">
            <td colspan="11" class="empty-state">暂无待送检、送检中、已合格的仪器</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>
          共 {{ ledger.items.length }} 台在管仪器；不合格、已停用仪器不进入临期台账。
          默认检定周期 12 个月，临期阈值 30 天。
        </span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  calibrationActions,
  confirmCalibrationLedger,
  downloadEntries,
  listEntries,
  loadCalibrationLedger,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { CalibrationLedgerItem, CalibrationLedgerResult, EntryRow } from '@/data/types'
import { daysUntil, parseDate } from '@/utils/date'

const meta = moduleMeta('calibration')
const columns = ["记录编号", "仪器编号", "仪器名称", "检定单位", "检定日期", "有效期至", "检定结论", "检定状态"]
const statuses = ["待送检", "送检中", "已合格", "不合格", "已停用"]
const stats = [{"label": "待送检仪器", "value": 0}, {"label": "已合格仪器", "value": 0}, {"label": "不合格仪器", "value": 0}]

const activeTab = ref<'list' | 'ledger'>('list')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const ledger = ref<CalibrationLedgerResult>({
  groups: [],
  items: [],
  stats: [],
  confirmed: false,
  lastConfirmedAt: '',
})
const confirmMessage = ref('')
const confirmOk = ref(true)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isExpiredRow(row: EntryRow): boolean {
  const expiry = parseDate(row['有效期至'])
  return expiry !== null && daysUntil(expiry) < 0
}

function rowActions(row: EntryRow): string[] {
  return calibrationActions(row)
}

function ledgerActions(item: CalibrationLedgerItem): string[] {
  return calibrationActions(item.row)
}

function formatDateTime(iso: string): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '仪器检定记录登记入口尚未接入审批流'
}

function switchTab(tab: 'list' | 'ledger') {
  activeTab.value = tab
  errorMessage.value = ''
  confirmMessage.value = ''
  if (tab === 'ledger') {
    reloadLedger()
  } else {
    reload()
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (activeTab.value === 'ledger') {
    reloadLedger()
  }
}

function confirmLedger() {
  errorMessage.value = ''
  const result = confirmCalibrationLedger()
  confirmOk.value = result.ok
  confirmMessage.value = result.message
  reloadLedger()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '仪器检定列表读取失败'
  }
}

function reloadLedger() {
  try {
    ledger.value = loadCalibrationLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '临期台账读取失败'
  }
}

onMounted(reload)
</script>
