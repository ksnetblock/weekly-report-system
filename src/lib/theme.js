// 테마(라이트/다크) 관리. .dark 클래스를 <html>에 토글하고 localStorage에 저장한다.
// 디폴트는 다크. 최초 적용은 index.html 의 부트 스크립트가 담당(깜빡임 방지).
import { useEffect, useState } from 'react'

const KEY = 'theme'

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* localStorage 접근 불가 시 무시 */
  }
  return 'dark' // 디폴트
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* 저장 실패는 무시 */
  }
}

// 헤더 토글에서 쓰는 훅. [theme, toggle] 반환.
export function useTheme() {
  const [theme, setTheme] = useState(getTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return [theme, toggle]
}
