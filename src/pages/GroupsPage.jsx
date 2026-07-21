import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, Plus, Edit3, Trash2, FolderTree, FolderPlus, X, Check,
  FileText, Search, CircleAlert,
} from 'lucide-react'
import * as api from '../lib/api.js'
import { asanaColorToHex } from '../lib/helpers.js'
import { useToast } from '../components/Toast.jsx'
import Modal, { ColorPicker, PALETTE } from '../components/Modal.jsx'

// 그룹 관리 — 그룹 정의(이름·색·설명) 편집 + Asana 프로젝트 조회/배정 + 이름·설명 관리
export default function GroupsPage({ onAuthError }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [projectMeta, setProjectMeta] = useState([])

  const [groupForm, setGroupForm] = useState(null)   // 'new' | group | null
  const [assignTo, setAssignTo] = useState(null)     // 배정 대상 그룹

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { groups, projectMeta } = await api.getManualLayer()
      setGroups(groups)
      setProjectMeta(projectMeta)
    } catch (e) {
      onAuthError(e)
      toast('불러오기 실패', e.message, 'warning')
    } finally {
      setLoading(false)
    }
  }, [toast, onAuthError])

  useEffect(() => { load() }, [load])

  const guard = async (fn, okMsg) => {
    try {
      await fn()
      if (okMsg) toast('완료', okMsg, 'success')
      await load()
      return true
    } catch (e) {
      onAuthError(e)
      toast('오류', e.message, 'warning')
      return false
    }
  }

  const saveGroup = (g) => guard(() => api.upsertGroup(g), '그룹이 저장되었습니다.').then((ok) => { if (ok) setGroupForm(null) })
  const deleteGroup = (id) => guard(() => api.deleteGroup(id), '그룹이 삭제되었습니다.')
  const assignProject = (groupId, proj) =>
    guard(() => api.setProjectMeta(proj.gid, { group_id: groupId, name: proj.name }), '프로젝트가 배정되었습니다.')
  const unassignProject = (gid) => guard(() => api.setProjectMeta(gid, { group_id: '' }), '배정이 해제되었습니다.')
  const saveProjectMeta = (gid, patch) => guard(() => api.setProjectMeta(gid, patch), '프로젝트가 저장되었습니다.')
  const uploadProjectIcon = (gid, file) => guard(() => api.uploadProjectIcon(gid, file), '아이콘이 업로드되었습니다.')
  const deleteProjectIcon = (gid) => guard(() => api.deleteProjectIcon(gid), '기본 아이콘으로 되돌렸습니다.')

  const projectsByGroup = useMemo(() => {
    const map = new Map(groups.map((g) => [g.id, []]))
    for (const p of projectMeta) {
      if (p.group_id && map.has(p.group_id)) map.get(p.group_id).push(p)
    }
    return map
  }, [groups, projectMeta])

  // asana_gid → 소속 그룹명 (배정 모달에서 '다른 그룹에 배정됨' 표시용)
  const groupNameByGid = useMemo(() => {
    const gname = new Map(groups.map((g) => [g.id, g.name]))
    const m = new Map()
    for (const p of projectMeta) if (p.group_id) m.set(p.asana_gid, gname.get(p.group_id))
    return m
  }, [groups, projectMeta])

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 불러오는 중...
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">그룹 관리</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            그룹을 정의하고, Asana에서 프로젝트를 조회해 각 그룹에 배정합니다. 프로젝트 이름과 설명은 여기서 편집합니다.
          </p>
        </div>
        <button onClick={() => setGroupForm('new')}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-md flex-shrink-0">
          <Plus className="w-4 h-4" /> 새 그룹
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center py-20 text-center">
          <FolderTree className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">아직 그룹이 없습니다.</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">위의 &lsquo;새 그룹&rsquo; 버튼으로 첫 그룹을 만드세요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              projects={projectsByGroup.get(g.id) || []}
              onEdit={() => setGroupForm(g)}
              onDelete={() => { if (confirm(`'${g.name}' 그룹을 삭제할까요? (프로젝트는 미분류로 이동)`)) deleteGroup(g.id) }}
              onAssign={() => setAssignTo(g)}
              onUnassign={unassignProject}
              onSaveProject={saveProjectMeta}
              onUploadIcon={uploadProjectIcon}
              onDeleteIcon={deleteProjectIcon}
            />
          ))}
        </div>
      )}

      {groupForm && (
        <GroupFormModal
          group={groupForm === 'new' ? null : groupForm}
          onSave={saveGroup}
          onClose={() => setGroupForm(null)}
        />
      )}

      {assignTo && (
        <AssignProjectModal
          group={assignTo}
          groupNameByGid={groupNameByGid}
          onAssign={(proj) => assignProject(assignTo.id, proj)}
          onClose={() => setAssignTo(null)}
          onAuthError={onAuthError}
        />
      )}
    </main>
  )
}

// ── 그룹 카드 ────────────────────────────────────────────────────────
function GroupCard({ group, projects, onEdit, onDelete, onAssign, onUnassign, onSaveProject, onUploadIcon, onDeleteIcon }) {
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3"
        style={{ borderLeft: `4px solid ${group.color || '#6366f1'}` }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: group.color || '#6366f1' }} />
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">{group.name}</h3>
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full flex-shrink-0">
              프로젝트 {projects.length}
            </span>
          </div>
          {group.description && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap">{group.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} title="그룹 편집"
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700"><Edit3 className="w-4 h-4" /></button>
          <button onClick={onDelete} title="그룹 삭제"
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
        {projects.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">배정된 프로젝트가 없습니다. 아래에서 Asana 프로젝트를 배정하세요.</p>
        ) : (
          projects.map((p) => (
            <ProjectRow key={p.asana_gid} project={p} onUnassign={() => onUnassign(p.asana_gid)} onSave={onSaveProject}
              onUploadIcon={onUploadIcon} onDeleteIcon={onDeleteIcon} />
          ))
        )}
      </div>

      <div className="px-5 py-3 bg-slate-50/60 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-700">
        <button onClick={onAssign}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg text-sm font-semibold">
          <FolderPlus className="w-4 h-4" /> Asana에서 프로젝트 배정
        </button>
      </div>
    </section>
  )
}

// ── 프로젝트 행 (이름·설명 인라인 편집) ──────────────────────────────
function ProjectRow({ project, onUnassign, onSave, onUploadIcon, onDeleteIcon }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.display_name || project.name || '')
  const [desc, setDesc] = useState(project.description || '')
  const [busy, setBusy] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)

  function start() {
    setName(project.display_name || project.name || '')
    setDesc(project.description || '')
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    const ok = await onSave(project.asana_gid, { display_name: name.trim(), description: desc })
    setBusy(false)
    if (ok) setEditing(false)
  }

  async function handleIconChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setIconBusy(true)
    await onUploadIcon(project.asana_gid, file)
    setIconBusy(false)
  }

  async function handleIconRemove(ev) {
    ev.preventDefault()
    ev.stopPropagation()
    setIconBusy(true)
    await onDeleteIcon(project.asana_gid)
    setIconBusy(false)
  }

  if (editing) {
    return (
      <div className="px-5 py-4 space-y-2 bg-indigo-50/30 dark:bg-indigo-950/20">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">프로젝트 이름</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="표시할 프로젝트 이름"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">설명</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="프로젝트에 대한 상세 설명"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 resize-y" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setEditing(false)} disabled={busy}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><X className="w-4 h-4" /> 취소</button>
          <button onClick={save} disabled={busy || !name.trim()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-md inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 저장
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 py-4 flex items-start gap-3 group">
      <div className="relative mt-0.5 flex-shrink-0 group/icon">
        <label
          title={project.icon_url ? '로고 이미지 변경' : '로고 이미지 업로드'}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 overflow-hidden cursor-pointer hover:ring-2 hover:ring-indigo-400"
        >
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="hidden"
            onChange={handleIconChange} disabled={iconBusy} />
          {iconBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : project.icon_url ? (
            <img src={project.icon_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
        </label>
        {project.icon_url && !iconBusy && (
          <button onClick={handleIconRemove} title="기본 아이콘으로 되돌리기"
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-500 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/icon:opacity-100">
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{project.display_name || project.name || '(이름 없음)'}</p>
        {project.description
          ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap">{project.description}</p>
          : <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">설명 없음</p>}
        <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-1 font-mono">id: {project.asana_gid}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={start} title="이름·설명 편집"
          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700"><Edit3 className="w-4 h-4" /></button>
        <button onClick={onUnassign} title="이 그룹에서 배정 해제"
          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

// ── 그룹 생성/편집 모달 ──────────────────────────────────────────────
function GroupFormModal({ group, onSave, onClose }) {
  const [name, setName] = useState(group?.name || '')
  const [color, setColor] = useState(group?.color || PALETTE[0])
  const [description, setDescription] = useState(group?.description || '')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    await onSave({ id: group?.id || '', name: name.trim(), color, description })
    setBusy(false)
  }

  return (
    <Modal title={group ? '그룹 편집' : '새 그룹'} onClose={onClose} maxW="max-w-md">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">그룹 이름</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 블록체인 인프라"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1.5">색상</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">설명 (정의)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="이 그룹이 무엇을 묶는지에 대한 정의와 설명"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 resize-y" />
        </div>
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">취소</button>
          <button type="submit" disabled={busy || !name.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-md inline-flex items-center gap-1.5">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} 저장
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Asana 프로젝트 배정 모달 ─────────────────────────────────────────
function AssignProjectModal({ group, groupNameByGid, onAssign, onClose, onAuthError }) {
  const [step, setStep] = useState('loading') // 'loading' | 'list' | 'error'
  const [projects, setProjects] = useState([])
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [excludeArchived, setExcludeArchived] = useState(true)
  const [assigningGid, setAssigningGid] = useState(null)

  useEffect(() => {
    api.listAsanaProjects()
      .then((list) => { setProjects(Array.isArray(list) ? list : []); setStep('list') })
      .catch((e) => { onAuthError(e); setErr(e.message || 'Asana 프로젝트 목록을 가져오지 못했습니다.'); setStep('error') })
  }, [onAuthError])

  const filtered = useMemo(() => {
    const kw = q.toLowerCase().trim()
    return projects.filter((p) => {
      if (excludeArchived && p.archived) return false
      return !kw || p.name.toLowerCase().includes(kw)
    })
  }, [projects, q, excludeArchived])

  async function pick(p) {
    setAssigningGid(p.gid)
    await onAssign(p)              // 성공 시 부모가 목록을 다시 불러옴
    setAssigningGid(null)
  }

  return (
    <Modal title={`'${group.name}' 그룹에 프로젝트 배정`} onClose={onClose} maxW="max-w-lg">
      <div className="p-6 space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Asana에서 조회한 프로젝트입니다. 배정하면 프로젝트 <b>id</b>만 저장되며, 이름은 이후 이 페이지에서 수정할 수 있습니다.
          <br />한 프로젝트는 한 그룹에만 속합니다 — 다른 그룹에 배정된 프로젝트를 선택하면 이 그룹으로 이동합니다.
        </p>

        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400 dark:text-slate-500">
            <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
            <span className="text-sm">Asana 프로젝트 목록 불러오는 중...</span>
          </div>
        )}

        {step === 'error' && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-lg p-3">
            <CircleAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{err}</p>
          </div>
        )}

        {step === 'list' && (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Search className="w-4 h-4" /></span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="프로젝트 이름 검색..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0">
                <input type="checkbox" checked={excludeArchived} onChange={(e) => setExcludeArchived(e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">archived 제외</span>
              </label>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1 custom-scrollbar">
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">조회된 프로젝트가 없습니다.</p>
              ) : (
                filtered.map((p) => {
                  const inGroup = groupNameByGid.get(p.gid)
                  const here = inGroup === group.name
                  const color = p.color ? asanaColorToHex(p.color) : '#94a3b8'
                  return (
                    <div key={p.gid}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                        {inGroup && (
                          <p className={`text-[11px] ${here ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {here ? '이 그룹에 배정됨' : `다른 그룹: ${inGroup}`}
                          </p>
                        )}
                      </div>
                      {here ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 flex-shrink-0"><Check className="w-4 h-4" /> 배정됨</span>
                      ) : (
                        <button onClick={() => pick(p)} disabled={assigningGid === p.gid}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1 flex-shrink-0">
                          {assigningGid === p.gid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {inGroup ? '이동' : '배정'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">닫기</button>
        </div>
      </div>
    </Modal>
  )
}
