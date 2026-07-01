import { useState } from 'react'
import Modal from './Modal.jsx'

export default function SectionModal({ section, onSave, onClose }) {
  const [startOn, setStartOn] = useState(section.start_on || '')
  const [dueOn, setDueOn] = useState(section.due_on || '')

  function submit(e) {
    e.preventDefault()
    onSave(section.id, { name: section.name, start_on: startOn || '', due_on: dueOn || '' })
  }

  return (
    <Modal title="섹션 날짜 설정" onClose={onClose} maxW="max-w-sm">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">섹션</p>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{section.name}</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1.5">차트 기간 (수동 설정)</label>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">비워두면 소속 업무 날짜에서 자동으로 계산됩니다.</p>
          {!startOn && !dueOn && section._eff_start && (
            <p className="text-[11px] text-indigo-400 dark:text-indigo-500 mb-2">
              현재 적용 중: {section._eff_start} ~ {section._eff_end || section._eff_start}
            </p>
          )}
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
