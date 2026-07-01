import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Trello, FolderTree, RefreshCw, LogOut, Search, History, Trash2,
  Layers, PlayCircle, CheckCircle2, AlertCircle, Loader2, CloudDownload,
  Sun, Moon,
} from 'lucide-react'
import { hasPassword, clearPassword } from './lib/auth.js'
import { useTheme } from './lib/theme.js'
import * as api from './lib/api.js'
import { flatten } from './lib/transform.js'
import { effectiveStatus, STATUS_ORDER } from './lib/helpers.js'
import { useToast } from './components/Toast.jsx'
import PasswordGate from './components/PasswordGate.jsx'
import Gantt from './components/Gantt.jsx'
import GroupModal from './components/GroupModal.jsx'
import ProjectModal from './components/ProjectModal.jsx'
import SectionModal from './components/SectionModal.jsx'
import SyncModal from './components/SyncModal.jsx'

export default function App() {
  const toast = useToast()
  const [theme, toggleTheme] = useTheme()
  const [unlocked, setUnlocked] = useState(hasPassword())
  const [loading, setLoading] = useState(false)

  const [versions, setVersions] = useState([])
  const [versionId, setVersionId] = useState(null) // null = 최신
  const [roadmap, setRoadmap] = useState(null)      // get_roadmap 원본

  // 필터
  const [scale, setScale] = useState('month')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('section')

  // 모달
  const [groupModal, setGroupModal] = useState(false)
  const [projectModal, setProjectModal] = useState(null)
  const [sectionModal, setSectionModal] = useState(null)
  const [syncModal, setSyncModal] = useState(false)

  const onAuthError = (e) => {
    if (e.code === 'invalid_password') { clearPassword(); setUnlocked(false) }
  }

  const loadRoadmap = useCallback(async (vId) => {
    setLoading(true)
    try {
      const d = await api.getRoadmap(vId ?? null)
      setRoadmap(d)
    } catch (e) {
      onAuthError(e)
      toast('불러오기 실패', e.message, 'warning')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadVersions = useCallback(async () => {
    try {
      const vs = await api.listVersions()
      setVersions(vs)
      return vs
    } catch (e) {
      onAuthError(e)
      toast('버전 목록 실패', e.message, 'warning')
      return []
    }
  }, [toast])

  // 최초 진입
  useEffect(() => {
    if (!unlocked) return
    ;(async () => {
      const vs = await loadVersions()
      setVersionId(null)
      await loadRoadmap(null)
      if (vs.length === 0) {
        // 아직 버전 없음 — 안내
      }
    })()
  }, [unlocked, loadVersions, loadRoadmap])

  const data = useMemo(() => flatten(roadmap), [roadmap])

  // ── 필터 ────────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    const kw = search.toLowerCase().trim()
    return data.tasks.filter((t) => {
      const mkw = !kw || t.name.toLowerCase().includes(kw) || (t.assignee || '').toLowerCase().includes(kw)
      const ms = statusFilter === 'all' || effectiveStatus(t) === statusFilter
      const ma = assigneeFilter === 'all' || t.assignee === assigneeFilter
      return mkw && ms && ma
    })
  }, [data.tasks, search, statusFilter, assigneeFilter])

  const assignees = useMemo(
    () => [...new Set(data.tasks.map((t) => t.assignee).filter(Boolean))].sort(),
    [data.tasks]
  )

  const stats = useMemo(() => {
    const s = { total: data.tasks.length, prog: 0, done: 0, pending: 0 }
    for (const t of data.tasks) {
      const st = effectiveStatus(t)
      if (st === '진행 중') s.prog++
      else if (st === '완료') s.done++
      else s.pending++
    }
    return s
  }, [data.tasks])

  // ── 액션 ────────────────────────────────────────────────────────────
  const guard = async (fn, okMsg) => {
    try {
      await fn()
      if (okMsg) toast('완료', okMsg, 'success')
      await loadRoadmap(versionId)
    } catch (e) {
      onAuthError(e)
      toast('오류', e.message, 'warning')
    }
  }

  const upsertGroup = (g) => guard(() => api.upsertGroup(g))
  const deleteGroup = (id) => guard(() => api.deleteGroup(id), '그룹이 삭제되었습니다.')
  const saveProject = (gid, patch) =>
    guard(() => api.setProjectMeta(gid, patch), '프로젝트가 업데이트되었습니다.').then(() => setProjectModal(null))

  const saveSection = (gid, patch) =>
    guard(() => api.setSectionMeta(gid, patch), '섹션이 업데이트되었습니다.').then(() => setSectionModal(null))

  const runSync = async ({ label, note, projectGids, excludeMeetings, excludeArchived }) => {
    const res = await api.syncFromAsana({ label, note, projectGids, excludeMeetings, excludeArchived })
    toast('Asana 동기화 완료',
      `프로젝트 ${res.summary.projects} · 업무 ${res.summary.tasks} (완료 ${res.summary.completed})`, 'success')
    setSyncModal(false)
    await loadVersions()
    setVersionId(null)          // 최신(방금 만든 버전)으로
    await loadRoadmap(null)
  }

  const onSelectVersion = async (vId) => {
    const v = vId || null
    setVersionId(v)
    await loadRoadmap(v)
  }

  const onDeleteVersion = async () => {
    const current = roadmap?.version
    if (!current) return
    if (!confirm(`'${current.label}' 버전을 삭제할까요? (되돌릴 수 없음)`)) return
    try {
      await api.deleteVersion(current.id)
      toast('삭제됨', '버전이 삭제되었습니다.', 'info')
      await loadVersions()
      setVersionId(null)
      await loadRoadmap(null)
    } catch (e) {
      onAuthError(e)
      toast('오류', e.message, 'warning')
    }
  }

  function logout() { clearPassword(); setUnlocked(false) }

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} theme={theme} onToggleTheme={toggleTheme} />

  const hasVersions = versions.length > 0
  const currentVersion = roadmap?.version

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* 헤더 */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg text-white"><Trello className="w-6 h-6" /></div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">주간업무 로드맵 뷰어</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Asana 동기화 · 주간보고 버전 관리</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => setSyncModal(true)} primary><CloudDownload className="w-4 h-4" /> Asana 가져오기</Btn>
            <Btn onClick={() => setGroupModal(true)}><FolderTree className="w-4 h-4" /> 그룹 관리</Btn>
            <Btn onClick={() => loadRoadmap(versionId)}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침</Btn>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Btn onClick={logout} danger><LogOut className="w-4 h-4" /> 잠금</Btn>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* 버전 선택 줄 */}
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <History className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">주간보고 버전</span>
          </div>
          <select
            value={versionId || (currentVersion?.id ?? '')}
            onChange={(e) => onSelectVersion(e.target.value)}
            disabled={!hasVersions}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {!hasVersions && <option value="">버전 없음</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {new Date(v.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                {v.summary ? ` · 업무 ${v.summary.tasks}` : ''}
              </option>
            ))}
          </select>
          {currentVersion?.note && <span className="text-xs text-slate-400 dark:text-slate-500">📝 {currentVersion.note}</span>}
          {currentVersion && (
            <button onClick={onDeleteVersion}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-400 transition">
              <Trash2 className="w-3.5 h-3.5" /> 버전 삭제
            </button>
          )}
        </div>

        {!hasVersions && !loading ? (
          <EmptyVersions onSync={() => setSyncModal(true)} />
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi label="총 업무" value={stats.total} Icon={Layers} tone="slate" />
              <Kpi label="진행 중" value={stats.prog} Icon={PlayCircle} tone="blue" />
              <Kpi label="완료" value={stats.done} Icon={CheckCircle2} tone="emerald" />
              <Kpi label="준비/보류" value={stats.pending} Icon={AlertCircle} tone="amber" />
            </div>

            {/* 필터 */}
            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-col sm:flex-row items-stretch gap-2 w-full lg:w-auto">
                <div className="relative w-full sm:w-64">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Search className="w-4 h-4" /></span>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="업무명 또는 담당자 검색..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-700" />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="all">모든 상태</option>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="all">모든 담당자</option>
                  {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                  <span className="px-2 text-[11px] font-bold text-slate-400 uppercase">수준</span>
                  {[['project', '프로젝트'], ['section', '섹션'], ['task', '업무']].map(([v, label]) => (
                    <button key={v} onClick={() => setLevelFilter(v)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${levelFilter === v ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                  <span className="px-2 text-[11px] font-bold text-slate-400 uppercase">기간</span>
                  {[['week', '주별'], ['month', '월별'], ['year', '연도별']].map(([v, label]) => (
                    <button key={v} onClick={() => setScale(v)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${scale === v ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 간트 */}
            {loading && !roadmap ? (
              <div className="flex items-center justify-center py-24 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> 데이터를 불러오는 중...
              </div>
            ) : (
              <Gantt
                groups={data.groups} projects={data.projects} sections={data.sections} tasks={filteredTasks}
                scale={scale}
                levelFilter={levelFilter}
                onEditGroup={() => setGroupModal(true)}
                onEditProject={(p) => setProjectModal(p)}
                onEditSection={(s) => setSectionModal(s)}
              />
            )}
          </>
        )}
      </main>


      {/* 모달 */}
      {groupModal && (
        <GroupModal groups={data.groups} projects={data.projects}
          onUpsert={upsertGroup} onDelete={deleteGroup} onClose={() => setGroupModal(false)} />
      )}
      {projectModal && (
        <ProjectModal project={projectModal} groups={data.groups}
          onSave={saveProject} onClose={() => setProjectModal(null)} />
      )}
      {sectionModal && (
        <SectionModal section={sectionModal}
          onSave={saveSection} onClose={() => setSectionModal(null)} />
      )}
      {syncModal && <SyncModal onSync={runSync} onClose={() => setSyncModal(false)} />}
    </div>
  )
}

// ── 작은 컴포넌트 ────────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      onClick={onToggle}
      title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      aria-label="테마 전환"
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}

function EmptyVersions({ onSync }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center py-20">
      <CloudDownload className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">아직 저장된 주간보고 버전이 없습니다.</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Asana에서 데이터를 가져와 첫 버전을 만드세요.</p>
      <button onClick={onSync} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-md">
        <CloudDownload className="w-4 h-4" /> Asana 가져오기
      </button>
    </div>
  )
}

function Btn({ children, onClick, primary, danger }) {
  const cls = primary
    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 dark:shadow-none'
    : danger
    ? 'border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400'
    : 'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition ${cls}`}>
      {children}
    </button>
  )
}

function Kpi({ label, value, Icon, tone }) {
  const tones = {
    slate: ['text-slate-400', 'text-slate-800 dark:text-slate-100', 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'],
    blue: ['text-blue-500', 'text-blue-600 dark:text-blue-400', 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'],
    emerald: ['text-emerald-500', 'text-emerald-600 dark:text-emerald-400', 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'],
    amber: ['text-amber-500', 'text-amber-600 dark:text-amber-400', 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'],
  }[tone]
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wider ${tones[0]}`}>{label}</p>
        <h3 className={`text-2xl font-bold mt-1 ${tones[1]}`}>{value}</h3>
      </div>
      <div className={`p-3 rounded-lg ${tones[2]}`}><Icon className="w-6 h-6" /></div>
    </div>
  )
}
