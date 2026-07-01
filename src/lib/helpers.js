// Asana 색상 이름 → hex
const ASANA_COLORS = {
  'dark-pink': '#ec4899', magenta: '#db2777', 'dark-red': '#dc2626', red: '#ef4444',
  orange: '#f97316', 'dark-orange': '#ea580c', 'light-orange': '#fb923c',
  yellow: '#eab308', 'yellow-orange': '#f59e0b', 'dark-green': '#16a34a',
  green: '#22c55e', 'light-green': '#4ade80', 'dark-teal': '#0d9488', teal: '#14b8a6',
  'light-teal': '#2dd4bf', 'dark-blue': '#2563eb', blue: '#3b82f6', 'light-blue': '#60a5fa',
  'dark-purple': '#7c3aed', purple: '#8b5cf6', 'light-purple': '#a78bfa',
  'dark-warm-gray': '#78716c', 'light-warm-gray': '#a8a29e', 'cool-gray': '#64748b',
  indigo: '#6366f1', none: '#94a3b8', null: '#94a3b8',
}

const STATUS_PALETTE = ['#f18f1a', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6']

export function asanaColorToHex(name) {
  if (!name) return '#f18f1a'
  if (name.startsWith('#')) return name
  return ASANA_COLORS[name] || '#f18f1a'
}

// 프로젝트별 안정적인 기본 색상 (gid 해시 기반)
export function colorForKey(key) {
  let h = 0
  const s = String(key || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return STATUS_PALETTE[h % STATUS_PALETTE.length]
}

// Asana 커스텀필드 '상태' enum (표시 순서) + 점 색상
export const STATUS_ORDER = ['해야 할 일', '아이디어', '진행 중', '완료', '보류', '폐기']
const STATUS_DOT = {
  '완료': 'bg-emerald-500',
  '진행 중': 'bg-blue-500',
  '보류': 'bg-amber-500',
  '폐기': 'bg-rose-400',
  '아이디어': 'bg-violet-400',
  '해야 할 일': 'bg-slate-300',
}

// 태스크의 표시 상태/진척/색상 (커스텀필드 '상태' 우선, 없으면 completed 기반)
export function effectiveStatus(task) {
  if (task.status) return task.status
  return task.completed ? '완료' : '해야 할 일'
}

export function effectiveProgress(task) {
  if (task.progress !== null && task.progress !== undefined) return task.progress
  if (effectiveStatus(task) === '완료') return 100
  return task.completed ? 100 : 0
}

export function effectiveColor(task, projectColor) {
  return task.color || projectColor || '#f18f1a'
}

export function statusDotClass(status) {
  return STATUS_DOT[status] || 'bg-slate-300'
}

// 상태를 막대 표현용 그룹으로 분류 (진행 중 / 완료 / 보류 / 준비 / 폐기)
export function statusKind(status) {
  if (status === '완료') return 'done'
  if (status === '진행 중') return 'progress'
  if (status === '폐기') return 'dropped'
  if (status === '보류') return 'hold'
  return 'pending' // 해야 할 일, 아이디어 등
}

// hex(#rgb·#rrggbb) → rgba(...) 문자열. 막대 톤/투명도 조절에 사용
export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || '#f18f1a').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// 태스크의 간트 표시용 시작/종료 날짜를 보정해서 반환 (둘 다 없으면 null)
export function taskDateRange(task) {
  let s = task.start_on ? new Date(task.start_on) : null
  let e = task.due_on ? new Date(task.due_on) : null
  if (!s && !e) return null
  if (!s) s = e
  if (!e) e = s
  if (s > e) e = s
  return { start: s, end: e }
}

export function fmtMd(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function getWeekOfMonth(date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1)
  return Math.ceil((date.getDate() + firstDay.getDay()) / 7)
}
