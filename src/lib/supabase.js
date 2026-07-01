import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 개발 중 흔한 실수: .env 누락
  console.error(
    '[설정 오류] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.\n' +
    '프로젝트 루트에 .env 파일을 만들고 값을 채운 뒤 dev 서버를 재시작하세요.'
  )
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'public-anon-key', {
  auth: { persistSession: false },
})

export const isConfigured = Boolean(url && anonKey)
