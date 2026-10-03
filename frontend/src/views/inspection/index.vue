<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="review-panel">
      <h3 class="review-title">仪器核查</h3>
      <ul v-if="reviewItems.length" class="review-list">
        <li v-for="todo in reviewItems" :key="todo.id" class="review-item" :class="{ done: todo.done }">
          <div class="review-body">
            <strong>{{ todo.title }}</strong>
            <p>{{ todo.detail }}</p>
            <span class="text-muted">来源：仪器检定临期台账 · {{ formatDateText(todo.createdAt) }}</span>
          </div>
          <span v-if="todo.done" class="tag tag-ok">已核查 · {{ formatDateText(todo.completedAt) }}</span>
          <button v-else class="btn" type="button" @click="finishTodo(todo.id)">纳入巡检并完成</button>
        </li>
      </ul>
      <p v-else class="text-muted review-empty">暂无仪器核查事项，在「仪器检定 - 临期台账」确认视图后自动生成。</p>
    </section>

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
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  finishReviewTodo,
  listEntries,
  moduleMeta,
  reviewTodos,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ReviewTodo } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = ["记录编号", "站点编号", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const actions = ["完成巡检", "报告故障", "确认处置"]
const statuses = ["待巡检", "已巡检", "发现故障", "已处置"]
const stats = [{"label": "本月巡检次数", "value": 0}, {"label": "已巡检站点", "value": 0}, {"label": "待处置故障", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewItems = ref<ReviewTodo[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatDateText(iso: string): string {
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

function reloadReviewTodos() {
  reviewItems.value = reviewTodos('inspection')
}

function finishTodo(id: number) {
  const result = finishReviewTodo(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadReviewTodos()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadReviewTodos()
})
</script>
