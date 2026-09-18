---
name: figma-screen-impl
description: "TripPilot 화면·컴포넌트를 Figma 디자인에서 React Native + NativeWind로 충실히 구현하는 절차. Figma 디자인이 있는 화면/컴포넌트를 새로 만들거나(스캐폴딩) 기존 화면의 비주얼을 디자인과 정합시킬 때 반드시 사용하라 — '화면 만들어/구현해', '이 Figma로 짜줘', '디자인대로 해', '와이어프레임을 코드로', '스플래시/로그인/온보딩/홈 화면', 프리뷰가 Figma와 다를 때, dev-cycle의 [인지]·[구현]에서 화면 표면을 다루는 순간이 이 스킬을 쓸 시점이다. Figma가 뱉는 CSS를 그대로 붙여넣거나 제네릭 값(gray-*·text-xl·검은 네모 로고)으로 대충 그리려는 순간을 이 스킬이 막는다."
---

# Figma → 화면 구현 (RN + NativeWind)

## 왜 이 스킬인가

Figma 생성 CSS를 그대로 붙이면 두 가지가 망가진다: (1) RN엔 CSS가 없고 Figma export는 **절대좌표**라 반응형이 깨진다. (2) 하드코딩된 `#FF385C`·`padding:16px`가 디자인 토큰을 우회해 **"제네릭 값 남발"을 재생산**한다(우리가 고치려는 바로 그 문제). 이 스킬은 **디자인 의도를 읽어 우리 시스템(토큰 + 실 에셋)으로 번역**한다. 기계적 매핑은 `scripts/token-snapper.cjs`가, 판단(레이아웃 해석·매핑 결정)은 사람/구현자가 한다.

## 전제

- Figma **fileKey + 화면 노드 ID**. 모르면 밴드 맵(`<리포 루트>/frontend/.claude/skills/spec-perception/reference/figma-structure.md`)에서 밴드를 정하고 `mcp__figma__get_metadata`로 찾는다. **리포에 화면 명세 사본은 없다** — Figma가 유일한 정본이다.
- Figma MCP 도구는 deferred → ToolSearch로 **정규화된 이름**을 로드한다(접두사 없이는 매칭 실패):
  `mcp__figma__get_screenshot` · `mcp__figma__get_design_context` · `mcp__figma__get_variable_defs` · `mcp__figma__download_assets`
- **비주얼 패키지 설치 확인** — `expo-linear-gradient`(그라디언트)·`react-native-svg`(+`react-native-svg-transformer`, SVG 아이콘)·`expo-font`(폰트 번들)가 `package.json`에 없으면 이 스킬 산출물이 컴파일되지 않는다. 없으면 dev-cycle 의존성 단계에서 추가한다(게이트 준수). 미설치 상태로 코드만 쓰는 경우 그 한계를 **정직하게 명시**하라 — 없는 API를 지어내지 말 것.

## 절차 (5단계)

### 1. 추출

- `get_screenshot(node)` → 대조 기준 PNG. curl로 스크래치패드에 저장 후 **Read로 육안 확인**(무엇을 짓는지 눈으로 본다).
- `get_design_context(node, excludeScreenshot:true, clientFrameworks:"react-native")` → 레이아웃 구조 + raw 값(#hex·px·font 패밀리/크기·radius) + 에셋 URL 상수(`const imgX = "...asset/..."`).
- **디자인 시스템 우선 — 값보다 이름.** 먼저 `get_variable_defs(node)`로 변수 바인딩을 확인한다. **이름이 나오면 그쪽이 정본**(토큰 이름을 직접 주므로 스냅 추측 불필요) → 우리 tailwind 미러 토큰으로 직행한다. **빈 `{}`면 미바인딩** → 그때만 design_context의 raw 값 + 스냅퍼(2단계)로 역매핑한다.
- **관측(2026-07-21 라이브 확인)**: 이 파일은 화면 노드가 전부 미바인딩(`c02-social-login`·`c06-terms`·`c07-nickname` 모두 `get_variable_defs`→`{}`)이고 `search_design_system`도 빈 결과 — 게시된 DS 라이브러리 없음. **즉 지금은 raw + 스냅퍼(2단계)가 실작동 경로다.** `search_design_system`/`get_code_connect_map`은 이 파일에선 빈 결과라 의존하지 마라. 바인딩·게시는 진행 중일 수 있으니 대상 화면마다 다시 확인하되, 비어 있으면 이 관측대로 2단계로 간다.
- 노드 메타/컨텍스트가 크면(수백 KB~MB) 파일로 저장됨 → **서브에이전트/jq로 증류**해 main 컨텍스트 오염을 막는다.

### 2. 토큰 스냅

**이 단계가 디자인 시스템 강제다.** `tailwind.config`의 토큰은 Figma 변수 컬렉션(파일 `1MTF3dtptIrbg8gld5IdO2`)의 미러이고 `design-tokens.test.ts`가 동기화를 지킨다. 화면 노드에 변수가 안 붙어 있어도(1단계 관측), **raw 값을 토큰으로 스냅하는 것 자체가 "픽셀이 아니라 디자인 시스템을 쓰는" 행위**다 — 스냅퍼는 기계적 폴백이 아니라 이 스킬의 강제 지점이다.

> **철칙**: 색·간격·radius·폰트는 **토큰 클래스로만** 쓴다. raw hex/px 하드코딩 = 디자인 시스템 우회 = 금지. 예외는 스냅퍼가 MISS 사유로 raw를 **명시 허용**한 경우뿐(그라디언트·브랜드색·반투명·의도적 일회성).

raw 값을 `[{type,value,role}]` 배열(JSON)로 모아 스냅퍼를 **실행**한다(읽지 말고 돌린다).

**cwd는 `frontend/`여야 한다** — `--config` 기본값이 cwd 기준이다. 다른 데서 부르면 `--config`로 경로를 준다.

입력 `values.json`:

```json
[
  { "type": "color",  "value": "#ff385c", "role": "회원가입 버튼 bg" },
  { "type": "font",   "value": "22",      "role": "타이틀" },
  { "type": "radius", "value": "12",      "role": "버튼" },
  { "type": "space",  "value": "16",      "role": "섹션 gap" }
]
```

실행:

```bash
node .claude/skills/figma-screen-impl/scripts/token-snapper.cjs values.json
node .claude/skills/figma-screen-impl/scripts/token-snapper.cjs values.json --config ../frontend/tailwind.config.js
node .claude/skills/figma-screen-impl/scripts/token-snapper.cjs values.json --json   # 프로그램 소비용
```

출력:

```
type   value            role                        → 우리 토큰 / MISS
--------------------------------------------------------------------------------
color  #ff385c          회원가입 버튼 bg               OK   primary
radius 12               버튼                          OK   button  (동률: input/thumb — role로 확인)
font   22.3             타이틀                         ~    hero  (22.3->22 스냅)
color  #FFFFFF00        투명 오버레이                   MISS 반투명 (알파 00 — 토큰 아님)
--------------------------------------------------------------------------------
합계 4 · OK 2 · 스냅 1 · MISS 1
```

판정별 처리:

- **OK** → 그 토큰 클래스 사용(`bg-primary`·`text-ink`·`rounded-button`·`text-hero`). 동률 후보가 나오면 **role로 선택**.
- **~(스냅)** → 근접 토큰(오차 표시 검토 후).
- **MISS** → 사유를 보고 갈라라. 사유가 곧 지시다:
  - `토큰 없음` → 그라디언트·브랜드색(카카오 노랑·네이버 초록) = 토큰 아님 → raw 또는 전용 토큰 추가
  - `일회성/임의값` → `gap-[14px]` 같은 임의값 유지가 맞다
  - `반투명` → 알파는 토큰이 아니다. `bg-black/40` 같은 불투명도 유틸이나 rgba raw로
  - `지원 안 하는 type` · `hex 형식 아님` · `숫자로 못 읽음` → **입력 오타다.** 고쳐서 다시 돌려라 (raw로 하드코딩하지 마라)
  - `토큰 그룹이 비어 있음` → `tailwind.config.js`에 그 그룹이 없다. 토큰 추가가 선행돼야 한다

스냅퍼가 "토큰 쓸 값"과 "임의/브랜드 값"을 갈라주므로, 사람은 MISS만 판단한다.

### 3. 에셋

- `download_assets(node)` 또는 design_context의 URL을 curl → **`src/assets/<feature>/`**. ⚠️ **URL은 7일 만료** → 즉시 다운로드.
- 아이콘·로고·일러스트는 대개 **SVG** → `react-native-svg`. 래스터는 `<Image source={require(...)}/>`.
- 같은 에셋이 화면별로 다른 URL로 중복 발급됨 → 정체성당 1개만 저장.

### 4. RN 번역 (핵심 판단) — 상세 매핑: `references/rn-translation.md`

- `View`/`Text`/`Pressable` + NativeWind `className`(토큰).
- **절대좌표 → flex 재구성.** Figma의 `position:absolute; left/top`를 복붙하지 말 것 — 화면을 의미 존(상단/중앙/하단 등)으로 읽어 `flex` + spacer로 옮긴다. 장식 요소만 absolute overlay.
- 그라디언트 배경 → `expo-linear-gradient`. 그림자 → `shadow-*` / RN shadow prop.
- 폰트: 디자인 폰트 번들(`expo-font`) — 예: Inter(워드마크) + Noto Sans KR(본문).
- **testID 보존** — 기존 화면 컴포넌트의 testID를 그대로 유지한다. 프레젠테이션만 바꾸고 **동작 계약은 불변** → dev-cycle 행위 테스트(게이트① 동결)가 수정 없이 green. testID를 바꾸면 계약 파기(게이트 재제시 사유).
- INV-3(소요시간 표시 금지)·import 경계(features 간 직접 import 금지)·토큰 secure-store 규칙 준수.

### 5. 스크린샷 대조 루프 (필수 — 비주얼 강제)

testID가 green이어도 화면은 와이어프레임일 수 있다(jest가 못 잡는 구멍 — testID 계약만 통과해도 비주얼은 안 맞는다). **이 루프를 최소 1회 돌고 "어긋남 목록"이 빌 때까지 [구현]을 끝내지 마라.** 이것이 "디자인이 Figma랑 다름"을 막는 강제 장치다.

**성격 — 반자동이다.** 렌더·캡처·Figma대조는 명령으로 자동, **비교·수정은 구현자**가 한다. 대조는 *"어디가 다르다"*만 주고 *"어떻게 고칠지"*는 코드 추론이다. 픽셀 동일까지 자동 수렴하는 옵티마이저가 아니다 — RN 네이티브 렌더 ≠ Figma 벡터 렌더라 픽셀 0은 원천적으로 불가(그래서 목표가 90~98%). 수렴하는 이유는 매 패스 구현자가 근거 있는 수정을 넣기 때문이다.

1. **대상 화면 조준** — 프리뷰 하네스(`src/app/_dev/preview.tsx`)가 화면을 격리 렌더한다(토글 바는 오버레이라 화면을 안 밀어냄). 어느 화면을 띄울지는 `INITIAL_STATE_KEY`가 정하는데 **현재 하드코드**다 → 소스 수정 없이 조준하려면 **env 구동(`EXPO_PUBLIC_PREVIEW_STATE`)으로 바꾸는 게 선행**(프리뷰 개선 = app 코드라 dev-cycle 대상). 그 전엔 앱을 띄운 뒤 토글 바로 대상 화면을 직접 선택한다.
2. **앱 스크린샷** — iOS 시뮬레이터에서 캡처(스크래치패드에 저장):
   ```bash
   xcrun simctl list devices booted                       # 부팅된 기기 확인 (없으면 아래 pnpm ios 가 부팅)
   EXPO_PUBLIC_PREVIEW_STATE=terms pnpm ios               # 대상 화면으로 프리뷰 띄움(첫 네이티브 빌드 수 분, 이후 hot-reload 로 빠름). env 훅 미배선이면 env 없이 pnpm ios 후 토글로 선택
   xcrun simctl io booted screenshot "<스크래치패드>/app-terms.png"
   ```
3. **Figma 기준** — `get_screenshot(node, contentsOnly:true, maxDimension:800)` → 반환된 URL을 **즉시** `curl -sL -o "<스크래치패드>/fig-terms.png" "<url>"`. ⚠️ 이 URL은 **단시간 만료**다(에셋 URL의 7일과 다르다 — 훨씬 짧으니 바로 받는다).
4. **나란히 대조** — 두 PNG를 Read로 나란히 놓고 **어긋남을 목록화**(누락 요소·간격·색·크기·정렬·폰트·모양). **행위 테스트가 신경 안 쓰는 요소가 먼저 빠진다** — 상단 내비바·보조 링크(`보기>`)·배지 pill·부제·필드 라벨·긍정 상태 메시지·아이콘 vs 텍스트를 특히 확인.
5. **코드 수정 → 2로 복귀** → 어긋남 목록 빌 때까지 반복. 목표 **90~98%**(한눈에 구별 불가) — 문자 그대로 100% 픽셀은 RN 렌더 한계로 보장 못 함.

## 마무리 체크리스트 (구현 종료 게이트)

하나라도 비면 [구현]을 끝내지 않는다:

- [ ] `get_variable_defs`로 디자인 시스템 바인딩 먼저 확인 (빈 `{}`면 raw + 스냅퍼 경로)
- [ ] 스냅퍼 MISS 전부 사유대로 처리 — **raw hex/px 하드코딩 0** (그라디언트·브랜드색·반투명·의도적 일회성만 예외)
- [ ] 기존 testID 1:1 보존 (게이트① 행위 테스트 green)
- [ ] 에셋 만료(7일) 전 `src/assets/<feature>/`에 저장, 정체성당 1개
- [ ] 프리뷰 격리 렌더 ↔ Figma 스크린샷 대조 최소 1회, 어긋남 목록 비움
- [ ] 그라디언트/SVG/폰트 패키지(`expo-linear-gradient`·`react-native-svg`·`expo-font`) 설치 확인 — 없으면 dev-cycle 의존성 단계에서 추가

## dev-cycle 통합

- **[인지](spec-analyst)**: 1~2단계(추출·토큰맵)로 화면 요구·토큰·에셋 목록을 브리프에 넣는다.
- **[구현](implementer)**: 3~5단계로 화면을 짓는다. **testID 보존이 게이트① 테스트를 green으로 유지하는 계약**이다.
- **[검증]**: 스크린샷 대조를 비주얼 확인 항목으로. spec-perception(Figma **읽기**/요구사항)와 상보 — 이 스킬은 **짓기**다.

## 실전 함정

- **변수 미바인딩** → `get_variable_defs` 빈 `{}`. raw 값 사용(위 1단계).
- **컴포넌트 스펙 ↔ 화면 스펙 충돌** → **화면이 정본**(컴포넌트가 구버전·플레이스홀더일 수 있음. 예: SocialLoginButton 컴포넌트는 글자 플레이스홀더지만 화면은 실 로고).
- **브랜드색은 의도적 raw** — 토큰화 금지(SVG 안에 색이 있으면 토큰 불필요).
- **동일 요소 2스케일**(앱아이콘 94px/56px 등) → 비례 축소인지 사이즈 토큰 2종인지 확인.
- **MVP 스코프** — 디자인에 있어도 범위 밖 요소(예: 이메일 로그인·회원가입)는 숨김 결정 준수(정본 확인).
