import { useState, useEffect } from 'react'
import {
  Loader2, ExternalLink, CheckCircle2, Circle, User, Calendar, Tag as TagIcon,
  MessageSquare, Paperclip, ListTree, FolderKanban,
} from 'lucide-react'
import Modal from './Modal.jsx'
import * as api from '../lib/api.js'

// Asana 태스크 상세 모달 — 열릴 때 task_gid 로 전체 데이터를 개별 조회
export default function TaskDetailModal({ taskGid, taskName, onClose, onAuthError }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const d = await api.getAsanaTask(taskGid)
        if (alive) setData(d)
      } catch (e) {
        onAuthError?.(e)
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [taskGid, onAuthError])

  const t = data?.task

  return (
    <Modal title="태스크 상세" onClose={onClose} maxW="max-w-2xl">
      <div className="p-6 space-y-5">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> 불러오는 중...
          </div>
        )}
        {error && !loading && (
          <div className="py-10 text-center text-sm text-red-500 dark:text-red-400">{error}</div>
        )}

        {t && !loading && (
          <>
            {/* 제목 + 상태 + 링크 */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                {t.completed
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />}
                <h4 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">{t.name || taskName}</h4>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {t.status && <Pill className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300">{t.status}</Pill>}
                {t.resource_subtype === 'milestone' && <Pill className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300">마일스톤</Pill>}
                {t.completed && <Pill className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300">완료됨</Pill>}
                {t.permalink_url && (
                  <a href={t.permalink_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline ml-auto">
                    Asana에서 열기 <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* 기본 정보 그리드 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <Field icon={User} label="담당자">
                {t.assignee || <Muted>없음</Muted>}
                {t.assignee_email && <span className="text-xs text-slate-400 ml-1">({t.assignee_email})</span>}
              </Field>
              <Field icon={Calendar} label="기간">
                {fmtRange(t.start_on || t.start_at, t.due_on || t.due_at) || <Muted>미정</Muted>}
              </Field>
              <Field icon={FolderKanban} label="프로젝트">
                {t.projects?.length ? t.projects.join(', ') : <Muted>없음</Muted>}
              </Field>
              <Field icon={ListTree} label="섹션">
                {t.sections?.length ? t.sections.join(', ') : <Muted>없음</Muted>}
              </Field>
              <Field icon={Calendar} label="생성일">{fmtDateTime(t.created_at) || <Muted>-</Muted>}</Field>
              <Field icon={Calendar} label="수정일">{fmtDateTime(t.modified_at) || <Muted>-</Muted>}</Field>
              {t.completed_at && <Field icon={CheckCircle2} label="완료일">{fmtDateTime(t.completed_at)}{t.completed_by && <span className="text-xs text-slate-400 ml-1">({t.completed_by})</span>}</Field>}
              {t.followers?.length > 0 && <Field icon={User} label="팔로워">{t.followers.join(', ')}</Field>}
              {t.parent && <Field icon={ListTree} label="상위 태스크">{t.parent.name}</Field>}
            </div>

            {/* 태그 */}
            {t.tags?.length > 0 && (
              <Section icon={TagIcon} title="태그">
                <div className="flex flex-wrap gap-1.5">
                  {t.tags.map((tag, i) => (
                    <Pill key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{tag.name}</Pill>
                  ))}
                </div>
              </Section>
            )}

            {/* 커스텀 필드 */}
            {t.custom_fields?.length > 0 && (
              <Section title="커스텀 필드">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {t.custom_fields.map((f, i) => (
                    <div key={i} className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 py-1">
                      <span className="text-slate-500 dark:text-slate-400">{f.name}</span>
                      <span className="text-slate-800 dark:text-slate-100 font-medium text-right">{f.value}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* 설명 */}
            {t.notes?.trim() && (
              <Section title="설명">
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{t.notes}</p>
              </Section>
            )}

            {/* 하위 태스크 */}
            {data.subtasks?.length > 0 && (
              <Section icon={ListTree} title={`하위 태스크 (${data.subtasks.length})`}>
                <ul className="space-y-1">
                  {data.subtasks.map((s) => (
                    <li key={s.gid} className="flex items-center gap-2 text-sm">
                      {s.completed
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        : <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />}
                      <span className="text-slate-700 dark:text-slate-200">{s.name}</span>
                      {s.assignee && <span className="text-xs text-slate-400">· {s.assignee}</span>}
                      {s.due_on && <span className="text-xs text-slate-400">· ~{s.due_on}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* 댓글 */}
            {data.comments?.length > 0 && (
              <Section icon={MessageSquare} title={`댓글 (${data.comments.length})`}>
                <ul className="space-y-2.5">
                  {data.comments.map((c, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{c.author || '알 수 없음'}</span>
                        <span className="text-[11px] text-slate-400">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap pl-0.5">{c.text}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* 첨부 */}
            {data.attachments?.length > 0 && (
              <Section icon={Paperclip} title={`첨부파일 (${data.attachments.length})`}>
                <ul className="space-y-1">
                  {data.attachments.map((a) => (
                    <li key={a.gid} className="text-sm">
                      <a href={a.view_url || a.download_url || '#'} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline">
                        <Paperclip className="w-3.5 h-3.5" /> {a.name || '(이름 없음)'}
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── 작은 컴포넌트 ────────────────────────────────────────────────────
function Field({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <span className="text-[11px] font-bold text-slate-400 uppercase block">{label}</span>
        <span className="text-slate-800 dark:text-slate-100">{children}</span>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
        {Icon && <Icon className="w-4 h-4" />} {title}
      </p>
      {children}
    </div>
  )
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${className}`}>{children}</span>
}

function Muted({ children }) {
  return <span className="text-slate-400 dark:text-slate-500">{children}</span>
}

function fmtDateTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
}

function fmtRange(start, due) {
  const s = start ? String(start).slice(0, 10) : ''
  const d = due ? String(due).slice(0, 10) : ''
  if (!s && !d) return ''
  if (s && d) return s === d ? d : `${s} ~ ${d}`
  return s || `~${d}`
}
