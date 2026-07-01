import { X } from 'lucide-react'

export default function Modal({ title, onClose, children, maxW = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full ${maxW} flex flex-col max-h-[90vh]`}>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar">{children}</div>
      </div>
    </div>
  )
}

export const PALETTE = ['#f18f1a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

export function ColorPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PALETTE.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full transition ${value === c ? 'ring-2 ring-offset-2 ring-slate-800 dark:ring-slate-200 dark:ring-offset-slate-800' : ''}`}
          style={{ background: c }} />
      ))}
    </div>
  )
}
