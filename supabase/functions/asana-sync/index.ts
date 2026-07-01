// =====================================================================
//  Supabase Edge Function: asana-sync
//  - Asana API에서 프로젝트/섹션/태스크를 가져와 report_versions 에 새 버전 저장
//  - Asana 토큰은 이 함수의 secret(서버 환경변수)에만 존재 → 브라우저 노출 없음
//
//  필요한 secrets (Supabase에 등록):
//    ASANA_TOKEN          : Asana Personal Access Token (Bearer)
//    ASANA_WORKSPACE_GID  : 워크스페이스 GID (예: 1205879917489493)
//    ASANA_PROJECT_GIDS   : (선택) 콤마구분 프로젝트 GID 목록.
//                           지정하면 그 프로젝트만, 비우면 워크스페이스 전체(typeahead) 사용
//  (SUPABASE_URL / SUPABASE_ANON_KEY 는 런타임에서 자동 제공)
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ASANA = 'https://app.asana.com/api/1.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const { password, action = 'sync', label, note, project_gids: reqGids, exclude_meetings: excludeMeetings = false, exclude_archived: excludeArchived = false } = await req.json().catch(() => ({}))
    if (!password) return json({ error: 'password_required' }, 400)

    const token = Deno.env.get('ASANA_TOKEN')
    const workspace = Deno.env.get('ASANA_WORKSPACE_GID')
    const projectGidsEnv = Deno.env.get('ASANA_PROJECT_GIDS') || ''
    if (!token) return json({ error: 'ASANA_TOKEN 시크릿이 설정되지 않았습니다.' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )

    // 1) 비싼 Asana 호출 전에 접근 비밀번호부터 서버 검증
    const { data: ok, error: vErr } = await supabase.rpc('verify_access', { p_password: password })
    if (vErr) return json({ error: vErr.message }, 500)
    if (ok !== true) return json({ error: 'invalid_password' }, 401)

    const headers = { Authorization: `Bearer ${token}` }
    const asanaGet = async (path: string) => {
      const res = await fetch(`${ASANA}${path}`, { headers })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Asana ${res.status} ${path}: ${t.slice(0, 300)}`)
      }
      return res.json()
    }

    const isMeeting = (name: string) => name.includes('회의록')

    // 2) 대상 프로젝트 목록 조회 (list 액션 / sync 공통) — '회의록' 프로젝트는 항상 제외, archived 포함 반환
    const fetchProjectList = async (): Promise<Array<{ gid: string; name: string; color?: string; archived: boolean }>> => {
      const explicit = projectGidsEnv.split(',').map((s) => s.trim()).filter(Boolean)
      if (explicit.length) {
        const results = []
        for (const gid of explicit) {
          const p = await asanaGet(`/projects/${gid}?opt_fields=name,color,archived`)
          if (isMeeting(p.data.name)) continue
          results.push({ gid: p.data.gid, name: p.data.name, color: p.data.color, archived: !!p.data.archived })
        }
        return results
      }
      if (!workspace) throw new Error('ASANA_WORKSPACE_GID 시크릿이 필요합니다(또는 ASANA_PROJECT_GIDS 지정).')
      const r = await asanaGet(`/workspaces/${workspace}/typeahead?resource_type=project&count=100&opt_fields=name,color,archived`)
      return (r.data || [])
        .filter((p: any) => !isMeeting(p.name))
        .map((p: any) => ({ gid: p.gid, name: p.name, color: p.color, archived: !!p.archived }))
    }

    // action === 'list' : 프로젝트 목록만 반환
    if (action === 'list') {
      const projectList = await fetchProjectList()
      return json({ projects: projectList })
    }

    // action === 'sync' : 전체 동기화
    // 요청에 project_gids 가 있으면 그 목록만, 없으면 기본 목록 사용
    let projectList: Array<{ gid: string; name: string; color?: string; archived: boolean }>
    if (Array.isArray(reqGids) && reqGids.length > 0) {
      projectList = []
      for (const gid of reqGids) {
        const p = await asanaGet(`/projects/${gid}?opt_fields=name,color,archived`)
        projectList.push({ gid: p.data.gid, name: p.data.name, color: p.data.color, archived: !!p.data.archived })
      }
    } else {
      projectList = await fetchProjectList()
    }
    // excludeArchived: archived 프로젝트 제외
    if (excludeArchived) projectList = projectList.filter((p) => !p.archived)

    // 3) 각 프로젝트의 상세 + 섹션 + 태스크 수집
    const projects: any[] = []
    let nSec = 0, nTask = 0, nDone = 0

    for (const pc of projectList) {
      const detail = await asanaGet(
        `/projects/${pc.gid}?opt_fields=name,color,start_on,due_on,owner.name,sections.name,sections.gid`,
      )
      const d = detail.data
      // excludeMeetings: '회의록' 섹션 제외
      const sections: any[] = (d.sections || [])
        .filter((s: any) => !(excludeMeetings && isMeeting(s.name)))
        .map((s: any) => ({ gid: s.gid, name: s.name, tasks: [] }))
      const sectionMap = new Map<string, any>(sections.map((s) => [s.gid, s]))

      // 태스크 (페이지네이션) — 섹션 없는 태스크는 건너뜀
      let offset: string | undefined
      do {
        const q = new URLSearchParams({
          limit: '100',
          opt_fields: 'name,gid,completed,due_on,start_on,assignee.name,memberships.project.gid,memberships.section.gid,memberships.section.name,resource_subtype,custom_fields.name,custom_fields.display_value',
        })
        if (offset) q.set('offset', offset)
        const tr = await asanaGet(`/projects/${pc.gid}/tasks?${q.toString()}`)
        for (const t of tr.data || []) {
          if (excludeMeetings && isMeeting(t.name)) continue

          // 이 태스크가 "현재 프로젝트"에서 속한 섹션을 찾는다.
          // memberships 는 태스크가 속한 모든 프로젝트의 섹션을 담으므로 project.gid 로 현재 것만 선별,
          // project 필드가 안 올 경우(스펙상 생략 가능) 섹션 있는 membership 으로 폴백.
          const memberships = t.memberships || []
          let m = memberships.find((x: any) => x.project?.gid === pc.gid && x.section)
          if (!m) m = memberships.find((x: any) => x.section)
          const sec = m?.section
          if (!sec?.gid) continue                                    // 섹션 없는 태스크 제외
          if (excludeMeetings && isMeeting(sec.name || '')) continue  // 회의록 섹션 소속 태스크 제외(이름 기준 확정)
          if (!sectionMap.has(sec.gid)) continue                     // 이 프로젝트에서 유지된 섹션이 아니면 제외

          // 커스텀필드 '상태' enum 값을 태스크 상태로 사용
          const statusField = (t.custom_fields || []).find((f: any) => f.name === '상태')
          const status = statusField?.display_value ?? null

          const task = {
            gid: t.gid,
            name: t.name,
            completed: !!t.completed,
            start_on: t.start_on ?? null,
            due_on: t.due_on ?? null,
            assignee: t.assignee?.name ?? null,
            resource_subtype: t.resource_subtype ?? 'default_task',
            status,
            section_gid: sec.gid,
          }
          nTask++
          if (status === '완료' || t.completed) nDone++
          sectionMap.get(sec.gid).tasks.push(task)
        }
        offset = tr.next_page?.offset
      } while (offset)

      nSec += sections.length

      projects.push({
        gid: d.gid,
        name: d.name,
        color: d.color ?? pc.color ?? null,
        start_on: d.start_on ?? null,
        due_on: d.due_on ?? null,
        owner_name: d.owner?.name ?? null,
        sections,
      })
    }

    const payload = { projects, exported_at: new Date().toISOString() }
    const summary = { projects: projects.length, sections: nSec, tasks: nTask, completed: nDone }

    // 4) 새 버전 저장 (비밀번호 재검증 포함)
    const { data: created, error: cErr } = await supabase.rpc('create_version', {
      p_password: password,
      p_label: label || '',
      p_note: note || '',
      p_payload: payload,
      p_summary: summary,
    })
    if (cErr) return json({ error: cErr.message }, 500)

    return json({ ok: true, version_id: created?.id, summary })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
