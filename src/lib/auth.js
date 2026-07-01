// 접근 비밀번호는 sessionStorage 에만 보관합니다.
//  - 탭을 닫으면 사라짐
//  - 모든 DB 호출(RPC)에 인자로 전달되어 서버에서 검증됨
//  - 비밀번호 자체는 Supabase DB(해시)에만 존재하며, 여기엔 사용자가 입력한 값만 임시 저장
const KEY = 'roadmap_access_pw'

export function getPassword() {
  return sessionStorage.getItem(KEY) || ''
}

export function setPassword(pw) {
  sessionStorage.setItem(KEY, pw)
}

export function clearPassword() {
  sessionStorage.removeItem(KEY)
}

export function hasPassword() {
  return Boolean(sessionStorage.getItem(KEY))
}
