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
    const { password, action = 'sync', label, note, project_gids: reqGids, exclude_meetings: excludeMeetings = false, exclude_archived: excludeArchived = false, include_activity: includeActivity = true, period_start: periodStart, period_end: periodEnd, task_gid: taskGid } = await req.json().catch(() => ({}))
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

    // 동시 실행 수 제한 병렬 map — 여러 태스크의 스토리를 한꺼번에 조회하되 Asana rate limit 보호
    const mapLimit = async <T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> => {
      let i = 0
      const worker = async () => {
        while (i < items.length) {
          const idx = i++
          await fn(items[idx])
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    }

    // 태스크의 '기간 내' 변동내역(스토리) 조회 — created_at 이 [startMs, endMs] 안인 것만
    const fetchTaskActivity = async (gid: string, startMs: number, endMs: number) => {
      const res = await asanaGet(`/tasks/${gid}/stories?opt_fields=type,resource_subtype,text,created_at,created_by.name`)
      return (res.data || [])
        .filter((s: any) => {
          const ts = s.created_at ? new Date(s.created_at).getTime() : NaN
          return !Number.isNaN(ts) && ts >= startMs && ts <= endMs
        })
        .map((s: any) => ({
          type: s.type ?? null,
          subtype: s.resource_subtype ?? null,
          text: s.text ?? '',
          created_at: s.created_at ?? null,
          author: s.created_by?.name ?? null,
        }))
    }

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
      // 정식 프로젝트 목록 엔드포인트 사용 — typeahead(자동완성)는 archived 필드를 신뢰성 있게 채우지 않고
      // 관련도순 일부만 반환하므로 '보관됨 제외' 필터가 무력화된다. /projects 는 archived 를 정확히 반환하고
      // 워크스페이스의 모든 프로젝트를 페이지네이션으로 완전히 열거한다.
      const results: Array<{ gid: string; name: string; color?: string; archived: boolean }> = []
      let offset: string | undefined
      do {
        const q = new URLSearchParams({ workspace, limit: '100', opt_fields: 'name,color,archived' })
        if (offset) q.set('offset', offset)
        const r = await asanaGet(`/projects?${q.toString()}`)
        for (const p of r.data || []) {
          if (isMeeting(p.name)) continue
          results.push({ gid: p.gid, name: p.name, color: p.color, archived: !!p.archived })
        }
        offset = r.next_page?.offset
      } while (offset)
      return results
    }

    // action === 'list' : 프로젝트 목록만 반환
    if (action === 'list') {
      const projectList = await fetchProjectList()
      return json({ projects: projectList })
    }

    // action === 'task' : 단일 태스크 상세 (상세보기 모달용) — 하위태스크/댓글/첨부 포함
    if (action === 'task') {
      if (!taskGid) return json({ error: 'task_gid 가 필요합니다.' }, 400)
      const detailFields = [
        'name', 'notes', 'html_notes', 'completed', 'completed_at', 'created_at', 'modified_at',
        'due_on', 'due_at', 'start_on', 'start_at', 'assignee_status', 'num_subtasks', 'resource_subtype',
        'permalink_url', 'liked', 'num_likes',
        'assignee.name', 'assignee.email',
        'completed_by.name',
        'followers.name',
        'parent.name', 'parent.gid',
        'projects.name',
        'memberships.project.name', 'memberships.section.name',
        'tags.name', 'tags.color',
        'custom_fields.name', 'custom_fields.display_value', 'custom_fields.type',
      ].join(',')

      const detail = await asanaGet(`/tasks/${taskGid}?opt_fields=${detailFields}`)
      const t = detail.data

      // 하위 태스크 / 댓글(스토리) / 첨부는 실패해도 본문은 반환 (best-effort)
      const safe = async (fn: () => Promise<any>, fallback: any) => {
        try { return await fn() } catch { return fallback }
      }
      const subsRes = await safe(() => asanaGet(`/tasks/${taskGid}/subtasks?opt_fields=name,completed,due_on,assignee.name`), { data: [] })
      const storiesRes = await safe(() => asanaGet(`/tasks/${taskGid}/stories?opt_fields=type,resource_subtype,text,created_at,created_by.name`), { data: [] })
      const attachRes = await safe(() => asanaGet(`/tasks/${taskGid}/attachments?opt_fields=name,download_url,view_url,created_at,host`), { data: [] })

      const comments = (storiesRes.data || [])
        .filter((s: any) => s.type === 'comment' || s.resource_subtype === 'comment_added')
        .map((s: any) => ({ text: s.text ?? '', created_at: s.created_at ?? null, author: s.created_by?.name ?? null }))

      const statusField = (t.custom_fields || []).find((f: any) => f.name === '상태')

      return json({
        task: {
          gid: t.gid,
          name: t.name,
          notes: t.notes ?? '',
          html_notes: t.html_notes ?? '',
          completed: !!t.completed,
          completed_at: t.completed_at ?? null,
          completed_by: t.completed_by?.name ?? null,
          created_at: t.created_at ?? null,
          modified_at: t.modified_at ?? null,
          start_on: t.start_on ?? null,
          start_at: t.start_at ?? null,
          due_on: t.due_on ?? null,
          due_at: t.due_at ?? null,
          resource_subtype: t.resource_subtype ?? 'default_task',
          assignee: t.assignee?.name ?? null,
          assignee_email: t.assignee?.email ?? null,
          followers: (t.followers || []).map((f: any) => f.name).filter(Boolean),
          parent: t.parent ? { gid: t.parent.gid, name: t.parent.name } : null,
          projects: (t.projects || []).map((p: any) => p.name).filter(Boolean),
          sections: (t.memberships || []).map((m: any) => m.section?.name).filter(Boolean),
          tags: (t.tags || []).map((tag: any) => ({ name: tag.name, color: tag.color ?? null })),
          status: statusField?.display_value ?? null,
          custom_fields: (t.custom_fields || [])
            .filter((f: any) => f.display_value != null && f.display_value !== '')
            .map((f: any) => ({ name: f.name, value: f.display_value, type: f.type })),
          permalink_url: t.permalink_url ?? null,
          num_likes: t.num_likes ?? 0,
        },
        subtasks: (subsRes.data || []).map((s: any) => ({
          gid: s.gid, name: s.name, completed: !!s.completed, due_on: s.due_on ?? null, assignee: s.assignee?.name ?? null,
        })),
        comments,
        attachments: (attachRes.data || []).map((a: any) => ({
          gid: a.gid, name: a.name, download_url: a.download_url ?? null, view_url: a.view_url ?? null, host: a.host ?? null, created_at: a.created_at ?? null,
        })),
      })
    }

    // 대상 프로젝트 목록 산출 (list 이외 액션 공통) — reqGids 있으면 그 목록만, 없으면 기본 목록
    const resolveProjectList = async (): Promise<Array<{ gid: string; name: string; color?: string; archived: boolean }>> => {
      let list: Array<{ gid: string; name: string; color?: string; archived: boolean }>
      if (Array.isArray(reqGids) && reqGids.length > 0) {
        list = []
        for (const gid of reqGids) {
          const p = await asanaGet(`/projects/${gid}?opt_fields=name,color,archived`)
          list.push({ gid: p.data.gid, name: p.data.name, color: p.data.color, archived: !!p.data.archived })
        }
      } else {
        list = await fetchProjectList()
      }
      if (excludeArchived) list = list.filter((p) => !p.archived)
      return list
    }

    // action === 'activity' : 특정 태스크의 '기간 내' 활동 로그(스토리)만 반환
    //   → 조회 기간 동안 무엇이 바뀌었는지(상태/담당/일정/필드/댓글 등)를 인라인으로 표시
    if (action === 'activity') {
      if (!taskGid) return json({ error: 'task_gid 가 필요합니다.' }, 400)
      const aStart = periodStart ? new Date(periodStart).getTime() : -Infinity
      const aEnd = periodEnd ? new Date(periodEnd).getTime() : Infinity
      const items = await fetchTaskActivity(taskGid, aStart, aEnd)
      return json({ activity: items })
    }

    // action === 'changes' : 기간 내 완료/수정된 태스크를 프로젝트별로 반환 (주간보고용)
    if (action === 'changes') {
      if (!periodStart || !periodEnd) return json({ error: 'period_start/period_end 가 필요합니다.' }, 400)
      const startMs = new Date(periodStart).getTime()
      const endMs = new Date(periodEnd).getTime()
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return json({ error: '기간 형식이 올바르지 않습니다.' }, 400)
      const inRange = (iso: string | null) => {
        if (!iso) return false
        const t = new Date(iso).getTime()
        return t >= startMs && t <= endMs
      }

      const projectList = await resolveProjectList()
      const outProjects: any[] = []
      const allTasks: any[] = [] // 변동내역을 붙이기 위한 태스크 참조 수집

      for (const pc of projectList) {
        const tasks: any[] = []
        let offset: string | undefined
        do {
          const q = new URLSearchParams({
            limit: '100',
            opt_fields: 'name,gid,completed,completed_at,modified_at,assignee.name,memberships.project.gid,memberships.section.name,resource_subtype,custom_fields.name,custom_fields.display_value',
          })
          if (offset) q.set('offset', offset)
          const tr = await asanaGet(`/projects/${pc.gid}/tasks?${q.toString()}`)
          for (const t of tr.data || []) {
            if (excludeMeetings && isMeeting(t.name)) continue

            const completedInRange = inRange(t.completed_at ?? null)
            const modifiedInRange = inRange(t.modified_at ?? null)
            if (!completedInRange && !modifiedInRange) continue

            // 현재 프로젝트에서의 섹션 이름(있으면) — 표시용
            const memberships = t.memberships || []
            let m = memberships.find((x: any) => x.project?.gid === pc.gid && x.section)
            if (!m) m = memberships.find((x: any) => x.section)
            const sectionName = m?.section?.name ?? null
            if (excludeMeetings && sectionName && isMeeting(sectionName)) continue

            const statusField = (t.custom_fields || []).find((f: any) => f.name === '상태')
            const status = statusField?.display_value ?? null

            tasks.push({
              gid: t.gid,
              name: t.name,
              assignee: t.assignee?.name ?? null,
              status,
              section_name: sectionName,
              changeType: completedInRange ? 'completed' : 'modified',
              completed_at: t.completed_at ?? null,
              modified_at: t.modified_at ?? null,
            })
          }
          offset = tr.next_page?.offset
        } while (offset)

        if (tasks.length > 0) {
          // 완료 먼저, 그 다음 수정
          tasks.sort((a, b) => (a.changeType === b.changeType ? 0 : a.changeType === 'completed' ? -1 : 1))
          outProjects.push({ gid: pc.gid, name: pc.name, tasks })
          allTasks.push(...tasks)
        }
      }

      // 각 변동 태스크의 기간 내 변동내역을 서버에서 병렬 조회해 함께 반환 (턴키)
      // → 프론트는 '가져오기' 한 번으로 목록+변동내역을 모두 확보, 태스크마다 재요청 불필요.
      // includeActivity=false 면 조회를 건너뜀(가져오기 속도 우선) → 개별 펼침 시 지연 조회로 폴백.
      if (includeActivity) {
        await mapLimit(allTasks, 8, async (t) => {
          try { t.activity = await fetchTaskActivity(t.gid, startMs, endMs) }
          catch { t.activity = [] } // 단일 태스크 실패는 전체를 막지 않음 (best-effort)
        })
      }

      // project_gids: 필터(회의록 제외 · 보관됨 제외)를 통과한 전체 프로젝트 목록.
      // 프론트는 수동 레이어(project_meta)를 이 목록으로 제한해 그린다 — 변동 없는
      // 회의록/보관 프로젝트가 '변동사항 없음'으로 표시되는 것을 막기 위함.
      return json({ projects: outProjects, project_gids: projectList.map((p) => p.gid) })
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
