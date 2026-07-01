import { useState } from 'react'
import Modal, { ColorPicker } from './Modal.jsx'

export default function ProjectModal({ project, groups, onSave, onClose }) {
  const [groupId, setGroupId] = useState(project.group_id || '')
  const [color, setColor] = useState(project._color || project.color || '#f18f1a')
  // meta(수동) 날짜 우선, 없으면 Asana 날짜로 초기값 표시
  const [startOn, setStartOn] = useState(project.meta_start_on || project.start_on || '')
  const [dueOn, setDueOn] = useState(project.meta_due_on || project.due_on || '')

  function submit(e) {
    e.preventDefault()
    onSave(project.asana_gid || project.id, {
      group_id: groupId || '',
      color,
      start_on: startOn || '',
      due_on: dueOn || '',
    })
  }

  return (
    <Modal title="프로젝트 설정" onClose={onClose} maxW="max-w-md">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">프로젝트</p>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{project.name}</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">상위 묶음(그룹)</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100">
            <option value="">미분류</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1.5">프로젝트 색상</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1.5">차트 기간 (수동 설정)</label>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2">비워두면 소속 업무 날짜에서 자동으로 계산됩니다.</p>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-0.5">시작일</span>
              <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100" />
            </div>
            <span className="text-slate-300 dark:text-slate-600 mt-4">–</span>
            <div className="flex-1">
              <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-0.5">마감일</span>
              <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100" />
            </div>
          </div>
          {(startOn || dueOn) && (
            <button type="button" onClick={() => { setStartOn(''); setDueOn('') }}
              className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 underline">
              날짜 초기화 (자동 계산으로 되돌리기)
            </button>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg">취소</button>
          <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-md">저장</button>
        </div>
      </form>
    </Modal>
  )
}
