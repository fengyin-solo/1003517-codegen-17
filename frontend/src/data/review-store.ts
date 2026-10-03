import type { ReviewTodo } from './types'

// 临期台账确认后生成的核查事项，独立于各业务模块的记录，存在单独的键里。
// 同一来源同一目标只保留一条，重复确认台账不会重复生成。
const REVIEW_STORAGE_KEY = 'hydrology-monitor-station:review-todos'

function readStorage(): ReviewTodo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ReviewTodo[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(todos: ReviewTodo[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(todos))
  }
}

// 台账确认时调用：目标待办已存在就原样返回（幂等），不存在才新增。
export function ensureReviewTodo(input: {
  source: string
  target: ReviewTodo['target']
  title: string
  detail: string
}): { todo: ReviewTodo; created: boolean } {
  const todos = readStorage()
  const existed = todos.find(
    (item) => item.source === input.source && item.target === input.target,
  )
  if (existed) {
    return { todo: existed, created: false }
  }
  const todo: ReviewTodo = {
    id: todos.length ? Math.max(...todos.map((item) => item.id)) + 1 : 1,
    source: input.source,
    target: input.target,
    title: input.title,
    detail: input.detail,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: '',
  }
  persist([...todos, todo])
  return { todo, created: true }
}

export function listReviewTodos(target: ReviewTodo['target']): ReviewTodo[] {
  return readStorage()
    .filter((item) => item.target === target)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function completeReviewTodo(id: number): ReviewTodo | null {
  const todos = readStorage()
  const index = todos.findIndex((item) => item.id === id)
  if (index < 0) {
    return null
  }
  if (!todos[index].done) {
    todos[index] = {
      ...todos[index],
      done: true,
      completedAt: new Date().toISOString(),
    }
    persist(todos)
  }
  return todos[index]
}

export function resetReviewTodos(): ReviewTodo[] {
  persist([])
  return []
}
