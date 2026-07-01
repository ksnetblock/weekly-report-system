import { useState, useEffect } from 'react'
import Modal from './Modal.jsx'
import { RefreshCw, Loader2, Cloud, ChevronRight, ChevronLeft, CheckSquare, Square, MinusSquare } from 'lucide-react'
import { listAsanaProjects } from '../lib/api.js'
import { asanaColorToHex } from '../lib/helpers.js'

export default function SyncModal({ onSync, onClose }) {
  // step: 'loading' | 'select' | 'confirm'
  const [step, setStep] = useState('loading')
  const [projects, setProjects] = useState([])    // [{ gid, name, color }] — 항상 배열 유지
  const [selected, setSelected] = useState(new Set())
  const [excludeMeetings, setExcludeMeetings] = useState(true)
  const [excludeArchived, setExcludeArchived] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  const defaultLabel = weekLabel()
  const [label, setLabel] = useState(defaultLabel)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncErr, setSyncErr] = useState('')

  // 모달 열리면 즉시 프로젝트 목록 로드
  useEffect(() => {
    listAsanaProjects()
      .then((list) => {
        const safe = Array.isArray(list) ? list : []
        setProjects(safe)
        setSelected(new Set(safe.map((p) => p.gid))) // 기본 전체 선택
        setStep('select')
      })
      .catch((e) => {
        setLoadErr(e.message || 'Asana 프로젝트 목록을 가져오지 못했습니다.')
        setStep('select')
      })
  }, [])

  // archived 제외 체크 변경 시 선택 상태 자동 반영
  useEffect(() => {
    if (projects.length === 0) return
    setSelected((prev) => {
      const n = new Set(prev)
      projects.forEach((p) => {
        if (p.archived) {
          excludeArchived ? n.delete(p.gid) : n.add(p.gid)
        }
      })
      return n
    })
  }, [excludeArchived, projects])

  const visibleProjects = excludeArchived ? projects.filter((p) => !p.archived) : projects
  const allChecked = visibleProjects.length > 0 && visibleProjects.every((p) => selected.has(p.gid))
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(visibleProjects.map((p) => p.gid)))
  const toggleOne = (gid) =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(gid) ? n.delete(gid) : n.add(gid)
      return n
    })

  async function run() {
    setSyncErr('')
    setBusy(true)
    try {
      await onSync({ label: label.trim(), note: note.trim(), projectGids: [...selected], excludeMeetings, excludeArchived })
    } catch (e) {
      setSyncErr(e.message || 'Asana 동기화에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Asana에서 가져오기" onClose={onClose} maxW="max-w-lg">
      {/* ── Step 1: 프로젝트 선택 ── */}
      {(step === 'loading' || (step === 'select' && !loadErr)) && (
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-lg p-3">
            <Cloud className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
              가져올 프로젝트를 선택하세요. 선택한 프로젝트만 새 버전으로 저장됩니다.
            </p>
          </div>

          {step === 'loading' ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400 dark:text-slate-500">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
              <span className="text-sm">Asana 프로젝트 목록 불러오는 중...</span>
            </div>
          ) : (
            <>
              {/* 전체 선택/해제 + 회의록 제외 */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-2 gap-3">
                <button onClick={toggleAll} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 flex-shrink-0">
                  {allChecked
                    ? <CheckSquare className="w-4 h-4 text-indigo-500" />
                    : selected.size === 0
                    ? <Square className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    : <MinusSquare className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                  전체 {allChecked ? '해제' : '선택'}
                </button>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={excludeMeetings} onChange={(e) => setExcludeMeetings(e.target.checked)}
                      className="w-3.5 h-3.5 accent-indigo-600" />
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">회의록 제외</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={excludeArchived} onChange={(e) => setExcludeArchived(e.target.checked)}
                      className="w-3.5 h-3.5 accent-indigo-600" />
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">archived 제외</span>
                  </label>
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{selected.size} / {visibleProjects.length} 선택</span>
              </div>

              {/* 프로젝트 목록 */}
              <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                {visibleProjects.map((p) => {
                  const checked = selected.has(p.gid)
                  const color = p.color ? asanaColorToHex(p.color) : '#94a3b8'
                  return (
                    <label key={p.gid}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition
                        ${checked ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300' : 'hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleOne(p.gid)} className="sr-only" />
                      {checked
                        ? <CheckSquare className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                        : <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-sm truncate">{p.name}</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">취소</button>
            <button onClick={() => setStep('confirm')} disabled={step === 'loading' || selected.size === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-md inline-flex items-center gap-1.5">
              다음 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 목록 로드 오류 */}
      {step === 'select' && loadErr && (
        <div className="p-6 space-y-4">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{loadErr}</p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">닫기</button>
          </div>
        </div>
      )}

      {/* ── Step 2: 버전 라벨 · 메모 입력 ── */}
      {step === 'confirm' && (
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              선택한 프로젝트 <b>{selected.size}개</b>를 가져와 새 버전으로 저장합니다.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">버전 라벨</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 2026-W27"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">메모 (선택)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 6월 4주차 정기 스냅샷"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" />
          </div>

          {syncErr && <p className="text-xs text-red-600 dark:text-red-400 font-medium whitespace-pre-wrap">{syncErr}</p>}

          <div className="flex justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button onClick={() => { setSyncErr(''); setStep('select') }}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <ChevronLeft className="w-4 h-4" /> 이전
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">취소</button>
              <button onClick={run} disabled={busy}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-md inline-flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {busy ? '가져오는 중...' : '가져오기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function weekLabel(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
