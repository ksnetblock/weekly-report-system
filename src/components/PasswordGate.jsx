import { useState } from 'react'
import { Lock, Loader2, ShieldCheck, Sun, Moon } from 'lucide-react'
import { verifyAccess } from '../lib/api.js'
import { setPassword } from '../lib/auth.js'
import { isConfigured } from '../lib/supabase.js'

export default function PasswordGate({ onUnlock, theme, onToggleTheme }) {
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!pw) return
    setLoading(true)
    setError('')
    try {
      const ok = await verifyAccess(pw)
      if (ok) {
        setPassword(pw)
        onUnlock()
      } else {
        setError('비밀번호가 올바르지 않습니다.')
      }
    } catch (err) {
      setError(err.message || '서버에 연결할 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 p-4 relative">
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          aria-label="테마 전환"
          className="absolute top-4 right-4 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 dark:border-slate-600 bg-white/70 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      )}
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200 dark:shadow-none mb-4">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">업무 로드맵 뷰어</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">접근 비밀번호를 입력하세요</p>
        </div>

        {!isConfigured && (
          <div className="mb-4 text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 rounded-lg p-3">
            ⚠ .env 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다.
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Lock className="w-4 h-4" />
            </span>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="비밀번호"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-700 transition"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold shadow-md shadow-indigo-100 transition"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {loading ? '확인 중...' : '잠금 해제'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-6 leading-relaxed">
          비밀번호는 서버에서 검증되며 데이터는 RLS로 보호됩니다.<br />탭을 닫으면 자동으로 로그아웃됩니다.
        </p>
      </div>
    </div>
  )
}
