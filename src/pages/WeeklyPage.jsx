import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  RefreshCw, Trash2, FilePlus2, Download, Save, CloudDownload, Loader2,
  CheckCircle2, CalendarRange, Eye, ChevronRight, Sparkles, Settings2, RotateCcw,
  X, Copy, CopyPlus, Crosshair, ListPlus, Replace, ChevronLeft,
} from 'lucide-react'
import * as api from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import RichEditor from '../components/RichEditor.jsx'
import TaskDetailModal from '../components/TaskDetailModal.jsx'
import DateRangePicker from '../components/DateRangePicker.jsx'
import DatePicker from '../components/DatePicker.jsx'
import {
  defaultReportPeriod, defaultReportDate, toBoundaryISO, groupChanges, sectionsToHtml,
  weeklyReportTitle, syncTitleDate, NO_CHANGE, buildCheckedTasksText, AI_MODELS, DEFAULT_AI_SYSTEM_PROMPT, DEFAULT_AI_FEWSHOT,
  applyAddSuggestion, applyModifySuggestion,
} from '../lib/weekly.js'
import { exportReportDocx } from '../lib/exportDocx.js'

// ── AI 설정 기본값 (실제 값은 DB에서 로드 · 팀 공유) ─────────────────
function defaultAiSettings() {
  return { model: AI_MODELS[0].id, systemPrompt: DEFAULT_AI_SYSTEM_PROMPT, fewShot: DEFAULT_AI_FEWSHOT }
}

// savedTitle: DB에 저장돼 있는 제목. 편집 중인 title 과 달라질 수 있어서,
//   덮어쓰기 확인 문구에는 '어떤 보고서가 덮어써지는지'를 알려주는 이 값을 쓴다.
function blankReport() {
  const d = defaultReportDate() // 보고일(하루) = 다가올 화요일
  return { id: null, title: weeklyReportTitle(), savedTitle: '', report_date: d, html: '' }
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
  const [hideNoActivity, setHideNoActivity] = useState(true)             // 기간 내 활동 기록이 0건인 '수정' 태스크 제외 (기본 활성)

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
  // AI 업데이트 제안 — 에디터에 내용이 있을 때는 덮어쓰지 않고 추가/수정 제안을 별도 패널로 보여줌
  const [suggestions, setSuggestions] = useState(null) // null=없음, [{ id, type, group, project, current, suggested, reason, status }]

  // 캐러셀 — 패널 0:아사나 / 1:에디터 / 2:AI제안. 화면에는 [panelStart, panelStart+1] 두 개만 보인다.
  const [panelStart, setPanelStart] = useState(0)
  const maxStart = suggestions ? 1 : 0
  // 제안 패널이 사라지면(닫기·보고서 전환) 보이는 범위를 되돌린다
  useEffect(() => { setPanelStart((p) => Math.min(p, maxStart)) }, [maxStart])
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

  // 표시/선택에 실제 사용할 목록 — 노이즈 필터가 켜지면 해당 태스크(및 빈 프로젝트)를 제거.
  //   두 필터 모두 각 태스크의 기간 내 변동내역(activity)으로 판정하므로 '활동내역 포함'이 켜져 있어야 동작한다.
  //   하위태스크에도 같은 기준을 적용하고, 부모가 걸러졌지만 살아남은 하위태스크가 있으면
  //   부모는 맥락용(contextOnly)으로만 남긴다 — 하위태스크가 어디에 속한 건지 알 수 없게 되는 걸 막는다.
  const visibleGrouped = useMemo(() => {
    if (!grouped || (!hideScheduleAssignee && !hideNoActivity)) return grouped
    const hidden = (t) =>
      (hideScheduleAssignee && isScheduleAssigneeOnly(t, activityByGid)) ||
      (hideNoActivity && hasNoActivity(t, activityByGid))
    return grouped.map((g) => ({
      ...g,
      projects: (g.projects || [])
        .map((p) => ({
          ...p,
          tasks: (p.tasks || [])
            .map((t) => ({ ...t, subtasks: (t.subtasks || []).filter((s) => !hidden(s)), contextOnly: hidden(t) }))
            .filter((t) => !t.contextOnly || t.subtasks.length > 0),
        }))
        .filter((p) => p.tasks.length > 0),
    }))
  }, [grouped, hideScheduleAssignee, hideNoActivity, activityByGid])

  // ── 보고서 선택/생성/삭제 ───────────────────────────────────────────
  const onSelectReport = async (id) => {
    setSuggestions(null) // 제안은 특정 본문 기준이므로 보고서 전환 시 초기화
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
        id: w.id, title: w.title || '', savedTitle: w.title || '',
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
    setSuggestions(null)
  }

  const onDeleteReport = async () => {
    if (!report.id) return
    if (!confirm(`'${report.savedTitle || report.title}' 보고서를 삭제할까요? (되돌릴 수 없음)`)) return
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

  // 실제 저장 — asNew 면 id 를 빼고 보내 새 보고서(행)로 만든다.
  const doSave = async ({ asNew = false, title } = {}) => {
    setSaving(true)
    try {
      const html = editorRef.current?.getHTML() ?? report.html
      const rdate = report.report_date || defaultReportDate() // 보고일 하루 기준
      const nextTitle = (title ?? report.title ?? '').trim() || weeklyReportTitle()
      const payload = {
        id: asNew ? undefined : (report.id || undefined),
        title: nextTitle,
        report_date: rdate,
        content: { html },
      }
      const { id } = await api.saveWeeklyReport(payload)
      setReport((r) => ({ ...r, id, title: nextTitle, savedTitle: nextTitle, html }))
      toast('저장됨', asNew ? '새 보고서로 저장되었습니다.' : '주간보고가 저장되었습니다.', 'success')
      await loadReports()
    } catch (e) {
      onAuthError(e)
      toast('저장 실패', e.message, 'warning')
    } finally {
      setSaving(false)
    }
  }

  // 저장 — 불러온 보고서를 저장하면 그 데이터를 덮어쓰므로 한 번 확인받는다.
  //   제목/보고일을 이미 고쳤을 수 있으므로, 확인 문구에는 '저장된 제목'(savedTitle)을 쓴다.
  const onSave = () => {
    if (report.id) {
      const saved = report.savedTitle || report.title
      const next = (report.title || '').trim()
      const renamed = next && next !== saved
      const msg = `'${saved}' 보고서에 덮어씌워집니다.`
        + (renamed ? `\n(제목은 '${next}' 로 바뀝니다.)` : '')
        + `\n그대로 진행하시겠습니까?\n\n(따로 남기려면 '다른 이름으로 저장'을 사용하세요.)`
      if (!confirm(msg)) return
    }
    doSave()
  }

  // 다른 이름으로 저장 — 현재 편집 내용을 별도 보고서로 새로 만든다(원본은 그대로).
  //   제목을 이미 고쳤으면 그대로 기본값으로 쓰고, 안 고쳤으면 '(사본)'을 붙여 구분한다.
  const onSaveAs = () => {
    const cur = (report.title || '').trim() || weeklyReportTitle()
    const suggested = cur !== (report.savedTitle || '') ? cur : `${cur} (사본)`
    const input = prompt('새 보고서 제목을 입력하세요.', suggested)
    if (input === null) return // 취소
    if (!input.trim()) { toast('제목 필요', '제목을 입력하세요.', 'warning'); return }
    doSave({ asNew: true, title: input.trim() })
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
      // 서버가 각 태스크(+하위태스크)에 변동내역(activity)까지 실어 보냄 → 캐시에 미리 채워 재요청 제거
      const actMap = {}
      const cache = (t) => { if (Array.isArray(t.activity)) actMap[t.gid] = { loading: false, error: null, items: t.activity } }
      let n = 0
      for (const p of projects) {
        for (const t of p.tasks || []) {
          cache(t); n++
          for (const s of t.subtasks || []) { cache(s); n++ }
        }
      }
      setActivityByGid(actMap)
      toast('가져오기 완료', `프로젝트 ${projects.length} · 변화 태스크 ${n}`, 'success')
    } catch (e) {
      onAuthError(e)
      toast('가져오기 실패', e.message, 'warning')
    } finally {
      setLoadingChanges(false)
    }
  }

  // 체크된 태스크를 그룹>프로젝트 맥락과 함께 수집 (하위태스크 포함)
  const collectChecked = useCallback(() => {
    const out = []
    for (const g of visibleGrouped || []) {
      for (const p of g.projects || []) {
        for (const t of p.tasks || []) {
          if (!t.contextOnly && checkedGids.has(t.gid)) out.push({ group: g.group_name, project: p.name, task: t })
          for (const s of t.subtasks || []) {
            if (checkedGids.has(s.gid)) out.push({ group: g.group_name, project: p.name, task: s })
          }
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
    for (const g of visibleGrouped || []) for (const p of g.projects || []) s.push(...selectableGids(p.tasks))
    return s
  }, [visibleGrouped])

  // 선택 개수는 현재 보이는(필터 통과) 태스크 기준 — 숨겨진 태스크는 초안에 들어가지 않으므로 카운트에서도 제외
  const checkedCount = useMemo(() => allGids.reduce((n, g) => n + (checkedGids.has(g) ? 1 : 0), 0), [allGids, checkedGids])

  // 에디터에 실제 내용이 있는지 — AI 버튼의 동작(초안 생성 vs 업데이트 제안) 분기 기준
  const hasContent = useMemo(() => (report.html || '').replace(/<[^>]*>/g, '').trim().length > 0, [report.html])

  // AI 버튼 — 에디터가 비어 있으면 초안 전체 생성, 내용이 있으면 덮어쓰지 않고 추가/수정 제안 생성
  const generateAiDraft = async () => {
    const checkedList = collectChecked()
    if (checkedList.length === 0) { toast('선택 없음', '포함할 태스크를 체크하세요.', 'warning'); return }

    setAiLoading(true)
    try {
      // 변동내역은 '가져오기'('활동내역 포함' 켠 경우) 시 이미 activityByGid 에 캐시됨 → 캐시된 만큼 그대로 사용
      const tasksText = buildCheckedTasksText(visibleGrouped, checkedGids, activityByGid)

      if (hasContent) {
        // 업데이트 제안 모드 — 현재 본문(텍스트)을 기준으로 추가/수정 제안만 받는다
        const items = await api.generateWeeklySuggestions({
          model: aiSettings.model,
          reportText: editorRef.current?.getText() ?? '',
          tasksText,
        })
        setSuggestions(items.map((s, i) => ({ ...s, id: i, status: 'pending' })))
        setPanelStart(1) // 에디터 + AI제안 조합으로 자동 이동
        toast('AI 제안 도착', items.length > 0
          ? `추가/수정 제안 ${items.length}건 — 우측 제안 패널에서 확인하세요.`
          : '현재 본문에 추가로 제안할 내용이 없습니다.', 'success')
      } else {
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
      }
    } catch (e) {
      onAuthError(e)
      toast(hasContent ? 'AI 제안 실패' : 'AI 초안 실패', e.message, 'warning')
    } finally {
      setAiLoading(false)
    }
  }

  // ── AI 제안 카드 처리 ───────────────────────────────────────────────
  const markSuggestion = (id, status) =>
    setSuggestions((list) => (list || []).map((s) => (s.id === id ? { ...s, status } : s)))

  // 제안 반영 후 에디터 상태 동기화 + 방금 넣은 문장으로 스크롤/하이라이트
  const commitHtml = (html, focusText) => {
    editorRef.current?.setContent(html)
    setReport((r) => ({ ...r, html }))
    setTimeout(() => editorRef.current?.locateText(focusText), 50)
  }

  const applySuggestion = (sug) => {
    const html = editorRef.current?.getHTML() ?? ''
    if (sug.type === 'add') {
      commitHtml(applyAddSuggestion(html, sug), sug.suggested)
      markSuggestion(sug.id, 'applied')
    } else {
      const { ok, html: next } = applyModifySuggestion(html, sug)
      if (!ok) {
        toast('자동 교체 실패', '본문에서 해당 문장을 찾지 못했습니다. 위치 버튼으로 확인 후 직접 수정하세요.', 'warning')
        return
      }
      commitHtml(next, sug.suggested)
      markSuggestion(sug.id, 'applied')
    }
  }

  // 해당 문장 위치로 스크롤 + 하이라이트 (수정 제안은 원문 기준, 나머지는 제안문 기준)
  const locateSuggestion = (sug) => {
    const found = editorRef.current?.locateText(sug.current || sug.suggested)
    if (!found) toast('찾기 실패', '본문에서 비슷한 문장을 찾지 못했습니다.', 'warning')
  }

  const copySuggestion = async (sug) => {
    try {
      await navigator.clipboard.writeText(sug.suggested)
      toast('복사됨', '제안 문장이 클립보드에 복사되었습니다.', 'info')
    } catch {
      toast('복사 실패', '클립보드 접근이 차단되었습니다.', 'warning')
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

  // 건수는 하위태스크까지 센다. 맥락용으로만 남은 부모는 '표시된 변화'가 아니므로 제외.
  const countTasks = (tasks) => (tasks || []).reduce((n, t) => n + (t.contextOnly ? 0 : 1) + (t.subtasks?.length || 0), 0)
  const rawTotal = changes ? changes.reduce((a, p) => a + countTasks(p.tasks), 0) : 0
  const totalChanges = (visibleGrouped || []).reduce((a, g) => a + g.projects.reduce((b, p) => b + countTasks(p.tasks), 0), 0)
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
          {maxStart > 0 && <PanelIndicator start={panelStart} onSelect={setPanelStart} max={maxStart} />}
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

      {/* ── 캐러셀: 패널 3개 중 2개만 화면에 (모바일은 세로로 모두 쌓임) ── */}
      <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:-mx-2">
        <div className="carousel-track flex flex-col lg:flex-row gap-4 lg:gap-0 lg:h-full lg:w-[150%]"
          style={{ '--carousel-tx': `-${panelStart * (100 / 3)}%` }}>
        {/* ── 패널 1: Asana 변화 ───────────────────────────────────── */}
        <PanelSlot>
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col lg:h-full lg:min-w-0 lg:min-h-0 lg:overflow-hidden">
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
                  {hiddenCount > 0 && <span className="text-slate-400/80"> · {hiddenCount}개 제외</span>}
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
                  <span title={hasContent
                    ? '에디터에 내용이 있으면 덮어쓰지 않고, 현재 본문 기준으로 추가/수정 제안을 생성합니다.'
                    : '에디터가 비어 있으면 체크된 태스크로 초안 전체를 새로 작성합니다.'}>
                    <Btn onClick={generateAiDraft} primary disabled={aiLoading || checkedCount === 0}>
                      {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {hasContent ? 'AI 업데이트 제안' : 'AI 초안 생성'} {checkedCount > 0 && `(${checkedCount})`}
                    </Btn>
                  </span>
                  {/* 시스템 프롬프트·양식은 '초안 생성'에만 쓰인다 — 업데이트 제안 모드에선 숨긴다 */}
                  {!hasContent && (
                    <button
                      onClick={() => setShowAiSettings((v) => !v)}
                      title="AI 설정 (프롬프트·양식)"
                      className={`p-1.5 rounded-lg border transition ${showAiSettings
                        ? 'border-indigo-400 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                        : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                  )}
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
                  <label className="inline-flex items-center gap-1.5 cursor-pointer"
                    title="Asana modified_at 만 갱신되고 기간 내 활동 기록(하위태스크 포함)은 하나도 없는 태스크를 숨깁니다. 판정에 변동내역이 필요하므로 '활동내역 포함'을 켠 상태로 가져오세요.">
                    <input type="checkbox" checked={hideNoActivity} onChange={(e) => setHideNoActivity(e.target.checked)} className="accent-indigo-600" />
                    변동내역 없음 제외
                  </label>
                </div>

                {showAiSettings && !hasContent && (
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
              const groupCount = grp.projects.reduce((a, p) => a + countTasks(p.tasks), 0)
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
                    const pGids = selectableGids(p.tasks)
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
                        <span className="text-[11px] text-slate-400 shrink-0">{countTasks(p.tasks)}건</span>
                      </div>
                      {p.tasks.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">{NO_CHANGE}</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {p.tasks.map((t) => (
                            <li key={t.gid}>
                              <TaskRow task={t} checkedGids={checkedGids} openGids={openGids} activityByGid={activityByGid}
                                onToggleCheck={toggleCheck} onToggleActivity={toggleActivity} onDetail={setDetailTask} />
                              {(t.subtasks || []).length > 0 && (
                                <ul className="ml-7 mb-1 border-l-2 border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
                                  {t.subtasks.map((s) => (
                                    <li key={s.gid}>
                                      <TaskRow task={s} checkedGids={checkedGids} openGids={openGids} activityByGid={activityByGid}
                                        onToggleCheck={toggleCheck} onToggleActivity={toggleActivity} onDetail={setDetailTask} />
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ))}
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
        </PanelSlot>

        {/* ── 패널 2: 리치텍스트 편집기 ────────────────────────────── */}
        <PanelSlot>
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col lg:h-full lg:min-w-0 lg:min-h-0 lg:overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
            <input value={report.title} onChange={(e) => setReport((r) => ({ ...r, title: e.target.value }))}
              placeholder="보고서 제목"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 rounded-lg text-base font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex items-center gap-2 flex-wrap">
              <DatePicker value={report.report_date} onChange={(d) => setReport((r) => ({ ...r, report_date: d, title: syncTitleDate(r.title, d) }))} />
              <div className="ml-auto flex items-center gap-2">
                <Btn onClick={onSave} primary disabled={saving}
                  title={report.id ? `'${report.savedTitle || report.title}' 보고서를 덮어씁니다` : '새 보고서로 저장합니다'}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장
                </Btn>
                {report.id && (
                  <Btn onClick={onSaveAs} disabled={saving}
                    title="원본은 그대로 두고, 현재 내용을 새 보고서로 저장합니다">
                    <CopyPlus className="w-4 h-4" /> 다른 이름으로 저장
                  </Btn>
                )}
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
        </PanelSlot>

        {/* ── 패널 3: AI 업데이트 제안 (제안 생성 후에만 등장) ─────── */}
        {suggestions && (
          <PanelSlot>
            <SuggestionPanel
              items={suggestions}
              onClose={() => setSuggestions(null)}
              onApply={applySuggestion}
              onLocate={locateSuggestion}
              onCopy={copySuggestion}
              onDismiss={(id) => markSuggestion(id, 'dismissed')}
              onRestore={(id) => markSuggestion(id, 'pending')}
            />
          </PanelSlot>
        )}
        </div>
      </div>

      {/* 화면 양쪽 끝 캐러셀 이동 버튼 — 패널이 3개일 때만 */}
      {maxStart > 0 && (
        <>
          <CarouselNav dir="prev" disabled={panelStart === 0}
            onClick={() => setPanelStart((p) => Math.max(0, p - 1))} />
          <CarouselNav dir="next" disabled={panelStart >= maxStart}
            onClick={() => setPanelStart((p) => Math.min(maxStart, p + 1))} />
        </>
      )}

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

// ── 캐러셀 ───────────────────────────────────────────────────────────
const PANEL_COUNT = 3 // 0:Asana 변화 / 1:주간보고 편집 / 2:AI 업데이트 제안

// 캐러셀 한 칸 — lg 이상에서 트랙(150%)의 1/3 = 화면의 절반을 차지한다. 모바일은 전체 폭.
function PanelSlot({ children }) {
  return <div className="flex flex-col min-w-0 w-full lg:w-1/3 lg:h-full lg:px-2">{children}</div>
}

// 화면 좌·우 가장자리에 고정된 이동 버튼 (화살표만).
function CarouselNav({ dir, disabled, onClick }) {
  const prev = dir === 'prev'
  const Icon = prev ? ChevronLeft : ChevronRight
  const label = prev ? '이전 패널 보기' : '다음 패널 보기'
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`hidden lg:flex fixed top-1/2 -translate-y-1/2 z-30 !mt-0 items-center justify-center w-9 h-14 rounded-xl border shadow-lg transition
        ${prev ? 'left-1' : 'right-1'}
        ${disabled
          ? 'opacity-0 pointer-events-none'
          : 'bg-white/95 dark:bg-slate-800/95 backdrop-blur border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:text-indigo-600 hover:border-indigo-400 hover:bg-white dark:hover:bg-slate-700'}`}>
      <Icon className="w-5 h-5" />
    </button>
  )
}

// 현재 보이는 두 패널을 나타내는 작은 인디케이터 (상단 바). 클릭으로도 이동 가능.
function PanelIndicator({ start, onSelect, max }) {
  return (
    <div className="hidden lg:flex items-center gap-1 mr-1" title="화면에 보이는 패널">
      {Array.from({ length: PANEL_COUNT }, (_, i) => {
        const visible = i === start || i === start + 1
        return (
          <button key={i} onClick={() => onSelect(Math.min(max, Math.max(0, i - 1)))}
            className={`h-1.5 rounded-full transition-all ${visible
              ? 'w-6 bg-indigo-500'
              : 'w-2.5 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400'}`} />
        )
      })}
    </div>
  )
}

// ── 작은 컴포넌트 ────────────────────────────────────────────────────

// 선택(체크) 대상 gid — 태스크 + 하위태스크. 맥락용으로만 남은 부모(contextOnly)는 제외.
function selectableGids(tasks) {
  const out = []
  for (const t of tasks || []) {
    if (!t.contextOnly) out.push(t.gid)
    for (const s of t.subtasks || []) out.push(s.gid)
  }
  return out
}

// 태스크 한 줄 — 부모/하위태스크 공용. 체크박스 · 배지 · 변동내역 펼침 · 상세보기가 동일하게 동작한다.
//   contextOnly: 필터로 걸러졌지만 살아남은 하위태스크의 소속을 보여주려 남긴 부모 → 선택 불가, 흐리게.
function TaskRow({ task: t, checkedGids, openGids, activityByGid, onToggleCheck, onToggleActivity, onDetail }) {
  const open = openGids.has(t.gid)
  const checked = checkedGids.has(t.gid)
  return (
    <div className={t.contextOnly ? 'opacity-50' : checked ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''}>
      <div className="px-3 py-2 flex items-start gap-2">
        {t.contextOnly
          ? <span className="w-[13px] shrink-0" aria-hidden />
          : <input type="checkbox" checked={checked} onChange={() => onToggleCheck(t.gid)}
              title="AI 초안에 포함" className="mt-1 accent-indigo-600 shrink-0" />}
        <ChangeBadge type={t.changeType} empty={hasNoActivity(t, activityByGid)} />
        <button onClick={() => onToggleActivity(t)} title="기간 내 변동 내역 보기"
          className="flex-1 min-w-0 flex items-start gap-1.5 text-left">
          <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="min-w-0">
            <span className="block text-sm text-slate-800 dark:text-slate-100 break-words">
              {t.is_subtask && <span className="text-[10px] font-bold text-slate-400 mr-1">하위</span>}
              {t.name}
            </span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              {t.section_name && <span>{t.section_name} · </span>}
              {t.assignee || '담당자 없음'}{t.status && <span> · {t.status}</span>}
            </span>
          </span>
        </button>
        <div className="shrink-0 flex items-center">
          <button onClick={() => onDetail({ gid: t.gid, name: t.name })} title="상세보기"
            className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition">
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>
      {open && <ActivityPanel state={activityByGid[t.gid]} />}
    </div>
  )
}

function ChangeBadge({ type, empty }) {
  const done = type === 'completed'
  // modified_at 만 갱신되고 기간 내 활동 기록이 없는 태스크 — '수정'으로 오인되지 않도록 따로 표시
  if (!done && empty) {
    return (
      <span title="Asana modified_at 만 갱신됐고 기간 내 활동 기록은 없습니다 (설명 편집·좋아요·자동화 규칙 등)"
        className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-400">
        내역없음
      </span>
    )
  }
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

// 태스크의 기간 내 변동내역 배열. 아직 못 가져왔으면(활동내역 미포함/로딩중/실패) null → 필터 판정 보류.
function activityItems(task, activityByGid) {
  const st = activityByGid[task.gid]
  if (st) return !st.loading && !st.error && Array.isArray(st.items) ? st.items : null
  return Array.isArray(task.activity) ? task.activity : null
}

// 태스크의 기간 내 변동내역이 '일정/담당자' 변경만으로 이루어졌는지 판정('숨기기' 필터 대상).
//   완료 태스크는 항상 유의미하므로 대상 아님(false).
//   활동내역이 없거나(활동내역 미포함/미로딩) 비어 있으면 판단 불가 → 유지(false).
function isScheduleAssigneeOnly(task, activityByGid) {
  if (task.changeType === 'completed') return false
  const items = activityItems(task, activityByGid)
  if (!items || items.length === 0) return false
  return items.every((a) => isScheduleOrAssigneeSubtype(a.subtype))
}

// 기간 내 활동 기록이 0건인 '수정' 태스크인지 판정('숨기기' 필터 대상).
//   Asana 의 modified_at 은 스토리를 남기지 않는 변경(설명 편집·좋아요·자동화 규칙 등)으로도 갱신되므로,
//   이런 태스크는 배지만 '수정'이고 보고서에 쓸 내용이 없다. 하위태스크 스토리는 서버가 이미 합쳐서 준다.
function hasNoActivity(task, activityByGid) {
  if (task.changeType === 'completed') return false
  const items = activityItems(task, activityByGid)
  return Array.isArray(items) && items.length === 0
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

// AI 업데이트 제안 패널 — 캐러셀 3번째 칸. 제안 카드를 보고 사용자가 직접 반영한다.
//   추가(add): '삽입' 버튼으로 해당 프로젝트 섹션에 자동 삽입 (항상 성공).
//   수정(modify): '교체'는 원문 매칭이 확실할 때만 성공, 아니면 '위치'로 이동해 직접 수정.
function SuggestionPanel({ items, onClose, onApply, onLocate, onCopy, onDismiss, onRestore }) {
  const pending = items.filter((s) => s.status === 'pending').length
  const done = items.length - pending
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl border border-indigo-200 dark:border-indigo-900/60 shadow-sm flex flex-col lg:h-full lg:min-w-0 lg:min-h-0 lg:overflow-hidden">
      <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">AI 업데이트 제안</span>
          <span className="text-[11px] text-slate-400">
            {items.length === 0 ? '제안 없음' : pending > 0 ? `${items.length}건 중 ${pending}건 남음` : '모두 처리됨'}
          </span>
          <button onClick={onClose} title="제안 패널 닫기"
            className="ml-auto p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        {items.length > 0 && (
          <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          현재 본문을 기준으로 한 제안입니다. 반영하거나 무시하고, 필요하면 직접 편집하세요.
        </p>
      </div>
      <div className="p-3 overflow-y-auto max-h-[70vh] lg:max-h-none lg:flex-1 lg:min-h-0 space-y-2">
        {items.length === 0 && (
          <EmptyHint icon={CheckCircle2} text="현재 본문에 추가로 제안할 내용이 없습니다. 이미 잘 반영되어 있어요." />
        )}
        {items.map((s) => <SuggestionCard key={s.id} sug={s}
          onApply={onApply} onLocate={onLocate} onCopy={onCopy} onDismiss={onDismiss} onRestore={onRestore} />)}
      </div>
    </section>
  )
}

function SuggestionCard({ sug, onApply, onLocate, onCopy, onDismiss, onRestore }) {
  const isAdd = sug.type === 'add'
  const done = sug.status !== 'pending'
  const path = [sug.group, sug.project].filter(Boolean).join(' · ')
  return (
    <div className={`rounded-lg border bg-white dark:bg-slate-800 p-2.5 space-y-1.5 ${done
      ? 'border-slate-200 dark:border-slate-700 opacity-55'
      : 'border-indigo-200 dark:border-indigo-800/70 shadow-sm'}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${isAdd
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'}`}>
          {isAdd ? '추가' : '수정'}
        </span>
        {path && <span className="text-[11px] text-slate-400 truncate">{path}</span>}
        <span className="ml-auto shrink-0">
          {sug.status === 'applied' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" /> 반영됨
            </span>
          )}
          {sug.status === 'dismissed' && (
            <button onClick={() => onRestore(sug.id)} className="text-[11px] text-slate-400 hover:text-indigo-500 underline">
              무시됨 · 되돌리기
            </button>
          )}
        </span>
      </div>

      {!isAdd && sug.current && (
        <p className="text-xs text-slate-400 dark:text-slate-500 line-through break-words">{sug.current}</p>
      )}
      <p className="text-sm text-slate-800 dark:text-slate-100 break-words">{sug.suggested}</p>
      {sug.reason && <p className="text-[11px] text-slate-400 break-words">근거: {sug.reason}</p>}

      {!done && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {isAdd ? (
            <MiniBtn onClick={() => onApply(sug)} primary title="해당 프로젝트 섹션 끝에 이 문장을 삽입합니다">
              <ListPlus className="w-3.5 h-3.5" /> 삽입
            </MiniBtn>
          ) : (
            <>
              <MiniBtn onClick={() => onApply(sug)} primary title="본문에서 기존 문장을 찾아 제안 문장으로 교체합니다">
                <Replace className="w-3.5 h-3.5" /> 교체
              </MiniBtn>
              {/* '추가' 제안은 본문에 아직 없는 문장이라 이동할 위치가 없다 → '수정'에서만 노출 */}
              <MiniBtn onClick={() => onLocate(sug)} title="본문에서 기존 문장 위치로 이동합니다">
                <Crosshair className="w-3.5 h-3.5" /> 위치
              </MiniBtn>
            </>
          )}
          <MiniBtn onClick={() => onCopy(sug)} title="제안 문장을 클립보드에 복사합니다">
            <Copy className="w-3.5 h-3.5" /> 복사
          </MiniBtn>
          <button onClick={() => onDismiss(sug.id)}
            className="ml-auto text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-1">
            무시
          </button>
        </div>
      )}
    </div>
  )
}

function MiniBtn({ children, onClick, primary, title }) {
  const cls = primary
    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
    : 'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
  return (
    <button onClick={onClick} title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition ${cls}`}>
      {children}
    </button>
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

function Btn({ children, onClick, primary, disabled, full, title }) {
  const cls = primary
    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 dark:shadow-none'
    : 'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${cls} ${full ? 'w-full' : ''}`}>
      {children}
    </button>
  )
}
