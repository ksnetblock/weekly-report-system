import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  RefreshCw, Trash2, FilePlus2, Download, Save, CloudDownload, Loader2,
  CheckCircle2, CalendarRange, Eye, ChevronRight, Sparkles, Settings2, RotateCcw,
} from 'lucide-react'
import * as api from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import RichEditor from '../components/RichEditor.jsx'
import TaskDetailModal from '../components/TaskDetailModal.jsx'
import DateRangePicker from '../components/DateRangePicker.jsx'
import DatePicker from '../components/DatePicker.jsx'
import {
  defaultReportPeriod, defaultReportDate, toBoundaryISO, groupChanges, sectionsToHtml,
  weeklyReportTitle, NO_CHANGE, buildCheckedTasksText, AI_MODELS, DEFAULT_AI_SYSTEM_PROMPT, DEFAULT_AI_FEWSHOT,
} from '../lib/weekly.js'
import { exportReportDocx } from '../lib/exportDocx.js'

// ── AI 설정 기본값 (실제 값은 DB에서 로드 · 팀 공유) ─────────────────
function defaultAiSettings() {
  return { model: AI_MODELS[0].id, systemPrompt: DEFAULT_AI_SYSTEM_PROMPT, fewShot: DEFAULT_AI_FEWSHOT }
}

function blankReport() {
  const d = defaultReportDate() // 보고일(하루) = 다가올 화요일
  return { id: null, title: weeklyReportTitle(), report_date: d, html: '' }
}

// 저장본 content → 편집기 HTML (신규는 html, 구버전은 sections 구조를 변환)
function contentToHtml(content) {
  if (!content) return ''
  if (typeof content.html === 'string') return content.html
  if (Array.isArray(content.sections)) return sectionsToHtml(content.sections, content.footer)
  return ''
}

// 주간보고 작성 페이지 — 좌: Asana 변화 태스크 / 우: Tiptap 리치텍스트 편집기 + DOCX
export default function WeeklyPage({ onAuthError }) {
  const toast = useToast()
  const editorRef = useRef(null)

  const [reports, setReports] = useState([])
  const [report, setReport] = useState(blankReport)

  const [period, setPeriod] = useState(() => defaultReportPeriod())
  const [excludeMeetings, setExcludeMeetings] = useState(true)
  const [excludeArchived, setExcludeArchived] = useState(true)
  const [hideScheduleAssignee, setHideScheduleAssignee] = useState(true) // 일정/담당자 변경만 있는 태스크 제외 (기본 활성)

  const [changes, setChanges] = useState(null)
  const [allowedGids, setAllowedGids] = useState(null) // 필터 통과 프로젝트 gid — 좌측 표시 범위 제한
  const [loadingChanges, setLoadingChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailTask, setDetailTask] = useState(null) // { gid, name } — 상세 모달
  const [openGids, setOpenGids] = useState(() => new Set()) // 인라인 펼침 태스크
  const [activityByGid, setActivityByGid] = useState({})    // gid → { loading, error, items }

  // AI 초안 관련
  const [checkedGids, setCheckedGids] = useState(() => new Set()) // 초안에 포함할 체크된 태스크
  const [aiLoading, setAiLoading] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [includeActivity, setIncludeActivity] = useState(true) // 활동내역까지 AI에 전달
  const [aiSettings, setAiSettings] = useState(defaultAiSettings)
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false) // DB 로드 완료 전엔 저장 금지
  const [aiSaving, setAiSaving] = useState(false)

  // AI 설정을 DB에서 로드 (팀 공유). 비면 기본값 사용.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await api.getAiSettings()
        if (alive && s && typeof s === 'object') setAiSettings({ ...defaultAiSettings(), ...s })
      } catch (e) {
        onAuthError(e)
      } finally {
        if (alive) setAiSettingsLoaded(true)
      }
    })()
    return () => { alive = false }
  }, [onAuthError])

  // AI 설정 변경 시 DB에 자동 저장(디바운스) — 로드 완료 후에만
  useEffect(() => {
    if (!aiSettingsLoaded) return
    setAiSaving(true)
    const t = setTimeout(async () => {
      try { await api.setAiSettings(aiSettings) } catch { /* 저장 실패는 조용히 무시(다음 변경 때 재시도) */ }
      finally { setAiSaving(false) }
    }, 800)
    return () => clearTimeout(t)
  }, [aiSettings, aiSettingsLoaded])

  // 수동 레이어(그룹 · 프로젝트 메타) — 좌측 그룹핑/표시 이름에 사용
  const [manual, setManual] = useState({ groups: [], projectMeta: [] })

  const loadReports = useCallback(async () => {
    try {
      setReports(await api.listWeeklyReports())
    } catch (e) {
      onAuthError(e)
      toast('보고서 목록 실패', e.message, 'warning')
    }
  }, [toast, onAuthError])

  const loadManual = useCallback(async () => {
    try {
      const { groups, projectMeta } = await api.getManualLayer()
      setManual({ groups: groups || [], projectMeta: projectMeta || [] })
    } catch (e) {
      onAuthError(e)
      // 그룹 정보 로드 실패는 치명적이지 않음 — Asana 원래 이름으로 폴백
    }
  }, [onAuthError])

  useEffect(() => { loadReports(); loadManual() }, [loadReports, loadManual])

  // 변화 응답을 그룹 > 프로젝트 계층으로 (표시 이름/그룹은 수동 레이어 반영)
  // 수동 레이어(project_meta)는 등록된 모든 프로젝트를 담고 있으므로, 서버 필터
  // (회의록·보관됨 제외)를 통과한 gid 목록으로 제한해 회의록/보관 프로젝트가
  // '변동사항 없음'으로 표시되는 것을 막는다.
  const grouped = useMemo(() => {
    if (!changes) return null
    let meta = manual.projectMeta
    if (allowedGids) {
      const allow = new Set(allowedGids)
      meta = meta.filter((m) => allow.has(m.asana_gid))
    }
    return groupChanges(changes, manual.groups, meta)
  }, [changes, manual, allowedGids])

  // 표시/선택에 실제 사용할 목록 — '일정·담당자 변경만' 필터가 켜지면 해당 태스크(및 빈 프로젝트)를 제거.
  //   판정에는 각 태스크의 기간 내 변동내역(activity)이 필요하므로 '활동내역 포함'이 켜져 있어야 동작한다.
  const visibleGrouped = useMemo(() => {
    if (!grouped || !hideScheduleAssignee) return grouped
    return grouped.map((g) => ({
      ...g,
      projects: (g.projects || [])
        .map((p) => ({ ...p, tasks: (p.tasks || []).filter((t) => !isScheduleAssigneeOnly(t, activityByGid)) }))
        .filter((p) => p.tasks.length > 0),
    }))
  }, [grouped, hideScheduleAssignee, activityByGid])

  // ── 보고서 선택/생성/삭제 ───────────────────────────────────────────
  const onSelectReport = async (id) => {
    if (!id) {
      const b = blankReport()
      setReport(b)
      editorRef.current?.setContent('')
      setChanges(null)
      return
    }
    try {
      const w = await api.getWeeklyReport(id)
      if (!w) { toast('없음', '보고서를 찾을 수 없습니다.', 'warning'); return }
      const html = contentToHtml(w.content)
      setReport({
        id: w.id, title: w.title || '',
        report_date: w.report_date || '', html,
      })
      editorRef.current?.setContent(html)
    } catch (e) {
      onAuthError(e)
      toast('불러오기 실패', e.message, 'warning')
    }
  }

  const onNewReport = () => {
    setReport(blankReport())
    editorRef.current?.setContent('')
    setChanges(null)
  }

  const onDeleteReport = async () => {
    if (!report.id) return
    if (!confirm(`'${report.title}' 보고서를 삭제할까요? (되돌릴 수 없음)`)) return
    try {
      await api.deleteWeeklyReport(report.id)
      toast('삭제됨', '보고서가 삭제되었습니다.', 'info')
      await loadReports()
      onNewReport()
    } catch (e) {
      onAuthError(e)
      toast('오류', e.message, 'warning')
    }
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const html = editorRef.current?.getHTML() ?? report.html
      const rdate = report.report_date || defaultReportDate() // 보고일 하루 기준
      const payload = {
        id: report.id || undefined,
        title: report.title || weeklyReportTitle(),
        report_date: rdate,
        content: { html },
      }
      const { id } = await api.saveWeeklyReport(payload)
      setReport((r) => ({ ...r, id, html }))
      toast('저장됨', '주간보고가 저장되었습니다.', 'success')
      await loadReports()
    } catch (e) {
      onAuthError(e)
      toast('저장 실패', e.message, 'warning')
    } finally {
      setSaving(false)
    }
  }

  const onExport = async () => {
    try {
      const rdate = report.report_date || defaultReportDate()
      await exportReportDocx({
        title: report.title,
        report_date: rdate,
        html: editorRef.current?.getHTML() ?? report.html,
      })
    } catch (e) {
      toast('내보내기 실패', e.message, 'warning')
    }
  }

  // ── Asana 변화 가져오기 ─────────────────────────────────────────────
  const fetchChanges = async () => {
    if (!period.start || !period.end) { toast('기간 필요', '시작일과 종료일을 선택하세요.', 'warning'); return }
    setLoadingChanges(true)
    try {
      const { projects, allowedGids: gids } = await api.fetchAsanaChanges({
        periodStart: toBoundaryISO(period.start, false),
        periodEnd: toBoundaryISO(period.end, true),
        excludeMeetings, excludeArchived, includeActivity,
      })
      setChanges(projects)
      setAllowedGids(gids)
      setCheckedGids(new Set())
      setOpenGids(new Set())
      // 서버가 각 태스크에 변동내역(activity)까지 실어 보냄 → 캐시에 미리 채워 태스크별 재요청 제거
      const actMap = {}
      for (const p of projects) {
        for (const t of p.tasks || []) {
          if (Array.isArray(t.activity)) actMap[t.gid] = { loading: false, error: null, items: t.activity }
        }
      }
      setActivityByGid(actMap)
      const n = projects.reduce((a, p) => a + p.tasks.length, 0)
      toast('가져오기 완료', `프로젝트 ${projects.length} · 변화 태스크 ${n}`, 'success')
    } catch (e) {
      onAuthError(e)
      toast('가져오기 실패', e.message, 'warning')
    } finally {
      setLoadingChanges(false)
    }
  }

  // 체크된 태스크를 그룹>프로젝트 맥락과 함께 수집
  const collectChecked = useCallback(() => {
    const out = []
    for (const g of visibleGrouped || []) {
      for (const p of g.projects || []) {
        for (const t of p.tasks || []) {
          if (checkedGids.has(t.gid)) out.push({ group: g.group_name, project: p.name, task: t })
        }
      }
    }
    return out
  }, [visibleGrouped, checkedGids])

  const toggleCheck = (gid) => {
    setCheckedGids((prev) => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid); else next.add(gid)
      return next
    })
  }

  // 여러 gid를 한 번에 체크/해제 (프로젝트/전체 선택용)
  const setChecks = (gids, checked) => {
    setCheckedGids((prev) => {
      const next = new Set(prev)
      for (const gid of gids) { if (checked) next.add(gid); else next.delete(gid) }
      return next
    })
  }

  const allGids = useMemo(() => {
    const s = []
    for (const g of visibleGrouped || []) for (const p of g.projects || []) for (const t of p.tasks || []) s.push(t.gid)
    return s
  }, [visibleGrouped])

  // 선택 개수는 현재 보이는(필터 통과) 태스크 기준 — 숨겨진 태스크는 초안에 들어가지 않으므로 카운트에서도 제외
  const checkedCount = useMemo(() => allGids.reduce((n, g) => n + (checkedGids.has(g) ? 1 : 0), 0), [allGids, checkedGids])

  // AI 초안 생성 (Claude) — 체크된 항목만 사용
  const generateAiDraft = async () => {
    const checkedList = collectChecked()
    if (checkedList.length === 0) { toast('선택 없음', '초안에 포함할 태스크를 체크하세요.', 'warning'); return }
    const cur = editorRef.current?.getHTML() ?? ''
    const hasContent = cur.replace(/<[^>]*>/g, '').trim().length > 0
    if (hasContent && !confirm('현재 편집 중인 내용을 AI 초안으로 덮어쓸까요?')) return

    setAiLoading(true)
    try {
      // 변동내역은 '가져오기'('활동내역 포함' 켠 경우) 시 이미 activityByGid 에 캐시됨 → 캐시된 만큼 그대로 사용
      const tasksText = buildCheckedTasksText(visibleGrouped, checkedGids, activityByGid)
      const html = await api.generateWeeklyDraft({
        model: aiSettings.model,
        systemPrompt: aiSettings.systemPrompt,
        fewShot: aiSettings.fewShot,
        tasksText,
      })
      editorRef.current?.setContent(html)
      setReport((r) => {
        const rdate = r.report_date || defaultReportDate()
        return { ...r, title: r.title?.trim() || weeklyReportTitle(), report_date: rdate, html }
      })
      toast('AI 초안 생성', `${checkedList.length}개 항목으로 초안을 작성했습니다.`, 'success')
    } catch (e) {
      onAuthError(e)
      toast('AI 초안 실패', e.message, 'warning')
    } finally {
      setAiLoading(false)
    }
  }

  // 태스크 클릭 → 하단에 '기간 내 변동 내역' 인라인 펼침.
  // 변동내역은 '가져오기' 때 서버가 함께 실어주므로 대개 이미 캐시에 있음(재요청 없음).
  // 캐시에 없을 때만(구버전 함수 등) 폴백으로 지연 조회.
  const toggleActivity = (task) => {
    const isOpen = openGids.has(task.gid)
    setOpenGids((prev) => {
      const next = new Set(prev)
      if (next.has(task.gid)) next.delete(task.gid)
      else next.add(task.gid)
      return next
    })
    if (isOpen || activityByGid[task.gid]) return // 닫는 중이거나 이미 캐시됨 → 조회 생략
    setActivityByGid((m) => ({ ...m, [task.gid]: { loading: true, error: null, items: null } }))
    ;(async () => {
      try {
        const items = await api.getAsanaActivity({
          taskGid: task.gid,
          periodStart: toBoundaryISO(period.start, false),
          periodEnd: toBoundaryISO(period.end, true),
        })
        setActivityByGid((m) => ({ ...m, [task.gid]: { loading: false, error: null, items } }))
      } catch (e) {
        onAuthError(e)
        setActivityByGid((m) => ({ ...m, [task.gid]: { loading: false, error: e.message, items: null } }))
      }
    })()
  }

  const rawTotal = changes ? changes.reduce((a, p) => a + p.tasks.length, 0) : 0
  const totalChanges = (visibleGrouped || []).reduce((a, g) => a + g.projects.reduce((b, p) => b + p.tasks.length, 0), 0)
  const visibleProjectCount = (visibleGrouped || []).reduce((a, g) => a + g.projects.filter((p) => p.tasks.length > 0).length, 0)
  const hiddenCount = rawTotal - totalChanges

  return (
    <main className="flex-1 lg:flex-none max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4 lg:h-[calc(100vh-4.5rem)] lg:flex lg:flex-col lg:min-h-0 lg:overflow-hidden">
      {/* 상단 바 — 저장된 보고서 선택 */}
      <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <CalendarRange className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">주간보고</span>
        </div>
        <select
          value={report.id || ''}
          onChange={(e) => onSelectReport(e.target.value)}
          className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">+ 새 보고서 작성</option>
          {reports.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title} · {new Date(w.updated_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <Btn onClick={loadReports}><RefreshCw className="w-4 h-4" /> 새로고침</Btn>
          <Btn onClick={onNewReport}><FilePlus2 className="w-4 h-4" /> 새 보고서</Btn>
          {report.id && (
            <button onClick={onDeleteReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-400 transition">
              <Trash2 className="w-3.5 h-3.5" /> 삭제
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:flex-1 lg:min-h-0">
        {/* ── 좌측: Asana 변화 ─────────────────────────────────────── */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col lg:flex-1 lg:min-w-0 lg:min-h-0 lg:overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="text-[11px] font-bold text-slate-400 uppercase">보고 기간</span>
                <DateRangePicker value={period} onChange={setPeriod} />
              </label>
              <Btn onClick={fetchChanges} primary disabled={loadingChanges}>
                {loadingChanges ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />} 가져오기
              </Btn>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={excludeMeetings} onChange={(e) => setExcludeMeetings(e.target.checked)} className="accent-indigo-600" />
                회의록 제외
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={excludeArchived} onChange={(e) => setExcludeArchived(e.target.checked)} className="accent-indigo-600" />
                보관됨 제외
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer"
                title="켜면 '가져오기' 시 각 태스크의 기간 내 변동내역까지 함께 불러옵니다.">
                <input type="checkbox" checked={includeActivity} onChange={(e) => setIncludeActivity(e.target.checked)} className="accent-indigo-600" />
                활동내역 포함
              </label>
              {changes && (
                <span className="ml-auto text-slate-400">
                  프로젝트 {visibleProjectCount} · 태스크 {totalChanges}
                  {hideScheduleAssignee && hiddenCount > 0 && <span className="text-slate-400/80"> · {hiddenCount}개 제외</span>}
                </span>
              )}
            </div>
            {changes && changes.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={aiSettings.model}
                    onChange={(e) => setAiSettings((s) => ({ ...s, model: e.target.value }))}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    title="AI 모델 선택"
                  >
                    {AI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <Btn onClick={generateAiDraft} primary disabled={aiLoading || checkedCount === 0}>
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    AI 초안 생성 {checkedCount > 0 && `(${checkedCount})`}
                  </Btn>
                  <button
                    onClick={() => setShowAiSettings((v) => !v)}
                    title="AI 설정 (프롬프트·양식)"
                    className={`p-1.5 rounded-lg border transition ${showAiSettings
                      ? 'border-indigo-400 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                      : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                    <input type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = checkedCount > 0 && checkedCount < allGids.length }}
                      checked={allGids.length > 0 && checkedCount === allGids.length}
                      disabled={allGids.length === 0}
                      onChange={(e) => (e.target.checked ? setChecks(allGids, true) : setCheckedGids(new Set()))}
                      className="accent-indigo-600" />
                    전체 선택 {checkedCount > 0 && <span className="text-slate-400">({checkedCount}/{allGids.length})</span>}
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer"
                    title="기간 내 변동내역이 일정(마감·시작일) 또는 담당자 변경뿐인 태스크를 목록에서 숨깁니다. 판정에 변동내역이 필요하므로 '활동내역 포함'을 켠 상태로 가져오세요.">
                    <input type="checkbox" checked={hideScheduleAssignee} onChange={(e) => setHideScheduleAssignee(e.target.checked)} className="accent-indigo-600" />
                    일정·담당자 변경 제외
                  </label>
                </div>

                {showAiSettings && (
                  <AiSettingsPanel settings={aiSettings} onChange={setAiSettings} saving={aiSaving} loaded={aiSettingsLoaded} />
                )}
              </div>
            )}
          </div>

          <div className="p-3 overflow-y-auto max-h-[70vh] lg:max-h-none lg:flex-1 lg:min-h-0 space-y-4">
            {!changes && !loadingChanges && (
              <EmptyHint icon={CloudDownload} text="기간을 선택하고 '가져오기'를 눌러 이번 주 변화를 불러오세요." />
            )}
            {grouped && grouped.length === 0 && (
              <EmptyHint icon={CheckCircle2} text="선택한 기간에 변화된 태스크가 없습니다." />
            )}
            {(visibleGrouped || []).map((grp) => {
              const groupCount = grp.projects.reduce((a, p) => a + p.tasks.length, 0)
              return (
                <div key={grp.group_id || '__none__'} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: grp.color || '#94a3b8' }} />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{grp.group_name}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{groupCount}건</span>
                  </div>
                  {grp.projects.length === 0 && (
                    <p className="ml-2 px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                      {NO_CHANGE}
                    </p>
                  )}
                  {grp.projects.map((p) => {
                    const pGids = (p.tasks || []).map((t) => t.gid)
                    const allChecked = pGids.length > 0 && pGids.every((g) => checkedGids.has(g))
                    return (
                    <div key={p.gid} className="border border-slate-200 dark:border-slate-700 rounded-lg ml-2">
                      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-700/40 rounded-t-lg flex items-center gap-2">
                        {pGids.length > 0 && (
                          <input type="checkbox" checked={allChecked}
                            onChange={(e) => setChecks(pGids, e.target.checked)}
                            title="이 프로젝트 태스크 전체 선택" className="accent-indigo-600 shrink-0" />
                        )}
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex-1">{p.name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">{p.tasks.length}건</span>
                      </div>
                      {p.tasks.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">{NO_CHANGE}</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {p.tasks.map((t) => {
                            const open = openGids.has(t.gid)
                            return (
                              <li key={t.gid} className={checkedGids.has(t.gid) ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''}>
                                <div className="px-3 py-2 flex items-start gap-2 group">
                                  <input type="checkbox" checked={checkedGids.has(t.gid)}
                                    onChange={() => toggleCheck(t.gid)} title="AI 초안에 포함"
                                    className="mt-1 accent-indigo-600 shrink-0" />
                                  <ChangeBadge type={t.changeType} />
                                  <button onClick={() => toggleActivity(t)} title="기간 내 변동 내역 보기"
                                    className="flex-1 min-w-0 flex items-start gap-1.5 text-left">
                                    <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`} />
                                    <span className="min-w-0">
                                      <span className="block text-sm text-slate-800 dark:text-slate-100 break-words">{t.name}</span>
                                      <span className="block text-[11px] text-slate-400 mt-0.5">
                                        {t.section_name && <span>{t.section_name} · </span>}
                                        {t.assignee || '담당자 없음'}{t.status && <span> · {t.status}</span>}
                                      </span>
                                    </span>
                                  </button>
                                  <div className="shrink-0 flex items-center">
                                    <button onClick={() => setDetailTask({ gid: t.gid, name: t.name })} title="상세보기"
                                      className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition">
                                      <Eye className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                {open && <ActivityPanel state={activityByGid[t.gid]} />}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── 우측: 리치텍스트 편집기 ──────────────────────────────── */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col lg:flex-1 lg:min-w-0 lg:min-h-0 lg:overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
            <input value={report.title} onChange={(e) => setReport((r) => ({ ...r, title: e.target.value }))}
              placeholder="보고서 제목"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 rounded-lg text-base font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex items-center gap-2 flex-wrap">
              <DatePicker value={report.report_date} onChange={(d) => setReport((r) => ({ ...r, report_date: d }))} />
              <div className="ml-auto flex items-center gap-2">
                <Btn onClick={onSave} primary disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장
                </Btn>
                <Btn onClick={onExport}><Download className="w-4 h-4" /> DOCX 내보내기</Btn>
              </div>
            </div>
          </div>

          <RichEditor
            ref={editorRef}
            initialHTML={report.html}
            onChange={(html) => setReport((r) => ({ ...r, html }))}
            placeholder="좌측에서 태스크를 체크하고 'AI 초안 생성'을 누르거나, 자유롭게 작성하세요..."
          />
        </section>
      </div>

      {detailTask && (
        <TaskDetailModal
          taskGid={detailTask.gid}
          taskName={detailTask.name}
          onClose={() => setDetailTask(null)}
          onAuthError={onAuthError}
        />
      )}
    </main>
  )
}

// ── 작은 컴포넌트 ────────────────────────────────────────────────────
function ChangeBadge({ type }) {
  const done = type === 'completed'
  return (
    <span className={`shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
      done ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
           : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'}`}>
      {done ? '완료' : '수정'}
    </span>
  )
}

// storyMeta 와 동일 기준으로, subtype 이 '일정'(마감·시작일) 또는 '담당자' 변경인지 판정
function isScheduleOrAssigneeSubtype(subtype) {
  const s = subtype || ''
  if (s.includes('due') || s.includes('start') || s.includes('date')) return true // 일정
  if (s.includes('assign')) return true // 담당자
  return false
}

// 태스크의 기간 내 변동내역이 '일정/담당자' 변경만으로 이루어졌는지 판정('숨기기' 필터 대상).
//   완료 태스크는 항상 유의미하므로 대상 아님(false).
//   활동내역이 없거나(활동내역 미포함/미로딩) 비어 있으면 판단 불가 → 유지(false).
function isScheduleAssigneeOnly(task, activityByGid) {
  if (task.changeType === 'completed') return false
  const st = activityByGid[task.gid]
  const items = st && Array.isArray(st.items) ? st.items : task.activity
  if (!Array.isArray(items) || items.length === 0) return false
  return items.every((a) => isScheduleOrAssigneeSubtype(a.subtype))
}

// 스토리 subtype → 카테고리 색/라벨 (인라인 변동내역 표시용)
function storyMeta(subtype) {
  const s = subtype || ''
  if (s === 'comment_added') return { color: '#6366f1', label: '댓글' }
  if (s.includes('complete')) return { color: '#10b981', label: '완료 상태' }
  if (s.includes('due') || s.includes('start') || s.includes('date')) return { color: '#f59e0b', label: '일정' }
  if (s.includes('assign')) return { color: '#3b82f6', label: '담당자' }
  if (s.includes('custom_field')) return { color: '#8b5cf6', label: '필드' }
  if (s.includes('section') || s.includes('added_to_project')) return { color: '#14b8a6', label: '위치' }
  if (s.includes('name') || s.includes('notes')) return { color: '#ec4899', label: '내용' }
  return { color: '#94a3b8', label: '활동' }
}

function ActivityPanel({ state }) {
  const base = 'px-3 pb-3 pt-1 ml-6 mr-3 mb-2 border-l-2 border-slate-100 dark:border-slate-700'
  if (!state || state.loading) {
    return <div className={`${base} flex items-center gap-2 text-xs text-slate-400 py-2`}><Loader2 className="w-3.5 h-3.5 animate-spin" /> 변동 내역 불러오는 중...</div>
  }
  if (state.error) {
    return <div className={`${base} text-xs text-red-400 py-2`}>{state.error}</div>
  }
  const items = state.items || []
  if (items.length === 0) {
    return <div className={`${base} text-xs text-slate-400 italic py-2`}>이 기간에 기록된 변동 내역이 없습니다.</div>
  }
  return (
    <ul className={`${base} space-y-2 py-1`}>
      {items.map((a, i) => {
        const m = storyMeta(a.subtype)
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: m.color }} />
            <div className="min-w-0">
              <p className="text-slate-700 dark:text-slate-200 break-words">
                <span className="font-semibold" style={{ color: m.color }}>[{m.label}]</span> {a.text}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {a.author || '알 수 없음'} · {a.created_at ? new Date(a.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// AI 초안 설정 패널 — 시스템 프롬프트 / few-shot(양식). 변경 시 DB에 자동 저장(팀 공유).
function AiSettingsPanel({ settings, onChange, saving, loaded }) {
  const field = (key, value) => onChange((s) => ({ ...s, [key]: value }))
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-3">
      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        팀 전체가 공유하는 설정입니다 · DB 자동 저장
        {!loaded
          ? <span className="inline-flex items-center gap-1 text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> 불러오는 중</span>
          : saving
            ? <span className="inline-flex items-center gap-1 text-indigo-500"><Loader2 className="w-3 h-3 animate-spin" /> 저장 중</span>
            : <span className="text-emerald-500">저장됨</span>}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase">시스템 프롬프트</span>
          <button onClick={() => field('systemPrompt', DEFAULT_AI_SYSTEM_PROMPT)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-600">
            <RotateCcw className="w-3 h-3" /> 기본값
          </button>
        </div>
        <textarea value={settings.systemPrompt} onChange={(e) => field('systemPrompt', e.target.value)}
          rows={7} spellCheck={false}
          className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase">예시 양식 (few-shot)</span>
          <button onClick={() => field('fewShot', DEFAULT_AI_FEWSHOT)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-600">
            <RotateCcw className="w-3 h-3" /> 기본값
          </button>
        </div>
        <textarea value={settings.fewShot} onChange={(e) => field('fewShot', e.target.value)}
          rows={6} spellCheck={false}
          placeholder="원하는 보고서 형식의 예시를 붙여넣으세요. AI가 이 형식을 따라 작성합니다."
          className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
      </div>
    </div>
  )
}

function EmptyHint({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Icon className="w-9 h-9 text-slate-300 dark:text-slate-600 mb-2" />
      <p className="text-xs text-slate-400 dark:text-slate-500 max-w-[240px]">{text}</p>
    </div>
  )
}

function Btn({ children, onClick, primary, disabled, full }) {
  const cls = primary
    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 dark:shadow-none'
    : 'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${cls} ${full ? 'w-full' : ''}`}>
      {children}
    </button>
  )
}
