// 버전 스냅샷(payload) + 수동 레이어(groups, project_meta)
// → Gantt 가 쓰는 평탄화 배열 { groups, projects, sections, tasks }
//
// id 는 Asana gid 를 그대로 사용합니다. (project_id = 프로젝트 gid 등)
export function flatten(roadmap) {
  const payload = roadmap?.payload || { projects: [] }
  const groups = roadmap?.groups || []
  const metaByGid = new Map((roadmap?.project_meta || []).map((m) => [m.asana_gid, m]))
  const sectionMetaByGid = new Map((roadmap?.section_meta || []).map((m) => [m.asana_gid, m]))

  const projects = []
  const sections = []
  const tasks = []

  for (const p of payload.projects || []) {
    const meta = metaByGid.get(p.gid) || {}
    projects.push({
      id: p.gid,
      asana_gid: p.gid,
      name: meta.display_name || p.name,   // 표시 이름 오버라이드 우선
      asana_name: p.name,
      description: meta.description || null,
      group_id: meta.group_id || null,
      color: meta.color || null,
      asana_color: p.color || null,
      owner_name: p.owner_name || null,
      start_on: meta.start_on || p.start_on || null,  // 수동 오버라이드 우선
      due_on: meta.due_on || p.due_on || null,
      meta_start_on: meta.start_on || null,            // 편집 모달용 (수동 설정값만)
      meta_due_on: meta.due_on || null,
      sort_order: meta.sort_order || 0,
      _color: meta.color || null,
    })

    for (const s of p.sections || []) {
      const isReal = !String(s.gid).startsWith('__nosec_')
      if (isReal) {
        const smeta = sectionMetaByGid.get(s.gid) || {}
        sections.push({
          id: s.gid, project_id: p.gid, name: s.name, sort_order: 0,
          start_on: smeta.start_on || null,
          due_on: smeta.due_on || null,
        })
      }
      for (const t of s.tasks || []) {
        tasks.push({
          id: t.gid,
          asana_gid: t.gid,
          project_id: p.gid,
          section_id: isReal ? s.gid : null,
          name: t.name,
          completed: !!t.completed,
          start_on: t.start_on || null,
          due_on: t.due_on || null,
          assignee: t.assignee || null,
          resource_subtype: t.resource_subtype || 'default_task',
          status: t.status || null,    // Asana 커스텀필드 '상태' (없으면 completed 기반)
          progress: null,
          color: null,
        })
      }
    }
  }

  return { groups, projects, sections, tasks }
}
