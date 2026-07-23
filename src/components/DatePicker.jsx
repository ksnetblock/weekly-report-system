import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react'

// 단일 날짜를 달력에서 골라 변경하는 팝오버 선택기
//   value: 'YYYY-MM-DD' 문자열(비면 '')
//   onChange(nextDateStr)

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseYmd(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function fmtLabel(s) {
  const d = parseYmd(s)
  if (!d) return ''
  const base = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  return `${base} (${WEEKDAYS[d.getDay()]})`
}

export default function DatePicker({ value, onChange, className = '' }) {
  const valueD = parseYmd(value)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => startOfDay(valueD || new Date()))
  const ref = useRef(null)

  // 열 때 선택된 날짜가 있는 달로 이동
  useEffect(() => {
    if (open) setView(startOfDay(valueD || new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 바깥 클릭 / ESC 로 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const startOffset = first.getDay() // 0=일
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - startOffset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [view])

  const pickDay = (day) => {
    onChange(ymd(startOfDay(day)))
    setOpen(false)
  }

  const monthLabel = `${view.getFullYear()}년 ${view.getMonth() + 1}월`

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
        <CalendarRange className="w-4 h-4 shrink-0" />
        보고일 <span className="font-semibold text-slate-700 dark:text-slate-200">{value ? fmtLabel(value) : '날짜 선택'}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-[280px]">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{monthLabel}</span>
            <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`text-center text-[11px] font-bold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{w}</div>
            ))}
            {cells.map((d, i) => {
              const other = d.getMonth() !== view.getMonth()
              const selected = sameDay(d, valueD)
              const dow = d.getDay()
              return (
                <div key={i} className="flex items-center justify-center">
                  <button type="button" onClick={() => pickDay(d)}
                    className={`w-8 h-8 rounded-full text-xs transition
                      ${selected ? 'bg-indigo-600 text-white font-bold' : other ? 'text-slate-300 dark:text-slate-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-slate-700 dark:text-slate-200'}
                      ${!selected ? 'hover:bg-slate-100 dark:hover:bg-slate-700' : ''}`}>
                    {d.getDate()}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-end mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
