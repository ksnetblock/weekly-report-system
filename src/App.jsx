import { useState, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { hasPassword, clearPassword } from './lib/auth.js'
import { useTheme } from './lib/theme.js'
import PasswordGate from './components/PasswordGate.jsx'
import Header from './components/Header.jsx'
import HomePage from './pages/HomePage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import WeeklyPage from './pages/WeeklyPage.jsx'
import GroupsPage from './pages/GroupsPage.jsx'

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [unlocked, setUnlocked] = useState(hasPassword())

  const lock = useCallback(() => { clearPassword(); setUnlocked(false) }, [])
  // 비밀번호 오류 시 잠금 화면으로 (각 페이지가 API 오류에서 호출)
  const onAuthError = useCallback((e) => { if (e?.code === 'invalid_password') lock() }, [lock])

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} theme={theme} onToggleTheme={toggleTheme} />
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      <Header theme={theme} onToggleTheme={toggleTheme} onLogout={lock} />
      <Routes>
        <Route path="/" element={<HomePage onAuthError={onAuthError} />} />
        <Route path="/schedule" element={<SchedulePage onAuthError={onAuthError} />} />
        <Route path="/weekly" element={<WeeklyPage onAuthError={onAuthError} />} />
        <Route path="/groups" element={<GroupsPage onAuthError={onAuthError} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
