// =====================================================================
//  Supabase Edge Function: project-icon
//  - 그룹 관리 페이지에서 프로젝트별 로고 이미지를 업로드/삭제
//  - 비밀번호를 서버에서 검증한 뒤, service role 키로 Storage에 기록
//    (anon 키로는 storage RLS를 열지 않는 한 업로드 불가 → 이 함수를 통해서만 업로드)
//
//  필요한 secrets (Supabase에 등록, 대부분 런타임에서 자동 제공):
//    SUPABASE_URL              : 자동 제공
//    SUPABASE_ANON_KEY         : 자동 제공 (비밀번호 검증용)
//    SUPABASE_SERVICE_ROLE_KEY : 자동 제공 (Storage 업로드/삭제용, RLS 우회)
//
//  요청 바디:
//    업로드: { password, action: 'upload', gid, filename, content_type, data(base64) }
//    삭제:   { password, action: 'delete', gid }
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'project-icons'
const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const { password, action, gid, filename, content_type: contentType, data } = await req.json().catch(() => ({}))
    if (!password) return json({ error: 'password_required' }, 400)
    if (!gid) return json({ error: 'gid_required' }, 400)

    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )

    // 1) 비밀번호부터 서버 검증 (Storage 접근 전)
    const { data: ok, error: vErr } = await anon.rpc('verify_access', { p_password: password })
    if (vErr) return json({ error: vErr.message }, 500)
    if (ok !== true) return json({ error: 'invalid_password' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (action === 'delete') {
      // 기존 아이콘 전부 제거(확장자 무관) 후 메타의 icon_url 비움
      const { data: existing } = await admin.storage.from(BUCKET).list('', { search: gid })
      const toRemove = (existing || []).filter((f) => f.name.startsWith(`${gid}.`)).map((f) => f.name)
      if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove)

      const { error: mErr } = await admin.rpc('set_project_meta', {
        p_password: password, p_gid: gid, p_patch: { icon_url: '' },
      })
      if (mErr) return json({ error: mErr.message }, 500)
      return json({ ok: true })
    }

    if (action === 'upload') {
      if (!contentType || !ALLOWED_TYPES.has(contentType)) {
        return json({ error: '지원하지 않는 이미지 형식입니다. (png, jpg, webp, svg, gif만 허용)' }, 400)
      }
      if (!data) return json({ error: 'data_required' }, 400)

      const bytes = base64ToBytes(data)
      if (bytes.byteLength > MAX_BYTES) return json({ error: '이미지 용량은 2MB 이하만 업로드할 수 있습니다.' }, 400)

      // 확장자 바뀌는 경우를 대비해 기존 파일 정리 후 새로 저장
      const { data: existing } = await admin.storage.from(BUCKET).list('', { search: gid })
      const toRemove = (existing || []).filter((f) => f.name.startsWith(`${gid}.`)).map((f) => f.name)
      if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove)

      const ext = EXT_BY_TYPE[contentType] || (filename?.split('.').pop() ?? 'png')
      const path = `${gid}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType, upsert: true, cacheControl: '3600',
      })
      if (upErr) return json({ error: upErr.message }, 500)

      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
      // 캐시 무효화를 위해 버전 쿼리 붙임(교체해도 브라우저가 이전 이미지를 캐시하지 않도록)
      const iconUrl = `${pub.publicUrl}?v=${Date.now()}`

      const { error: mErr } = await admin.rpc('set_project_meta', {
        p_password: password, p_gid: gid, p_patch: { icon_url: iconUrl },
      })
      if (mErr) return json({ error: mErr.message }, 500)

      return json({ ok: true, icon_url: iconUrl })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
