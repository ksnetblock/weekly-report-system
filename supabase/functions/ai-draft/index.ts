// =====================================================================
//  Supabase Edge Function: ai-draft
//  - 체크된 Asana 태스크 데이터를 받아 Claude(Anthropic)로 주간보고 초안 생성
//  - Claude API 키는 이 함수의 secret(서버 환경변수)에만 존재 → 브라우저 노출 없음
//
//  필요한 secret (Supabase에 등록):
//    ANTHROPIC_API_KEY : Claude(Anthropic) API 키 (sk-ant-...)
//
//  설정 방법(둘 중 하나):
//    1) 대시보드: Project Settings > Edge Functions > Secrets 에서 추가
//    2) CLI:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//  배포:       supabase functions deploy ai-draft
//  (SUPABASE_URL / SUPABASE_ANON_KEY 는 런타임에서 자동 제공)
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// 프론트 셀렉트박스에서 고를 수 있는 모델(화이트리스트)
const ALLOWED_MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-5'])
const DEFAULT_MODEL = 'claude-haiku-4-5'

// system_prompt 미설정 시 사용할 기본 시스템 프롬프트(프론트와 동일한 문구를 fallback으로 보관)
const DEFAULT_SYSTEM = `당신은 KSNET 블록체인사업팀의 주간업무보고 초안을 작성하는 어시스턴트입니다.
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

// suggest 모드(본문 업데이트 제안) 시스템 프롬프트 — 출력은 JSON 배열만
const DEFAULT_SUGGEST_SYSTEM = `당신은 KSNET 블록체인사업팀의 주간업무보고 초안을 업데이트하는 어시스턴트입니다.
입력으로 (1) 현재 작성 중인 주간보고 본문, (2) 이번 기간의 Asana 태스크 목록과 활동 내역이 주어집니다.
현재 본문을 기준으로, Asana 데이터에 근거해 새로 추가하거나 수정해야 할 항목만 제안하세요.

- 출력은 반드시 JSON 배열 하나만 출력합니다. 설명 문장이나 코드펜스(\`\`\`)는 절대 포함하지 마세요.
- 각 원소의 형태:
  {"type":"add"|"modify","group":"사업 그룹명(모르면 null)","project":"프로젝트명","current":"modify일 때만: 본문에 이미 있는 해당 문장을 원문 그대로","suggested":"제안 문장","reason":"근거가 된 Asana 활동 요약"}
- "suggested"는 본문 항목과 같은 형식의 한 줄로 씁니다: "(카테고리) 핵심내용 ⟶ 향후계획". 날짜는 (7.13) 처럼 월.일 형식.
- 카테고리 예: (규제대응) (개발) (온보딩) (계약) (MOU) (행정) (미팅) (PR) (기타) 등 내용에 맞게 선택합니다.
- type이 "add"인 경우: 본문에 아직 없는 새로운 소식입니다. "current"는 null 로 둡니다.
- type이 "modify"인 경우: 본문의 문장이 Asana 최신 상황과 달라 갱신이 필요한 경우입니다. "current"에는 본문에서 그 문장을 찾을 수 있도록 원문을 그대로 복사합니다.
- 본문에 이미 정확히 반영되어 있는 내용은 제안하지 않습니다.
- Asana 태스크명과 활동 내역에 근거한 사실만 제안하고, 추측성 내용은 넣지 않습니다.
- 제안할 것이 없으면 [] 만 출력합니다.`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// 모델이 코드펜스로 감싸 보내는 경우 제거 (```html ... ```)
function stripFences(text: string): string {
  let t = (text || '').trim()
  const fence = t.match(/^```(?:html|json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  return t
}

// suggest 모드 응답 텍스트 → 검증된 제안 배열 (파싱 실패 시 null)
function parseSuggestions(text: string): Array<Record<string, unknown>> | null {
  const t = stripFences(text)
  const s = t.indexOf('[')
  const e = t.lastIndexOf(']')
  if (s < 0 || e < s) return null
  try {
    const arr = JSON.parse(t.slice(s, e + 1))
    if (!Array.isArray(arr)) return null
    return arr
      .filter((x) => x && typeof x === 'object' && typeof x.suggested === 'string' && x.suggested.trim())
      .map((x) => {
        const current = typeof x.current === 'string' && x.current.trim() ? x.current.trim() : null
        return {
          // current 없는 'modify'는 교체할 대상이 없으므로 'add' 로 취급 (프론트에서 삽입 버튼만 뜨게)
          type: x.type === 'modify' && current ? 'modify' : 'add',
          group: typeof x.group === 'string' && x.group.trim() ? x.group.trim() : null,
          project: typeof x.project === 'string' ? x.project.trim() : '',
          current,
          suggested: String(x.suggested).trim(),
          reason: typeof x.reason === 'string' ? x.reason.trim() : '',
        }
      })
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const {
      password,
      mode = 'draft', // 'draft' = 초안 전체 생성(HTML) | 'suggest' = 현재 본문 기준 추가/수정 제안(JSON)
      model = DEFAULT_MODEL,
      system_prompt: systemPrompt,
      few_shot: fewShot,
      tasks_text: tasksText,
      report_text: reportText,
    } = await req.json().catch(() => ({}))

    if (!password) return json({ error: 'password_required' }, 400)
    if (!tasksText || !String(tasksText).trim()) return json({ error: '선택된 태스크가 없습니다.' }, 400)
    if (mode === 'suggest' && (!reportText || !String(reportText).trim())) {
      return json({ error: '현재 보고서 본문이 비어 있습니다.' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )

    // 비싼 Claude 호출 전에 접근 비밀번호부터 서버 검증
    const { data: ok, error: vErr } = await supabase.rpc('verify_access', { p_password: password })
    if (vErr) return json({ error: vErr.message }, 500)
    if (ok !== true) return json({ error: 'invalid_password' }, 401)

    const chosen = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL

    let system: string
    let userContent: string
    if (mode === 'suggest') {
      system = DEFAULT_SUGGEST_SYSTEM
      userContent =
        `## 현재 작성 중인 주간보고 본문\n${reportText}\n\n` +
        `## 이번 기간 Asana 태스크 데이터\n${tasksText}\n\n` +
        `## 지시\n현재 본문과 Asana 데이터를 비교해, 본문에 새로 추가하거나 수정해야 할 항목을 ` +
        `시스템 프롬프트에 정의된 JSON 배열 형식으로만 출력하세요. 코드펜스나 설명 문구는 금지입니다.`
    } else {
      system = (systemPrompt && String(systemPrompt).trim()) || DEFAULT_SYSTEM
      userContent =
        `${fewShot && String(fewShot).trim() ? `## 참고 양식(예시)\n${fewShot}\n\n` : ''}` +
        `## 이번 주 완료/진행 태스크 데이터\n${tasksText}\n\n` +
        `## 지시\n위 데이터를 바탕으로, 참고 양식과 동일한 형식의 주간업무보고 초안을 작성하세요. ` +
        `<h2>(그룹) / <h3>(프로젝트) / <ul><li>(항목) 구조만 사용하고, 코드펜스나 설명 문구 없이 HTML만 출력하세요.`
    }

    const body: Record<string, unknown> = {
      model: chosen,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userContent }],
    }
    // Sonnet 5는 thinking이 기본 on → 초안 작성엔 불필요하므로 비활성화(속도/비용). Haiku는 기본 off.
    if (chosen === 'claude-sonnet-5') body.thinking = { type: 'disabled' }

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const t = await res.text()
      return json({ error: `Claude ${res.status}: ${t.slice(0, 400)}` }, 502)
    }

    const data = await res.json()
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()

    if (!text) return json({ error: 'Claude 응답이 비어 있습니다.' }, 502)

    if (mode === 'suggest') {
      const suggestions = parseSuggestions(text)
      if (!suggestions) return json({ error: 'AI 제안 응답(JSON) 파싱에 실패했습니다. 다시 시도해주세요.' }, 502)
      return json({ suggestions, model: chosen })
    }
    return json({ html: stripFences(text), model: chosen })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
