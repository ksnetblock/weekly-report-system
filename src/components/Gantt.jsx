import { useMemo, useState, useEffect, useRef } from 'react'
import {
  ChevronRight, ChevronDown, User, Edit3, Trash2, Plus, Folder,
  FolderKanban, Layers, FolderSearch, Check, CalendarCheck,
} from 'lucide-react'
import {
  taskDateRange, effectiveStatus, effectiveColor,
  asanaColorToHex, colorForKey, fmtMd, getWeekOfMonth,
  hexToRgba,
} from '../lib/helpers.js'

const META_W = 360 // 좌측 메타 패널 폭(px)
const ROW_H = 64

export default function Gantt({
  groups, projects, sections, tasks, scale, levelFilter = 'task',
  onEditTask, onDeleteTask, onAddTask, onEditGroup, onEditProject, onEditSection,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())

  useEffect(() => {
    if (levelFilter === 'project') {
      setCollapsed(new Set(projects.map((p) => `project:${p.id}`)))
    } else if (levelFilter === 'section') {
      setCollapsed(new Set(sections.map((s) => `section:${s.id}`)))
    } else {
      setCollapsed(new Set())
    }
  }, [levelFilter, projects, sections])

  // 각 노드의 하위 접힘 키들(그룹→프로젝트·섹션, 프로젝트→섹션)
  const descendantKeys = useMemo(() => {
    const map = new Map()
    const secByProj = new Map()
    for (const s of sections) {
      if (!secByProj.has(s.project_id)) secByProj.set(s.project_id, [])
      secByProj.get(s.project_id).push(s)
    }
    const projByGroup = new Map()
    for (const p of projects) {
      const gid = groups.some((g) => g.id === p.group_id) ? p.group_id : '__ungrouped__'
      if (!projByGroup.has(gid)) projByGroup.set(gid, [])
      projByGroup.get(gid).push(p)
    }
    for (const p of projects) {
      map.set(`project:${p.id}`, (secByProj.get(p.id) || []).map((s) => `section:${s.id}`))
    }
    for (const g of [...groups, { id: '__ungrouped__' }]) {
      const keys = []
      for (const p of projByGroup.get(g.id) || []) {
        keys.push(`project:${p.id}`)
        for (const s of secByProj.get(p.id) || []) keys.push(`section:${s.id}`)
      }
      map.set(`group:${g.id}`, keys)
    }
    return map
  }, [groups, projects, sections])

  const toggle = (key) =>
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(key)) {
        // 펼치기: 바로 아래 한 단계만 보이도록 하위는 모두 접음
        n.delete(key)
        for (const d of descendantKeys.get(key) || []) n.add(d)
      } else {
        n.add(key)
      }
      return n
    })

  // ── 트리/행 구성 ───────────────────────────────────────────────────
  const { rows, range } = useMemo(
    () => buildRows({ groups, projects, sections, tasks, collapsed }),
    [groups, projects, sections, tasks, collapsed]
  )

  // ── 타임라인 너비/헤더 계산 ───────────────────────────────────────
  const { totalMs, minDate, maxDate } = range
  const timeline = useMemo(() => buildTimeline(minDate, maxDate, scale), [minDate, maxDate, scale])
  const timelineWidth = timeline.width

  const todayLeft = useMemo(() => {
    const now = new Date()
    if (now < minDate || now > maxDate) return null
    return ((now.getTime() - minDate.getTime()) / totalMs) * 100
  }, [minDate, maxDate, totalMs])

  const scrollRef = useRef(null)

  const scrollToToday = () => {
    if (todayLeft === null) return
    const el = scrollRef.current
    if (!el) return
    const target = (todayLeft / 100) * timelineWidth - (el.clientWidth - META_W) / 2
    el.scrollLeft = target
  }

  // 최초 렌더 및 기간(scale) 변경 시 오늘 날짜로 자동 스크롤
  useEffect(() => {
    scrollToToday()
  }, [scale, timelineWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  if (tasks.length === 0) {
    return <EmptyState onAddTask={onAddTask} />
  }

  const pct = (date) => ((date.getTime() - minDate.getTime()) / totalMs) * 100

  function barGeom(dr) {
    let left = pct(dr.start)
    let width = pct(dr.end) - left
    if (left < 0) { width += left; left = 0 }
    if (left + width > 100) width = 100 - left
    if (width <= 0) width = 0.6
    return { left, width }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <StatusLegend onScrollToToday={todayLeft === null ? null : scrollToToday} />
      <div ref={scrollRef} className="overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 160px)', minHeight: 500 }}>
        <div style={{ minWidth: META_W + timelineWidth }}>
          {/* 헤더 */}
          <div className="flex sticky top-0 z-20 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur border-b border-slate-200 dark:border-slate-700">
            <div
              className="flex-shrink-0 sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex items-center px-4 h-16 font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400"
              style={{ width: META_W }}
            >
              프로젝트 / 업무 명세
            </div>
            <div className="relative h-16" style={{ width: timelineWidth }}>
              <div className="flex h-7 border-b border-slate-100 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {timeline.upper.map((u, i) => (
                  <div key={i} className="flex items-center justify-center border-r border-slate-100 dark:border-slate-700"
                       style={{ width: u.width }}>
                    {u.label}
                  </div>
                ))}
              </div>
              <div className="flex h-9 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                {timeline.lower.map((l, i) => (
                  <div key={i}
                       className={`flex flex-col items-center justify-center border-r border-slate-100 dark:border-slate-700 ${l.weekend ? 'bg-red-50/40 dark:bg-red-950/20 text-red-400 dark:text-red-500' : ''}`}
                       style={{ width: l.width }}>
                    {l.top && <span className="text-[9px] text-slate-400 dark:text-slate-500">{l.top}</span>}
                    <span className={l.bold ? 'font-bold text-slate-600 dark:text-slate-300' : ''}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 행 */}
          {rows.map((row) => (
            <Row
              key={row.key}
              row={row}
              collapsed={collapsed}
              toggle={toggle}
              timelineWidth={timelineWidth}
              barGeom={barGeom}
              pct={pct}
              todayLeft={todayLeft}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onEditGroup={onEditGroup}
              onEditProject={onEditProject}
              onEditSection={onEditSection}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

// ── 개별 행 ──────────────────────────────────────────────────────────
function Row({ row, collapsed, toggle, timelineWidth, barGeom, pct, todayLeft,
              onEditTask, onDeleteTask, onEditGroup, onEditProject, onEditSection }) {
  const isCollapsed = collapsed.has(row.key)

  // 좌측 메타
  let meta
  if (row.type === 'group') {
    meta = (
      <div className="flex items-center gap-2 w-full group/row" style={{ paddingLeft: 12 }}>
        <button onClick={() => toggle(row.key)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: row.color }} />
        <Folder className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <span className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{row.name}</span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">{row.projectCount}개 프로젝트</span>
        {onEditGroup && row.id !== '__ungrouped__' && (
          <button onClick={() => onEditGroup(row.data)}
                  className="ml-auto opacity-0 group-hover/row:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  } else if (row.type === 'project') {
    meta = (
      <div className="flex items-center gap-2 w-full group/row" style={{ paddingLeft: 30 }}>
        <button onClick={() => toggle(row.key)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
        <FolderKanban className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
        <span className="font-semibold text-[13px] text-slate-700 dark:text-slate-200 truncate">{row.name}</span>
        {row.owner && <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">· {row.owner}</span>}
        {onEditProject && (
          <button onClick={() => onEditProject(row.data)}
                  className="ml-auto opacity-0 group-hover/row:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title="그룹 배정 / 색상">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  } else if (row.type === 'section') {
    meta = (
      <div className="flex items-center gap-2 w-full group/row" style={{ paddingLeft: 44 }}>
        <button onClick={() => toggle(row.key)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <Layers className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 flex-shrink-0" />
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{row.name}</span>
        <span className="text-[10px] text-slate-300 dark:text-slate-600">{row.taskCount}</span>
        {onEditSection && (
          <button onClick={() => onEditSection(row.data)}
                  className="ml-auto opacity-0 group-hover/row:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title="섹션 날짜 설정">
            <Edit3 className="w-3 h-3" />
          </button>
        )}
      </div>
    )
  } else {
    // task
    const t = row.data
    const status = effectiveStatus(t)
    meta = (
      <div className="flex items-center justify-between w-full group/row" style={{ paddingLeft: 60 }}>
        <div className="flex flex-col min-w-0 pr-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-slate-700 dark:text-slate-200 truncate" title={t.name}>{t.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-300">
              <User className="w-3 h-3" />{t.assignee || '미지정'}
            </span>
            <span className="inline-flex items-center bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-300">
              {status}
            </span>
            {row.dr && (
              <span>{+row.dr.start === +row.dr.end ? `~${fmtMd(row.dr.end)}` : `${fmtMd(row.dr.start)} ~ ${fmtMd(row.dr.end)}`}</span>
            )}
            {!row.dr && <span className="text-slate-300 dark:text-slate-600">일정 미정</span>}
          </div>
        </div>
        {(onEditTask || onDeleteTask) && (
          <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 flex-shrink-0">
            {onEditTask && (
              <button onClick={() => onEditTask(t)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 rounded" title="편집">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
            {onDeleteTask && (
              <button onClick={() => onDeleteTask(t)} className="p-1 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 dark:text-red-400 rounded" title="삭제">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // 우측 타임라인 셀
  const rowBg =
    row.type === 'group' ? 'bg-slate-100 dark:bg-slate-700/60'
    : row.type === 'project' ? 'bg-slate-50 dark:bg-slate-800/60'
    : row.type === 'section' ? 'bg-white dark:bg-slate-800' : 'bg-white dark:bg-slate-800 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20'

  // 메타 패널은 항상 완전 불투명해야 차트 바가 비쳐 보이지 않음
  const metaBg =
    row.type === 'group' ? 'bg-slate-100 dark:bg-slate-700'
    : row.type === 'project' ? 'bg-slate-50 dark:bg-slate-800'
    : 'bg-white dark:bg-slate-800'

  return (
    <div className={`flex border-b border-slate-100 dark:border-slate-700 ${rowBg} transition`} style={{ height: ROW_H }}>
      <div className={`flex-shrink-0 sticky left-0 z-20 border-r border-slate-200 dark:border-slate-700 flex items-center ${metaBg}`}
           style={{ width: META_W }}>
        {meta}
      </div>
      <div className="relative" style={{ width: timelineWidth }}>
        {todayLeft !== null && (
          <div className="absolute top-0 bottom-0 w-px bg-red-400/50 z-0" style={{ left: `${todayLeft}%` }} />
        )}
        {/* 태스크: 마감일 지점에 네모(완료/예정), 프로젝트·섹션: 롤업 막대 */}
        {row.type === 'task' && row.dr && row.data.due_on && (
          <TaskMarker t={row.data} dr={row.dr} pct={pct} />
        )}
        {(row.type === 'project' || row.type === 'section') && row.agg && (
          <RollupBar geom={barGeom(row.agg)} color={row.color}
            thickness={row.type === 'project' ? 22 : 13}
            bgAlpha={row.type === 'project' ? 0.65 : 0.22}
            borderAlpha={row.type === 'project' ? 0.9 : 0.45} />
        )}
      </div>
    </div>
  )
}

// 태스크는 시작일이 없으므로 마감일 한 지점에 네모를 그리고,
// 완료 여부에 따라 '완료'/'예정'을 표시한다.
function TaskMarker({ t, dr, pct }) {
  const color = effectiveColor(t, t._projectColor)
  const done = effectiveStatus(t) === '완료'
  const left = pct(dr.end)
  const label = done ? '완료' : '예정'

  const base = {
    left: `${left}%`,
    top: '50%',
    transform: 'translate(-50%, -50%)',
    height: 34,
  }
  const cls = 'absolute z-10 flex items-center justify-center gap-1 px-2.5 rounded-md text-[11px] font-bold whitespace-nowrap'

  // ── 완료: 꽉 찬 솔리드 네모 + 체크 ───────────────────────────────
  if (done) {
    return (
      <div className={`${cls} text-white shadow-sm`}
        style={{ ...base, background: hexToRgba(color, 0.95),
                 boxShadow: `inset 0 0 0 1px ${hexToRgba(color, 1)}, 0 1px 2px rgba(0,0,0,.08)` }}
        title={`${t.name} · 마감 ${fmtMd(dr.end)} · 완료`}>
        <Check className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
        <span>{label}</span>
      </div>
    )
  }

  // ── 예정: 점선 테두리 + 반투명 배경 ───────────────────────────────
  return (
    <div className={cls}
      style={{ ...base, backgroundColor: hexToRgba(color, 0.06),
               border: `1.5px dashed ${hexToRgba(color, 0.6)}`,
               color: hexToRgba(color, 0.85) }}
      title={`${t.name} · 마감 ${fmtMd(dr.end)} · 예정`}>
      <span>{label}</span>
    </div>
  )
}

function RollupBar({ geom, color, thickness = 8, bgAlpha = 0.28, borderAlpha = 0.5 }) {
  const radius = Math.round(thickness / 3)
  return (
    <div className="absolute top-1/2 -translate-y-1/2"
         style={{ left: `${geom.left}%`, width: `${geom.width}%`, height: thickness,
                  borderRadius: radius,
                  background: hexToRgba(color, bgAlpha),
                  boxShadow: `inset 0 0 0 1.5px ${hexToRgba(color, borderAlpha)}` }} />
  )
}

// 태스크 마감 네모 / 롤업 막대 표현을 설명하는 범례
function StatusLegend({ onScrollToToday }) {
  const items = [
    { key: 'done', label: '완료', sample: (
      <span className="inline-flex items-center justify-center gap-0.5 px-1.5 h-4 rounded-md text-white text-[8px] font-bold" style={{ background: hexToRgba('#10b981', 0.95) }}>
        <Check className="w-2.5 h-2.5" strokeWidth={3} />완료
      </span>
    ) },
    { key: 'planned', label: '예정', sample: (
      <span className="inline-flex items-center justify-center px-1.5 h-4 rounded-md text-[8px] font-bold" style={{
        backgroundColor: hexToRgba('#3b82f6', 0.06),
        border: `1.5px dashed ${hexToRgba('#3b82f6', 0.6)}`,
        color: hexToRgba('#3b82f6', 0.85),
      }}>예정</span>
    ) },
    { key: 'rollup-project', label: '프로젝트 기간', sample: (
      <span className="inline-flex w-12 rounded-sm" style={{ height: 10, background: hexToRgba('#f18f1a', 0.28), boxShadow: `inset 0 0 0 1.5px ${hexToRgba('#f18f1a', 0.5)}`, borderRadius: 3 }} />
    ) },
    { key: 'rollup-section', label: '섹션 기간', sample: (
      <span className="inline-flex w-12" style={{ height: 6, background: hexToRgba('#f18f1a', 0.28), boxShadow: `inset 0 0 0 1.5px ${hexToRgba('#f18f1a', 0.5)}`, borderRadius: 2 }} />
    ) },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">상태 범례</span>
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          {it.sample}{it.label}
        </span>
      ))}
      {onScrollToToday && (
        <button
          onClick={onScrollToToday}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/60 hover:border-red-400 transition"
          title="오늘 날짜 위치로 이동"
        >
          <CalendarCheck className="w-3.5 h-3.5" />
          오늘
        </button>
      )}
    </div>
  )
}

function EmptyState({ onAddTask }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center py-20">
      <FolderSearch className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">표시할 업무가 없습니다.</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Asana 데이터를 가져오거나 필터를 확인하세요.</p>
      {onAddTask && (
        <button onClick={() => onAddTask()} className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline">
          <Plus className="w-4 h-4" /> 새 업무 추가
        </button>
      )}
    </div>
  )
}

// ── 트리 → 행 리스트 ─────────────────────────────────────────────────
function buildRows({ groups, projects, sections, tasks, collapsed }) {
  const tasksByProject = new Map()
  const tasksBySection = new Map()
  for (const t of tasks) {
    if (!tasksByProject.has(t.project_id)) tasksByProject.set(t.project_id, [])
    tasksByProject.get(t.project_id).push(t)
    const sk = t.section_id || `__nosec_${t.project_id}`
    if (!tasksBySection.has(sk)) tasksBySection.set(sk, [])
    tasksBySection.get(sk).push(t)
  }

  const projColor = (p) =>
    p.color || (p.asana_color ? asanaColorToHex(p.asana_color) : colorForKey(p.asana_gid || p.id))
  // 프로젝트별 섹션
  const sectionsByProject = new Map()
  for (const s of sections) {
    if (!sectionsByProject.has(s.project_id)) sectionsByProject.set(s.project_id, [])
    sectionsByProject.get(s.project_id).push(s)
  }

  // 그룹 구성 (미분류 포함)
  const groupList = [
    ...groups,
    { id: '__ungrouped__', name: '미분류', color: '#94a3b8' },
  ]
  const projByGroup = new Map()
  for (const p of projects) {
    const gid = groups.some((g) => g.id === p.group_id) ? p.group_id : '__ungrouped__'
    if (!projByGroup.has(gid)) projByGroup.set(gid, [])
    projByGroup.get(gid).push(p)
  }

  const rows = []
  let allRanges = []

  for (const g of groupList) {
    const gp = projByGroup.get(g.id) || []
    // 보이는 태스크가 있는 프로젝트만
    const visibleProjects = gp.filter((p) => (tasksByProject.get(p.id) || []).length > 0)
    if (visibleProjects.length === 0) continue

    const gColor = g.color || '#94a3b8'
    const gKey = `group:${g.id}`
    const groupTasks = visibleProjects.flatMap((p) => tasksByProject.get(p.id) || [])
    const gAgg = aggregateRange(groupTasks)
    if (gAgg) allRanges.push(gAgg)
    rows.push({
      key: gKey, type: 'group', id: g.id, name: g.name, color: gColor,
      projectCount: visibleProjects.length, data: g, agg: gAgg,
    })
    if (collapsed.has(gKey)) continue

    for (const p of visibleProjects) {
      const pColor = projColor(p)
      const pKey = `project:${p.id}`
      const pTasks = tasksByProject.get(p.id) || []
      const pAgg = manualOrAgg(p.start_on, p.due_on, pTasks, allRanges)
      rows.push({
        key: pKey, type: 'project', id: p.id, name: p.name, color: pColor,
        owner: p.owner_name, data: { ...p, _color: pColor }, agg: pAgg,
      })
      if (collapsed.has(pKey)) continue

      const secs = sectionsByProject.get(p.id) || []
      // 섹션이 있으면 섹션별, 없으면 바로 태스크
      const renderTaskRows = (list) => {
        for (const t of list) {
          const dr = taskDateRange(t)
          if (dr) allRanges.push(dr)
          rows.push({
            key: `task:${t.id}`, type: 'task',
            data: { ...t, _projectColor: pColor }, dr,
          })
        }
      }

      let placed = 0
      for (const s of secs) {
        const sTasks = (tasksBySection.get(s.id) || []).filter((t) => t.project_id === p.id)
        if (sTasks.length === 0) continue
        const sKey = `section:${s.id}`
        const sAgg = manualOrAgg(s.start_on, s.due_on, sTasks, allRanges)
        const sEffStart = sAgg?.start?.toISOString().slice(0, 10) ?? null
        const sEffEnd = sAgg?.end?.toISOString().slice(0, 10) ?? null
        rows.push({ key: sKey, type: 'section', id: s.id, name: s.name, taskCount: sTasks.length, data: { ...s, _eff_start: sEffStart, _eff_end: sEffEnd }, color: pColor, agg: sAgg })
        placed += sTasks.length
        if (collapsed.has(sKey)) continue
        renderTaskRows(sTasks)
      }
      // 섹션 없는 태스크
      const noSec = (tasksByProject.get(p.id) || []).filter((t) => !t.section_id)
      if (noSec.length) renderTaskRows(noSec)
    }
  }

  const range = computeRange(allRanges)
  return { rows, range }
}

// 수동 날짜가 있으면 그걸 쓰고, 없으면 태스크 집계. 수동 날짜는 allRanges에도 추가.
function manualOrAgg(startOn, dueOn, taskList, allRanges) {
  if (startOn || dueOn) {
    const s = startOn ? new Date(startOn) : new Date(dueOn)
    const e = dueOn ? new Date(dueOn) : new Date(startOn)
    const dr = { start: s, end: e }
    allRanges.push(dr)
    return dr
  }
  return aggregateRange(taskList)
}

function aggregateRange(taskList) {
  let min = null, max = null
  for (const t of taskList) {
    const dr = taskDateRange(t)
    if (!dr) continue
    if (!min || dr.start < min) min = dr.start
    if (!max || dr.end > max) max = dr.end
  }
  if (!min) return null
  return { start: min, end: max, isMilestone: false }
}

function computeRange(ranges) {
  let min = null, max = null
  for (const r of ranges) {
    if (!min || r.start < min) min = r.start
    if (!max || r.end > max) max = r.end
  }
  if (!min) {
    const today = new Date()
    min = new Date(today)
    max = new Date(today)
  }
  min = new Date(min); max = new Date(max)
  // 데이터 유무와 무관하게 앞뒤로 1년씩 여유를 둬서 더 스크롤할 수 있게 한다.
  min.setFullYear(min.getFullYear() - 1)
  max.setFullYear(max.getFullYear() + 1)
  return { minDate: min, maxDate: max, totalMs: max.getTime() - min.getTime() }
}

// ── 타임라인 헤더/너비 ───────────────────────────────────────────────
function buildTimeline(minDate, maxDate, scale) {
  const totalDays = Math.ceil((maxDate - minDate) / 86400000)
  const upper = []
  const lower = []
  let width = 0

  if (scale === 'day') {
    const colW = 44
    const monthSpans = {}
    for (let i = 0; i < totalDays; i++) {
      const cur = new Date(minDate); cur.setDate(minDate.getDate() + i)
      const weekend = cur.getDay() === 0 || cur.getDay() === 6
      lower.push({
        width: colW, weekend,
        top: `${cur.getMonth() + 1}/${cur.getDate()}`,
        label: ['일', '월', '화', '수', '목', '금', '토'][cur.getDay()],
        bold: weekend,
      })
      const mk = `${cur.getFullYear()}-${cur.getMonth()}`
      monthSpans[mk] = (monthSpans[mk] || 0) + colW
    }
    for (const [mk, w] of Object.entries(monthSpans)) {
      const [y, m] = mk.split('-')
      upper.push({ width: w, label: `${y}년 ${Number(m) + 1}월` })
    }
    width = totalDays * colW
  } else if (scale === 'week') {
    const colW = 96
    const totalWeeks = Math.ceil(totalDays / 7)
    const monthSpans = {}
    for (let i = 0; i < totalWeeks; i++) {
      const cur = new Date(minDate); cur.setDate(minDate.getDate() + i * 7)
      lower.push({ width: colW, label: `${cur.getMonth() + 1}월 ${getWeekOfMonth(cur)}주`, weekend: false })
      const mk = `${cur.getFullYear()}-${cur.getMonth()}`
      monthSpans[mk] = (monthSpans[mk] || 0) + colW
    }
    for (const [mk, w] of Object.entries(monthSpans)) {
      const [y, m] = mk.split('-')
      upper.push({ width: w, label: `${y}년 ${Number(m) + 1}월` })
    }
    width = totalWeeks * colW
  } else if (scale === 'year') {
    const colW = 88
    const sY = minDate.getFullYear()
    const sQ = Math.floor(minDate.getMonth() / 3)
    const eY = maxDate.getFullYear()
    const eQ = Math.floor(maxDate.getMonth() / 3)
    const totalQuarters = (eY - sY) * 4 + (eQ - sQ) + 1
    const yearSpans = {}
    for (let i = 0; i < totalQuarters; i++) {
      const q = (sQ + i) % 4
      const y = sY + Math.floor((sQ + i) / 4)
      lower.push({ width: colW, label: `${q + 1}분기`, weekend: false })
      yearSpans[y] = (yearSpans[y] || 0) + colW
    }
    for (const [y, w] of Object.entries(yearSpans)) {
      upper.push({ width: w, label: `${y}년` })
    }
    width = totalQuarters * colW
  } else {
    const colW = 130
    const sY = minDate.getFullYear(), sM = minDate.getMonth()
    const totalMonths = (maxDate.getFullYear() - sY) * 12 + (maxDate.getMonth() - sM) + 1
    const yearSpans = {}
    for (let i = 0; i < totalMonths; i++) {
      const cur = new Date(sY, sM + i, 1)
      lower.push({ width: colW, label: `${cur.getMonth() + 1}월`, weekend: false })
      yearSpans[cur.getFullYear()] = (yearSpans[cur.getFullYear()] || 0) + colW
    }
    for (const [y, w] of Object.entries(yearSpans)) {
      upper.push({ width: w, label: `${y}년` })
    }
    width = totalMonths * colW
  }

  return { upper, lower, width: Math.max(width, 600) }
}
