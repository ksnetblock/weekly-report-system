# 업무 로드맵 뷰어

**Asana API**에서 데이터를 가져와 **Supabase**에 *버전(스냅샷)*으로 저장하고,
비밀번호로 보호되는 간트차트로 보여주는 **순수 React(Vite)** 앱입니다.

- 계층: **그룹(상위 묶음) → 프로젝트 → 섹션 → 업무(태스크)**
- 페이지(헤더 네비게이션으로 이동):
  - **홈 `/`** — 그룹과 각 그룹에 속한 프로젝트의 정의·상세 설명 (읽기 전용)
  - **일정 `/schedule`** — 버전 선택 · 필터 · 간트차트
  - **그룹 관리 `/groups`** — 그룹 정의(이름·색·설명) 편집 + Asana 프로젝트 조회/배정 + 프로젝트 이름·설명 편집
- 데이터: 외부 JSON 파일을 넣고 빼지 않습니다. **"Asana 가져오기" 버튼**을 누르면
  Edge Function이 Asana에서 직접 읽어와 새 버전으로 저장합니다.
- 버전 관리: 가져올 때마다 한 버전이 쌓이고, 헤더의 드롭다운으로 과거 버전을 조회합니다.
- 보안: 테이블은 RLS로 잠겨 있고, 조회/수정은 **비밀번호를 검증하는 RPC**로만. Asana 토큰은
  브라우저가 아니라 **Edge Function secret**에 보관됩니다.

---

## 구조 한눈에

```
브라우저(React)  ──(비밀번호+RPC)──►  Supabase DB (RLS 잠금)
       │
       └─(비밀번호)─►  Edge Function: asana-sync  ──(ASANA_TOKEN)──►  Asana API
                              └─ 가져온 데이터를 create_version RPC로 저장
```

토큰이 브라우저로 내려오지 않으므로(=번들에 노출 안 됨), CORS/보안 문제 없이 동작합니다.

---

## 1. Supabase DB 준비

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. 대시보드 → **SQL Editor** → [`supabase/schema.sql`](supabase/schema.sql) 전체 붙여넣고 **RUN**
3. SQL 맨 아래 **10번 블록**에서 접근 비밀번호를 정합니다:
   ```sql
   insert into public.app_secrets (id, password_hash)
   values (1, crypt('여기에_원하는_비밀번호', gen_salt('bf')))
   on conflict (id) do update set password_hash = excluded.password_hash;
   ```
   👉 이 비밀번호가 곧 앱 접속 비밀번호이며, DB 안에 해시로만 저장됩니다.

## 2. Edge Function 배포 + Asana 토큰 등록

[Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후:

```bash
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>

# Asana 토큰/워크스페이스를 "서버 환경변수(secret)"로 등록  ← 토큰은 여기!
supabase secrets set ASANA_TOKEN=0/여기에_Asana_PAT
supabase secrets set ASANA_WORKSPACE_GID=1205879917489493
# (선택) 특정 프로젝트만 가져오려면:
supabase secrets set ASANA_PROJECT_GIDS=1214961401786650,1214792888692023

# 함수 배포
supabase functions deploy asana-sync
supabase functions deploy project-icon
```

> Asana PAT 발급: Asana → My Settings → Apps → **Personal access tokens**.
> `ASANA_PROJECT_GIDS`를 비우면 워크스페이스의 프로젝트 목록(typeahead, 최대 100개)을 사용합니다.
> `project-icon` 함수는 그룹 관리 페이지의 프로젝트 로고 이미지 업로드용입니다.
> 별도 secret 등록 없이 Supabase가 자동 주입하는 `SUPABASE_SERVICE_ROLE_KEY`로 동작하며,
> `supabase/schema.sql`을 실행하면 `project-icons` Storage 버킷(public)이 함께 생성됩니다.

## 3. React 환경변수(.env)

루트의 `.env.example` 을 복사해 **`.env`** 로 만들고 두 값만 채웁니다:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon public 키
```

> ⚠️ **Asana 토큰과 접근 비밀번호는 .env 에 넣지 않습니다.**
> .env 의 VITE_* 값은 빌드된 JS에 그대로 노출되기 때문입니다.

## 4. 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 정적 배포용 dist/
```

---

## 사용법

1. 접속 → 비밀번호 입력
2. **그룹 관리(`/groups`)** 에서 그룹을 만들고(이름·색·설명), **Asana에서 프로젝트 배정** →
   조회된 Asana 프로젝트를 그룹에 배정하고, 프로젝트 **이름·설명**을 편집.
   프로젝트 앞 아이콘을 클릭하면 **로고 이미지**를 업로드할 수 있고(미업로드 시 기본 문서 아이콘),
   업로드된 아이콘에 마우스를 올리면 나오는 ✕ 버튼으로 기본 아이콘으로 되돌릴 수 있습니다.
3. **홈(`/`)** 에서 그룹과 프로젝트의 정의·설명을 한눈에 확인
4. **일정(`/schedule`)** → **Asana 가져오기** 로 현재 Asana 상태를 새 버전으로 저장,
   버전 드롭다운으로 과거 버전 조회, 필터·간트로 일정 확인

### 동작 규칙
- 버전(스냅샷)은 **읽기 전용**입니다. 업무 내용은 Asana가 원본 → 다시 가져오면 새 버전이 됩니다.
- 프로젝트는 **Asana gid(id)만** 저장합니다. 이름은 Asana 원본을 캐시하되, 그룹 관리에서
  **표시 이름(display_name)** 을 지정하면 그 값이 우선하며 재동기화가 덮어쓰지 않습니다.
- **그룹·배정·색상·설명**(수동 레이어)은 Asana gid 기준으로 저장되어 **모든 버전에 유지**됩니다.
- 한 프로젝트는 **한 그룹에만** 속합니다(다른 그룹 프로젝트를 배정하면 이동).

> **경로형 라우팅 주의**: 이 앱은 `/schedule`, `/groups` 같은 경로를 사용합니다.
> `npm run dev`는 기본 지원되지만, `dist/`를 정적 호스팅할 때는 모든 경로를 `index.html`로
> 되돌리는 **SPA fallback(rewrite)** 규칙이 필요합니다.
> (예: Netlify `/* /index.html 200`, Vercel `rewrites`, Nginx `try_files ... /index.html`)

---

## 보안 메모
- 모든 테이블 RLS 잠금 → anon 키만으로 데이터 조회 불가
- 모든 RPC/Edge Function은 비밀번호를 서버에서 bcrypt 검증
- Asana 토큰은 Edge Function secret(서버)에서만 사용 → 브라우저에 노출 안 됨
- 접근 비밀번호는 탭 세션(sessionStorage)에만 임시 보관 → 탭 닫으면 로그아웃

## 폴더 구조
```
├─ index.html
├─ supabase/
│  ├─ schema.sql                  # 테이블/RLS/RPC/비밀번호/Storage 버킷  ← 먼저 실행
│  └─ functions/
│     ├─ asana-sync/              # Asana 연동 Edge Function
│     └─ project-icon/            # 프로젝트 로고 이미지 업로드/삭제 Edge Function
├─ src/
│  ├─ App.jsx                     # 라우터 셸 + 인증 게이트
│  ├─ pages/  HomePage(정의·설명) · SchedulePage(간트) · GroupsPage(그룹·배정 관리)
│  ├─ lib/  supabase·auth·api·transform·helpers
│  └─ components/  Header(네비게이션) · Gantt · ProjectModal · SectionModal · SyncModal · Modal · PasswordGate · Toast
└─ reference/asana_openapi.json   # 사용한 Asana 엔드포인트 명세
```
