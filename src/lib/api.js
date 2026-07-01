import { supabase } from './supabase.js'
import { getPassword } from './auth.js'

// 모든 호출은 비밀번호를 함께 보내고, 서버(RPC/Edge Function)에서 검증합니다.

function unwrap({ data, error }) {
  if (error) {
    if (String(error.message || '').includes('invalid_password')) {
      const e = new Error('비밀번호가 올바르지 않습니다.')
      e.code = 'invalid_password'
      throw e
    }
    throw new Error(error.message || 'DB 요청 중 오류가 발생했습니다.')
  }
  return data
}

// 비밀번호 검증 (로그인)
export async function verifyAccess(password) {
  const res = await supabase.rpc('verify_access', { p_password: password })
  if (res.error) throw new Error(res.error.message)
  return res.data === true
}

// 버전 목록
export async function listVersions() {
  return unwrap(await supabase.rpc('list_versions', { p_password: getPassword() }))
}

// 특정/최신 버전 + 수동 레이어
export async function getRoadmap(versionId = null) {
  return unwrap(await supabase.rpc('get_roadmap', { p_password: getPassword(), p_version_id: versionId }))
}

export async function deleteVersion(id) {
  return unwrap(await supabase.rpc('delete_version', { p_password: getPassword(), p_id: id }))
}

// Asana 프로젝트 목록만 가져오기 (선택 UI용)
export async function listAsanaProjects() {
  const { data, error } = await supabase.functions.invoke('asana-sync', {
    body: { password: getPassword(), action: 'list' },
  })
  if (error) {
    let msg = error.message || 'Asana 프로젝트 목록 조회에 실패했습니다.'
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error } catch { /* noop */ }
    if (msg.includes('invalid_password')) { const e = new Error('비밀번호가 올바르지 않습니다.'); e.code = 'invalid_password'; throw e }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  if (!Array.isArray(data?.projects)) {
    throw new Error('Edge Function이 구버전입니다. Supabase 대시보드에서 asana-sync 함수를 재배포해주세요.')
  }
  return data.projects // [{ gid, name, color }]
}

// Asana 동기화 → 새 버전 생성 (Edge Function 호출)
// projectGids: 선택된 프로젝트 gid 배열. null/빈 배열이면 서버 기본 목록 사용
export async function syncFromAsana({ label = '', note = '', projectGids = null, excludeMeetings = false, excludeArchived = false } = {}) {
  const body = { password: getPassword(), action: 'sync', label, note, exclude_meetings: excludeMeetings, exclude_archived: excludeArchived }
  if (projectGids?.length) body.project_gids = projectGids
  const { data, error } = await supabase.functions.invoke('asana-sync', { body })
  // functions.invoke 는 비-2xx 시 error 에 본문이 안 담길 수 있어 분기 처리
  if (error) {
    let msg = error.message || 'Asana 동기화에 실패했습니다.'
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) msg = ctx.error
    } catch { /* noop */ }
    if (msg.includes('invalid_password')) { const e = new Error('비밀번호가 올바르지 않습니다.'); e.code = 'invalid_password'; throw e }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data // { ok, version_id, summary }
}

// 그룹
export async function upsertGroup(group) {
  return unwrap(await supabase.rpc('upsert_group', { p_password: getPassword(), p_group: group }))
}
export async function deleteGroup(id) {
  return unwrap(await supabase.rpc('delete_group', { p_password: getPassword(), p_id: id }))
}

// 프로젝트 수동 메타(그룹 배정/색상/날짜) — Asana gid 기준
export async function setProjectMeta(gid, patch) {
  return unwrap(await supabase.rpc('set_project_meta', { p_password: getPassword(), p_gid: gid, p_patch: patch }))
}

// 섹션 수동 메타(날짜 오버라이드) — Asana gid 기준
export async function setSectionMeta(gid, patch) {
  return unwrap(await supabase.rpc('set_section_meta', { p_password: getPassword(), p_gid: gid, p_patch: patch }))
}
