// 주간보고 유틸 — 기간 계산, Asana 변화 → 편집기 초안 변환, DOCX 전송용 시각 경계
//
// 편집기 content 구조:
//   { sections: [ { project_gid, project_name, items: [ { status, text } ] } ], footer }
//   status: '완료' | '진행' | '예정' | '' (기타)

const KST_OFFSET = '+09:00' // 회사 표준시(KST) 고정

// 로컬 Date → 'YYYY-MM-DD'
function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 이번 주 월요일~일요일 { start, end } ('YYYY-MM-DD')
export function currentWeekRange(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const dow = d.getDay()                 // 0=일 … 6=토
  const diffToMon = (dow + 6) % 7        // 월요일까지 뒤로 며칠
  const mon = new Date(d)
  mon.setDate(d.getDate() - diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { start: ymd(mon), end: ymd(sun) }
}

// 'YYYY-MM-DD' → KST 경계 ISO 문자열 (edge function 전송용)
//   isEnd=false → 00:00:00, isEnd=true → 23:59:59.999
export function toBoundaryISO(dateStr, isEnd = false) {
  const time = isEnd ? '23:59:59.999' : '00:00:00.000'
  return `${dateStr}T${time}${KST_OFFSET}`
}

// ISO week 번호 (월요일 시작, ISO-8601)
function isoWeekNo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const day = (date.getUTCDay() + 6) % 7        // 월=0
  date.setUTCDate(date.getUTCDate() - day + 3)  // 해당 주 목요일
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDay = (firstThu.getUTCDay() + 6) % 7
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((date - firstThu) / (7 * 24 * 3600 * 1000))
  return { year: date.getUTCFullYear(), week }
}

// 기간 시작일 기준 제목: "2026-W30 주간보고"
export function isoWeekLabel(startDateStr) {
  const { year, week } = isoWeekNo(startDateStr)
  return `${year}-W${String(week).padStart(2, '0')} 주간보고`
}

// 기준일(기본: 오늘) 이전 화요일. 오늘이 화요일이면 지난주 화요일.
export function previousTuesday(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const diff = (d.getDay() - 2 + 7) % 7 // 지난 화요일까지 며칠 전 (오늘이 화요일이면 0)
  d.setDate(d.getDate() - (diff === 0 ? 7 : diff))
  return d
}

// 기본 보고 기간: 시작 = 이전 화요일, 종료 = 오늘
export function defaultReportPeriod(base = new Date()) {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  return { start: ymd(previousTuesday(base)), end: ymd(today) }
}

// 기본 보고일(하루): 다가올 화요일 (오늘이 화요일이면 오늘) → 'YYYY-MM-DD'
export function defaultReportDate(base = new Date()) {
  return ymd(upcomingTuesday(base))
}

// 'YYYY-MM-DD' → "2026.07.14 (화)" 표시용
export function formatReportDate(dateStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  const w = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()]
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} (${w})`
}

// 기준일(기본: 오늘) 이후 가장 가까운 화요일. 오늘이 화요일이면 오늘.
export function upcomingTuesday(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const daysUntil = (2 - d.getDay() + 7) % 7 // 화요일=2
  d.setDate(d.getDate() + daysUntil)
  return d
}

// 주간보고 기본 제목: "블록체인사업팀 주간 업무 보고 (’26.7.14)"
//   날짜는 오늘 기준 다가올 화요일(오늘이 화요일이면 오늘).
export function weeklyReportTitle(base = new Date()) {
  const t = upcomingTuesday(base)
  const yy = String(t.getFullYear()).slice(-2)
  return `블록체인사업팀 주간 업무 보고 (’${yy}.${t.getMonth() + 1}.${t.getDate()})`
}

// HTML 특수문자 이스케이프 (에디터/문서에 안전하게 삽입)
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// changeType → 상태 라벨
function statusFromChange(t) {
  if (t.changeType === 'completed') return '완료'
  if (t.status === '완료') return '완료'
  if (t.status === '보류') return '예정'
  return '진행'
}

// 태스크 → 목록 항목 HTML (라벨 볼드 + 본문)
function taskLi(t) {
  const label = statusFromChange(t)
  const body = t.assignee ? `${t.name} (${t.assignee})` : t.name
  return `<li><strong>[${esc(label)}]</strong> ${esc(body)}</li>`
}

export const NO_CHANGE = '금주 변동사항 없음'

// Asana 변화 응답(projects) + 수동 레이어(groups, projectMeta)
// → 그룹 > 프로젝트 계층 구조. 그룹관리에 등록된 '모든' 그룹·프로젝트를 포함하고,
//   변화가 없는 프로젝트/그룹도 빈 상태로 표현한다. 이름은 display_name, 그룹은 groups 데이터 사용.
//   [ { group_id, group_name, color, projects: [ { gid, name, tasks } ] } ]
//   그룹 순서는 groups.sort_order, 그룹 미지정 프로젝트는 '미분류'로 맨 뒤.
export function groupChanges(projects, groups = [], projectMeta = []) {
  const changesByGid = new Map((projects || []).map((p) => [p.gid, p.tasks || []]))

  // 프로젝트 전체 집합: project_meta(등록된 모든 프로젝트) ∪ 변화에만 있는 것
  const universe = new Map() // gid → { gid, name, group_id, sort_order, tasks }
  for (const m of projectMeta || []) {
    universe.set(m.asana_gid, {
      gid: m.asana_gid,
      name: m.display_name || m.name || '(이름 없음)',
      group_id: m.group_id || null,
      sort_order: m.sort_order || 0,
      tasks: changesByGid.get(m.asana_gid) || [],
    })
  }
  for (const p of projects || []) {
    if (!universe.has(p.gid)) {
      universe.set(p.gid, { gid: p.gid, name: p.name, group_id: null, sort_order: 0, tasks: p.tasks || [] })
    }
  }

  // 그룹별 버킷
  const buckets = new Map() // group_id | '__none__' → projects[]
  for (const proj of universe.values()) {
    const key = proj.group_id || '__none__'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(proj)
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko'))
  }

  // 등록된 모든 그룹을 순서대로(빈 그룹 포함), 미분류는 프로젝트가 있을 때만 맨 뒤
  const result = []
  const sorted = [...(groups || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  for (const g of sorted) {
    result.push({ group_id: g.id, group_name: g.name, color: g.color || null, projects: buckets.get(g.id) || [] })
  }
  if (buckets.has('__none__')) {
    result.push({ group_id: null, group_name: '미분류', color: null, projects: buckets.get('__none__') })
  }
  return result
}

// 그룹 구조 → 편집기 초안 HTML (그룹 H2 + 프로젝트 H3 + 글머리 목록)
//   변화 없는 프로젝트/그룹은 '금주 변동사항 없음' 문구로 표기.
//   그룹 미지정('미분류')은 그룹 제목을 생략하고 프로젝트만 나열.
export function changesToHtml(grouped) {
  const parts = []
  for (const grp of grouped || []) {
    if (grp.group_id) parts.push(`<h2>${esc(grp.group_name)}</h2>`)
    if (!grp.projects || grp.projects.length === 0) {
      parts.push(`<p>${NO_CHANGE}</p>`)
      continue
    }
    for (const p of grp.projects) {
      parts.push(`<h3>${esc(p.name)}</h3>`)
      const tasks = p.tasks || []
      if (tasks.length === 0) parts.push(`<p>${NO_CHANGE}</p>`)
      else parts.push(`<ul>${tasks.map(taskLi).join('')}</ul>`)
    }
  }
  return parts.join('') || '<p></p>'
}

// 단일 태스크 → 삽입용 목록 HTML (좌측 '＋' 개별 추가용)
export function taskToHtmlLine(t) {
  return `<ul>${taskLi(t)}</ul>`
}

// ── AI 초안(Claude) 관련 ─────────────────────────────────────────────
// 프론트 셀렉트박스에서 고를 수 있는 모델. label은 사용자 표시용.
export const AI_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (빠름·저렴)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 (고품질)' },
]

// 사용자가 설정에서 비워두면 사용할 기본 시스템 프롬프트
export const DEFAULT_AI_SYSTEM_PROMPT = `당신은 KSNET 블록체인사업팀의 주간업무보고 초안을 작성하는 어시스턴트입니다.
입력으로 이번 주 완료/진행된 Asana 태스크 목록과 각 태스크의 기간 내 활동 내역이 주어집니다.
아래 규칙에 따라 간결한 실무형 보고 초안을 작성하세요.

- 출력은 반드시 HTML로만 작성합니다. 설명 문장이나 코드펜스(\`\`\`)는 절대 포함하지 마세요.
- 사업 그룹은 <h2>, 프로젝트는 <h3>, 개별 보고 항목은 <ul><li> 로 표현합니다.
- 각 항목은 "(카테고리) 핵심내용 ⟶ 향후계획" 형태의 한 줄로 압축합니다. 카테고리는 <strong>(규제대응)</strong> 처럼 굵게 표시합니다.
- 카테고리 예: (규제대응) (개발) (온보딩) (계약) (MOU) (행정) (미팅) (PR) (기타) 등 내용에 맞게 선택합니다.
- 날짜는 (7.13) 처럼 월.일 형식으로 표기합니다.
- 태스크명과 활동 내역에 근거한 사실만 기술하고, 추측성 내용은 넣지 않습니다.
- 완료된 일과 다음 계획을 ⟶ 로 연결해 흐름이 드러나게 작성합니다.
- 서로 다른 사업 그룹(<h2>) 블록 사이에는 빈 문단 <p></p> 을 하나 넣어 시각적으로 구분합니다. (줄바꿈은 <br>이 아니라 <p></p> 로 합니다.)
- 데이터에 없는 그룹/프로젝트는 만들지 않습니다.`

// 사용자가 설정에서 비워두면 사용할 기본 few-shot(양식 예시)
export const DEFAULT_AI_FEWSHOT = `해외 사업자 연계 사업 [Crypto to fiat 결제]
크립토닷컴
- (규제대응) 법무법인 율촌 미팅 완료(7.13) ⟶ 금융위 방문 일정 조율 중
- (개발) 토스플레이스측 'QR' 관련 담당자 미팅 예정(7.15)
바이낸스
- (온보딩) KYB 1차 제출 완료 ⟶ KYB 추가 문서 작성 중(w. 대외협력2팀)
- (계약) 당사 계약서 검토 의견 바이낸스 전달 완료
한국은행 CBDC 사업 [예금토큰 결제]
KISA 과제(PG 모델)
- (행정) KISA 회계 현장 교육 예정(7.15 을지로 / w. 재무팀)`

// 체크된 태스크(+활동내역) → Claude에 넘길 사람이 읽기 쉬운 텍스트
//   grouped: groupChanges() 결과, checkedSet: 체크된 task gid Set
//   activityByGid: { [gid]: { items: [{ subtype, text, author, created_at }] } }
export function buildCheckedTasksText(grouped, checkedSet, activityByGid = {}) {
  const lines = []
  for (const g of grouped || []) {
    const projs = (g.projects || [])
      .map((p) => ({ ...p, tasks: (p.tasks || []).filter((t) => checkedSet.has(t.gid)) }))
      .filter((p) => p.tasks.length > 0)
    if (projs.length === 0) continue

    lines.push(`# 그룹: ${g.group_name}`)
    for (const p of projs) {
      lines.push(`## 프로젝트: ${p.name}`)
      for (const t of p.tasks) {
        const meta = []
        if (t.assignee) meta.push(`담당 ${t.assignee}`)
        meta.push(t.changeType === 'completed' ? '완료됨' : '수정됨')
        if (t.status) meta.push(`상태 ${t.status}`)
        if (t.section_name) meta.push(`섹션 ${t.section_name}`)
        lines.push(`- 태스크: ${t.name} (${meta.join(', ')})`)
        const items = activityByGid[t.gid]?.items || []
        for (const a of items) {
          if (a?.text) lines.push(`    · ${a.text}`)
        }
      }
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

// 구버전 저장본(sections 구조) → HTML (하위호환 로드용)
export function sectionsToHtml(sections, footer) {
  const blocks = (sections || []).map((s) => {
    const lis = (s.items || [])
      .filter((it) => (it.text || '').trim())
      .map((it) => `<li>${it.status ? `<strong>[${esc(it.status)}]</strong> ` : ''}${esc(it.text)}</li>`)
      .join('')
    return `<h3>${esc(s.project_name || '')}</h3><ul>${lis || '<li></li>'}</ul>`
  })
  let html = blocks.join('')
  if ((footer || '').trim()) {
    html += `<h3>특이사항 · 계획</h3>` + footer.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')
  }
  return html || '<p></p>'
}
