import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

let counter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback((title, message = '', type = 'info') => {
    const id = ++counter
    setToasts((t) => [...t, { id, title, message, type }])
    setTimeout(() => remove(id), 3800)
  }, [remove])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ title, message, type, onClose }) {
  const cfg = {
    success: { Icon: CheckCircle2, border: 'border-l-emerald-500', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' },
    warning: { Icon: AlertTriangle, border: 'border-l-amber-500', color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40' },
    info: { Icon: Info, border: 'border-l-indigo-500', color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' },
  }[type] || { Icon: Info, border: 'border-l-indigo-500', color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' }
  const { Icon } = cfg

  return (
    <div className={`max-w-sm w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl p-4 flex items-start gap-3 border-l-4 ${cfg.border}`}>
      <div className={`p-1.5 rounded-lg ${cfg.color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
        {message && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{message}</p>}
      </div>
      <button onClick={onClose} className="text-slate-300 dark:text-slate-500 hover:text-slate-500 dark:hover:text-slate-300">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
