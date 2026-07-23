// =====================================================================
//  Supabase Edge Function: project-gallery
//  - 그룹 관리 페이지에서 프로젝트별 "참고 이미지"(여러 장)를 업로드/삭제
//  - project-icon 함수와 동일한 패턴: 비밀번호 서버 검증 후 service role 키로 Storage 기록
//
//  필요한 secrets: 대부분 런타임 자동 제공 (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)
//
//  요청 바디:
//    업로드: { password, action: 'upload', gid, filename, content_type, data(base64), caption? }
//    삭제:   { password, action: 'delete', image_id }
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'project-gallery'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_IMAGES_PER_PROJECT = 30
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
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

function randomId(): string {
  return crypto.randomUUID()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const { password, action, gid, filename, content_type: contentType, data, caption, image_id: imageId } =
      await req.json().catch(() => ({}))
    if (!password) return json({ error: 'password_required' }, 400)

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
      if (!imageId) return json({ error: 'image_id_required' }, 400)

      const { data: row, error: selErr } = await admin
        .from('project_images').select('path').eq('id', imageId).single()
      if (selErr) return json({ error: selErr.message }, 500)
      if (!row) return json({ error: '이미지를 찾을 수 없습니다.' }, 404)

      const { error: rmErr } = await admin.storage.from(BUCKET).remove([row.path])
      if (rmErr) return json({ error: rmErr.message }, 500)

      const { error: delErr } = await admin.rpc('delete_project_image', { p_password: password, p_id: imageId })
      if (delErr) return json({ error: delErr.message }, 500)

      return json({ ok: true })
    }

    if (action === 'upload') {
      if (!gid) return json({ error: 'gid_required' }, 400)
      if (!contentType || !ALLOWED_TYPES.has(contentType)) {
        return json({ error: '지원하지 않는 이미지 형식입니다. (png, jpg, webp, gif만 허용)' }, 400)
      }
      if (!data) return json({ error: 'data_required' }, 400)

      const bytes = base64ToBytes(data)
      if (bytes.byteLength > MAX_BYTES) return json({ error: '이미지 용량은 5MB 이하만 업로드할 수 있습니다.' }, 400)

      const { count, error: cntErr } = await admin
        .from('project_images').select('id', { count: 'exact', head: true }).eq('asana_gid', gid)
      if (cntErr) return json({ error: cntErr.message }, 500)
      if ((count ?? 0) >= MAX_IMAGES_PER_PROJECT) {
        return json({ error: `프로젝트당 이미지는 최대 ${MAX_IMAGES_PER_PROJECT}장까지 업로드할 수 있습니다.` }, 400)
      }

      const ext = EXT_BY_TYPE[contentType] || (filename?.split('.').pop() ?? 'png')
      const path = `${gid}/${randomId()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType, upsert: false, cacheControl: '3600',
      })
      if (upErr) return json({ error: upErr.message }, 500)

      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)

      const { data: added, error: addErr } = await admin.rpc('add_project_image', {
        p_password: password, p_gid: gid, p_url: pub.publicUrl, p_path: path, p_caption: caption || null,
      })
      if (addErr) return json({ error: addErr.message }, 500)

      return json({ ok: true, image: { id: added?.id, url: pub.publicUrl, path, caption: caption || null } })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
