<template>
  <section class="page" data-module="calibration">
    <header class="page-head">
      <div>
        <h2>仪器检定管理</h2>
        <p class="page-desc">维护仪器检定记录，临期台账按有效期月份、检定单位与结论排列待送检、送检中、已合格仪器，并提示剩余有效期。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记仪器检定记录</button>
        <button class="btn" type="button" @click="exportRows">导出仪器检定清单</button>
        <button class="btn ghost" type="button" @click="resetSeed">恢复示例数据</button>
      </div>
    </header>

    <div class="tab-bar" role="tablist">
      <button
        class="tab"
        :class="{ active: activeTab === 'ledger' }"
        type="button"
        @click="switchTab('ledger')"
      >
        检定台账
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'expiring' }"
        type="button"
        @click="switchTab('expiring')"
      >
        临期台账
      </button>
    </div>

    <!-- 检定台账 -->
    <div v-if="activeTab === 'ledger'">
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

      <form class="filter-bar" @submit.prevent="reloadAll">
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
            <td v-for="column in columns" :key="column">
              <template v-if="column === '有效期至'">
                {{ displayExpiry(row).date || '—' }}
                <span v-if="displayExpiry(row).backfilled" class="badge badge-backfill">回填</span>
                <span v-if="isExpiredQualified(row)" class="badge badge-danger">证书已失效</span>
              </template>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!actionsFor(row).length" class="text-muted">—</span>
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
    </div>

    <!-- 临期台账 -->
    <div v-else>
      <div class="rule-note">
        台账规则：缺少有效期的历史记录按检定日期加默认周期 {{ defaultMonths }} 个月回填（标注「回填」）；
        结论以人工复核为准，人工复核与系统建议冲突时人工优先，但证书已过有效期的仪器一律判失效；
        失效仪器不显示送检入口，需先转回待送检。
      </div>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">台账仪器</span>
          <strong class="stat-value">{{ ledgerRows.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已失效</span>
          <strong class="stat-value danger">{{ ledgerCount('已失效') }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">30 天内到期</span>
          <strong class="stat-value warn">{{ ledgerCount('临期') }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">可送检</span>
          <strong class="stat-value">{{ ledgerRows.filter((item) => item.可送检).length }}</strong>
        </article>
      </div>

      <div class="confirm-bar">
        <template v-if="confirmed">
          <span class="confirm-text ok">✓ 临期台账已确认：站房维护台账与巡检待办各有一条「仪器核查」事项，重复打开不会重复生成。</span>
        </template>
        <template v-else>
          <span class="confirm-text">确认后将分别在站房维护台账、巡检待办中生成一条仪器核查事项。</span>
          <button class="btn primary" type="button" @click="confirmLedger">确认临期台账</button>
        </template>
      </div>

      <form class="filter-bar" @submit.prevent="reloadLedger">
        <label class="filter-item">
          <span>到期月份</span>
          <select v-model="ledgerFilters.month">
            <option value="">全部月份</option>
            <option v-for="month in monthOptions" :key="month" :value="month">{{ month }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>检定单位</span>
          <input v-model="ledgerFilters.unit" placeholder="按检定单位检索" />
        </label>
        <label class="filter-item">
          <span>仪器检索</span>
          <input v-model="ledgerFilters.keyword" placeholder="编号 / 名称" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetLedgerFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>到期月份</th>
            <th>记录编号</th>
            <th>仪器编号 / 名称</th>
            <th>检定单位</th>
            <th>检定日期</th>
            <th>有效期至</th>
            <th>剩余天数</th>
            <th>检定结论</th>
            <th>台账状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in ledgerRows" :key="item.id" :class="{ 'row-invalid': item.临期状态 === '已失效' }">
            <td>{{ item.到期月份 || '—' }}</td>
            <td>{{ item.记录编号 }}</td>
            <td>{{ item.仪器编号 }}<br /><span class="text-muted">{{ item.仪器名称 }}</span></td>
            <td>{{ item.检定单位 }}</td>
            <td>{{ item.检定日期 }}</td>
            <td>
              {{ item.有效期至 || '—' }}
              <span v-if="item.有效期回填" class="badge badge-backfill">回填</span>
            </td>
            <td>
              <span :class="daysClass(item)">{{ formatDays(item) }}</span>
            </td>
            <td>
              <span>{{ item.检定结论 }}</span>
              <p v-if="item.红线覆盖" class="conflict-text danger">
                人工复核虽为「{{ item.人工复核 }}」，但证书已过期，安全红线优先按失效处理
              </p>
              <p v-else-if="item.结论冲突" class="conflict-text">
                人工复核「{{ item.人工复核 }}」优先于系统建议「{{ item.系统建议 }}」
              </p>
              <p v-else-if="item.临期状态 === '已失效'" class="conflict-text danger">
                证书已过期，安全红线优先，按失效处理
              </p>
            </td>
            <td>
              <span class="badge" :class="badgeClass(item.临期状态)">{{ item.状态 }} · {{ item.临期状态 }}</span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in ledgerActions(item)"
                :key="action"
                class="link"
                type="button"
                @click="runLedgerAction(action, item)"
              >
                {{ action }}
              </button>
              <span v-if="!ledgerActions(item).length" class="text-muted">
                {{ item.临期状态 === '已失效' ? '失效不可送检' : '—' }}
              </span>
            </td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td colspan="10" class="empty-state">暂无临期仪器，不合格与已停用仪器不进入临期台账</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>按有效期月份、检定单位、结论排序；剩余天数按今天（{{ todayText }}）计算</span>
        <span v-if="ledgerMessage" :class="ledgerMessageOk ? 'ok-text' : 'error-text'">{{ ledgerMessage }}</span>
      </footer>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  resetModule,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  DEFAULT_CALIBRATION_MONTHS,
  buildExpiringLedger,
  effectiveExpiry,
  persistBackfilledExpiry,
  resolveLedger,
  runCalibrationAction,
  type LedgerRow,
} from '@/domain/calibration'
import {
  confirmExpiringLedger,
  ledgerConfirmed,
} from '@/domain/followup'

const meta = moduleMeta('calibration')
const columns = ['记录编号', '仪器编号', '仪器名称', '检定单位', '检定日期', '有效期至', '检定结论', '检定状态']
const statuses = ['待送检', '送检中', '已合格', '不合格', '已停用']
const defaultMonths = DEFAULT_CALIBRATION_MONTHS

const activeTab = ref<'ledger' | 'expiring'>('ledger')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const ledgerRows = ref<LedgerRow[]>([])
const ledgerFilters = ref<{ month: string; unit: string; keyword: string }>({
  month: '',
  unit: '',
  keyword: '',
})
const ledgerMessage = ref('')
const ledgerMessageOk = ref(true)
const confirmed = ref(false)

const todayText = (() => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
})()

const stats = computed(() => [
  { label: '待送检仪器', value: rows.value.filter((row) => String(row.status) === '待送检').length },
  { label: '送检中仪器', value: rows.value.filter((row) => String(row.status) === '送检中').length },
  { label: '已合格仪器', value: rows.value.filter((row) => String(row.status) === '已合格').length },
  { label: '失效 / 不合格', value: rows.value.filter((row) => isExpiredQualified(row) || String(row.status) === '不合格').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const monthOptions = computed(() => {
  const months = new Set<string>()
  for (const row of listEntries(meta.key).items) {
    const item = resolveLedger(row)
    if (item?.到期月份) {
      months.add(item.到期月份)
    }
  }
  return [...months].sort()
})

function isExpiredQualified(row: EntryRow): boolean {
  const item = resolveLedger(row)
  return item?.临期状态 === '已失效'
}

function displayExpiry(row: EntryRow): { date: string; backfilled: boolean } {
  return effectiveExpiry(row)
}

// 失效仪器不能显示成可送检：动作按状态与有效期共同决定。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待送检') {
    const item = resolveLedger(row)
    return item?.可送检 ? ['送出检定'] : []
  }
  if (status === '送检中') {
    return ['确认合格', '标记不合格']
  }
  if (status === '已合格') {
    return isExpiredQualified(row) ? ['转回待送检'] : []
  }
  return []
}

// 临期台账操作列：失效的已合格仪器只给「转回待送检」，不给出送检入口。
function ledgerActions(item: LedgerRow): string[] {
  if (item.状态 === '已合格' && item.临期状态 === '已失效') {
    return ['转回待送检']
  }
  return item.可执行动作
}

function ledgerCount(status: LedgerRow['临期状态']): number {
  return ledgerRows.value.filter((item) => item.临期状态 === status).length
}

function formatDays(item: LedgerRow): string {
  if (item.剩余天数 === null) {
    return '无有效期'
  }
  if (item.剩余天数 === 0) {
    return '今天到期'
  }
  if (item.剩余天数 < 0) {
    return `${item.临期状态 === '已失效' ? '已失效' : '已过期'} ${Math.abs(item.剩余天数)} 天`
  }
  return `剩余 ${item.剩余天数} 天`
}

function daysClass(item: LedgerRow): string {
  if (item.剩余天数 === null) {
    return 'text-muted'
  }
  if (item.剩余天数 < 0) {
    return 'days-danger'
  }
  if (item.剩余天数 <= 30) {
    return 'days-warn'
  }
  return ''
}

function badgeClass(status: LedgerRow['临期状态']): string {
  if (status === '已失效') {
    return 'badge-danger'
  }
  if (status === '已过期') {
    return 'badge-danger'
  }
  if (status === '临期') {
    return 'badge-warn'
  }
  if (status === '无有效期') {
    return 'badge-backfill'
  }
  return 'badge-ok'
}

function resetFilters() {
  filters.value = {}
  reloadAll()
}

function resetLedgerFilters() {
  ledgerFilters.value = { month: '', unit: '', keyword: '' }
  reloadLedger()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetSeed() {
  resetModule(meta.key)
  reloadAll()
  reloadLedger()
  errorMessage.value = '已恢复为示例数据'
}

function openCreate() {
  errorMessage.value = '仪器检定记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = runCalibrationAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadAll()
}

function runLedgerAction(action: string, item: LedgerRow) {
  ledgerMessage.value = ''
  const result = runCalibrationAction(item.id, action)
  if (!result.ok) {
    ledgerMessageOk.value = false
    ledgerMessage.value = result.message
    return
  }
  ledgerMessageOk.value = true
  ledgerMessage.value = result.message
  reloadAll()
  reloadLedger()
}

function confirmLedger() {
  // 先把回填的有效期写回历史记录，再生成两侧核查事项。
  persistBackfilledExpiry()
  const result = confirmExpiringLedger(buildExpiringLedger().length)
  ledgerMessageOk.value = result.ok
  ledgerMessage.value = result.message
  confirmed.value = ledgerConfirmed()
  reloadAll()
  reloadLedger()
}

function switchTab(tab: 'ledger' | 'expiring') {
  activeTab.value = tab
  if (tab === 'expiring') {
    reloadLedger()
  } else {
    reloadAll()
  }
}

function reloadAll() {
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
  confirmed.value = ledgerConfirmed()
  ledgerRows.value = buildExpiringLedger(ledgerFilters.value)
}

onMounted(() => {
  reloadAll()
  reloadLedger()
})
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 8px 18px; cursor: pointer; font-size: 14px; }
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.rule-note { background: #eef4ff; border: 1px solid #c7dbff; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #334b7d; margin-bottom: 12px; }
.confirm-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.confirm-text { font-size: 13px; }
.confirm-text.ok { color: #067647; }
.badge { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.badge-danger { background: #fee4e2; color: #b42318; }
.badge-warn { background: #fef0c7; color: #b54708; }
.badge-ok { background: #d1fadf; color: #067647; }
.badge-backfill { background: #e0eaff; color: #1d4ed8; }
.days-danger { color: #b42318; font-weight: 600; }
.days-warn { color: #b54708; font-weight: 600; }
.conflict-text { margin: 4px 0 0; font-size: 12px; color: #b54708; }
.conflict-text.danger { color: #b42318; }
.row-invalid { background: #fff7f6; }
.text-muted { color: var(--muted); font-size: 12px; }
.danger { color: #b42318; }
.warn { color: #b54708; }
.ok-text { color: #067647; font-size: 12px; }
.filter-item select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; }
</style>
