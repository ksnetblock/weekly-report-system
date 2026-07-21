import { NavLink } from 'react-router-dom'
import { Trello, Home, CalendarRange, FolderTree, LogOut, Sun, Moon } from 'lucide-react'

// 모든 페이지 공통 헤더 — 로고 + 페이지 네비게이션 + 테마/잠금
export default function Header({ theme, onToggleTheme, onLogout }) {
  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white"><Trello className="w-6 h-6" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">업무 로드맵 뷰어</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Asana 동기화 · 버전 관리</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/60 p-1 rounded-lg">
            <NavItem to="/" end Icon={Home} label="홈" />
            <NavItem to="/schedule" Icon={CalendarRange} label="일정" />
            <NavItem to="/groups" Icon={FolderTree} label="그룹 관리" />
          </nav>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400">
            <LogOut className="w-4 h-4" /> 잠금
          </button>
        </div>
      </div>
    </header>
  )
}

function NavItem({ to, end, Icon, label }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) =>
        `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition ${
          isActive
            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
        }`
      }>
      <Icon className="w-4 h-4" /> {label}
    </NavLink>
  )
}

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
