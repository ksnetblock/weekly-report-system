import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react'

// 하나의 달력에서 시작~종료를 한 번에 고르는 기간 선택기 (호텔 예약 스타일)
//   value: { start, end } ('YYYY-MM-DD' 문자열, 비면 '')
//   onChange({ start, end })

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
  return `${base}(${WEEKDAYS[d.getDay()]})`
}

export default function DateRangePicker({ value, onChange, className = '' }) {
  const { start = '', end = '' } = value || {}
  const startD = parseYmd(start)
  const endD = parseYmd(end)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => startOfDay(startD || new Date()))
  const [hover, setHover] = useState(null)
  const ref = useRef(null)

  // 열 때 시작일이 있는 달로 이동
  useEffect(() => {
    if (open) setView(startOfDay(startD || new Date()))
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
    const d = startOfDay(day)
    // 시작만 정해진 상태면 종료를 확정, 아니면 새로 시작
    if (startD && !endD) {
      if (d < startD) onChange({ start: ymd(d), end: ymd(startD) })
      else onChange({ start: ymd(startD), end: ymd(d) })
      setOpen(false)
    } else {
      onChange({ start: ymd(d), end: '' })
      setHover(null)
    }
  }

  // 범위(진행 중이면 hover까지) 판정
  const rangeEnd = endD || (startD && !endD ? hover : null)
  const inRange = (d) => {
    if (!startD || !rangeEnd) return false
    const lo = startD <= rangeEnd ? startD : rangeEnd
    const hi = startD <= rangeEnd ? rangeEnd : startD
    return d > lo && d < hi
  }
  const isStart = (d) => sameDay(d, startD) || (startD && rangeEnd && sameDay(d, startD <= rangeEnd ? startD : rangeEnd))
  const isEnd = (d) => sameDay(d, endD) || (startD && rangeEnd && sameDay(d, startD <= rangeEnd ? rangeEnd : startD))

  const label = start
    ? `${fmtLabel(start)} ~ ${end ? fmtLabel(end) : '종료일 선택'}`
    : '기간 선택'

  const monthLabel = `${view.getFullYear()}년 ${view.getMonth() + 1}월`

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full inline-flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition">
        <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
        <span className={`truncate ${start ? '' : 'text-slate-400'}`}>{label}</span>
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
              const start_ = isStart(d)
              const end_ = isEnd(d)
              const edge = start_ || end_
              const mid = !edge && inRange(d)
              const dow = d.getDay()
              return (
                <div key={i}
                  className={`relative flex items-center justify-center ${mid ? 'bg-indigo-100 dark:bg-indigo-950/50' : ''} ${start_ && (endD || (startD && hover && !sameDay(startD, hover))) ? 'bg-gradient-to-r from-transparent to-indigo-100 dark:to-indigo-950/50' : ''} ${end_ ? 'bg-gradient-to-l from-transparent to-indigo-100 dark:to-indigo-950/50' : ''}`}>
                  <button type="button"
                    onClick={() => pickDay(d)}
                    onMouseEnter={() => startD && !endD && setHover(startOfDay(d))}
                    className={`w-8 h-8 rounded-full text-xs transition
                      ${edge ? 'bg-indigo-600 text-white font-bold' : mid ? 'text-indigo-700 dark:text-indigo-200' : other ? 'text-slate-300 dark:text-slate-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-slate-700 dark:text-slate-200'}
                      ${!edge ? 'hover:bg-slate-100 dark:hover:bg-slate-700' : ''}`}>
                    {d.getDate()}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <span className="text-[11px] text-slate-400">
              {start && !end ? '종료일을 선택하세요' : start ? '완료' : '시작일을 선택하세요'}
            </span>
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
