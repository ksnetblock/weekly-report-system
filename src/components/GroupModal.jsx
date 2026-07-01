import { useState } from 'react'
import Modal, { ColorPicker, PALETTE } from './Modal.jsx'
import { Plus, Edit3, Trash2, Check, X, GripVertical } from 'lucide-react'

// 그룹(상위 묶음) 생성/수정/삭제 관리
export default function GroupModal({ groups, projects, onUpsert, onDelete, onClose }) {
  const [editing, setEditing] = useState(null) // {id?, name, color}
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])

  function startNew() { setEditing('new'); setName(''); setColor(PALETTE[0]) }
  function startEdit(g) { setEditing(g.id); setName(g.name); setColor(g.color || PALETTE[0]) }
  function cancel() { setEditing(null) }

  async function save() {
    if (!name.trim()) return
    await onUpsert({ id: editing === 'new' ? '' : editing, name: name.trim(), color })
    setEditing(null)
  }

  const countFor = (gid) => projects.filter((p) => p.group_id === gid).length

  return (
    <Modal title="상위 묶음(그룹) 관리" onClose={onClose}>
      <div className="p-6 space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          프로젝트를 묶는 상위 단위입니다. 각 프로젝트는 행의 <b>연필 아이콘</b>에서 그룹에 배정할 수 있습니다.
        </p>

        <div className="space-y-2">
          {groups.length === 0 && editing !== 'new' && (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">아직 그룹이 없습니다. 아래에서 추가하세요.</p>
          )}

          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
              {editing === g.id ? (
                <EditRow {...{ name, setName, color, setColor, save, cancel }} />
              ) : (
                <>
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: g.color }} />
                  <span className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{g.name}</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{countFor(g.id)}개 프로젝트</span>
                  <button onClick={() => startEdit(g)} className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><Edit3 className="w-4 h-4" /></button>
                  <button onClick={() => { if (confirm(`'${g.name}' 그룹을 삭제할까요? (프로젝트는 미분류로 이동)`)) onDelete(g.id) }}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </>
              )}
            </div>
          ))}

          {editing === 'new' && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/30">
              <EditRow {...{ name, setName, color, setColor, save, cancel }} />
            </div>
          )}
        </div>

        {editing !== 'new' && (
          <button onClick={startNew} className="w-full inline-flex items-center justify-center gap-1.5 py-2 border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-sm font-semibold">
            <Plus className="w-4 h-4" /> 새 그룹 추가
          </button>
        )}
      </div>
    </Modal>
  )
}

function EditRow({ name, setName, color, setColor, save, cancel }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
        placeholder="그룹 이름" className="flex-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <ColorPicker value={color} onChange={setColor} />
      <button onClick={save} className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded"><Check className="w-4 h-4" /></button>
      <button onClick={cancel} className="p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><X className="w-4 h-4" /></button>
    </div>
  )
}
