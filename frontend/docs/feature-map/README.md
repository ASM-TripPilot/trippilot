# TripPilot 기능 지도 (feature map)

운영 중인 앱의 **사용자 기능**마다 "어떻게 들어가서, 어떻게 조작하고, 무엇이 보이면 동작한다고 보는가"를 적은 검증 레시피 모음이다. 앱을 처음 보는 에이전트가 이 지도만 들고 실화면에서 기능을 증명할 수 있어야 한다. 형식은 pstack `create-verification-skill`의 feature map을 따랐다.

## 검증 상태 (파일마다 frontmatter `status`)

| 값 | 뜻 |
|---|---|
| `code-verified` | 진입 경로·testID·문구·분기를 적었고 testID 가 실재한다(`check.mjs`). 실화면 조작은 아직이다. |
| `live-verified` | iPhone 17 Pro 시뮬레이터에서 전 경로를 조작해 증거를 남겼다(`live_verified_at`에 날짜·커밋). |
| `live-unreachable` | 실화면 도달 불가 — 막힌 전제와 시도한 경로를 `Gotchas`에 적었다. |

코드만으로 판정할 수 없는 항목(바텀시트 실제 열림·지도·제스처·딤 덮임 등 jest 원리적 사각)은 `Gotchas`에 **[실화면 전용]** 으로 표시한다.

## 공통 전제

- 대상: develop 빌드의 dev build, iOS 시뮬레이터 iPhone 17 Pro, 번들 ID `com.trippilot.travel`.
- 조작 도구: `agent-device`(접근성 트리 ref 탭·한글 `fill`) — 절차와 셀렉터 함정은 `trippilot-sim-qa` 스킬(`frontend/.claude/skills/trippilot-sim-qa/`) 소관이고 여기 옮겨 적지 않는다. 그 스킬이 이 지도를 커버리지 정본으로 읽는다.
- 서버: 개발 서버 `dev-api`. 로그인은 소셜 로그인만(MVP).
- 실패·로딩 얼굴(서버 5xx·조회 실패·로딩 중)은 네트워크를 끊지 않고 웹 드라이버의 `fail`·`delay`로 연다(`trippilot-sim-qa` 「웹 버전 QA」).
- 화면 정본은 Figma다 — 각 기능 파일은 밴드 코드(a–m)만 가리키고 화면 스펙을 복제하지 않는다.

## 조작 규약

- 손잡이는 `testID` → 접근성 라벨 → 화면 문구 순으로 고른다. 좌표·순서로 잡지 않는다.
- 맵에 적는 `testID`·라우트·문구는 **코드에 실재하는 값만** 쓴다.
- 데이터를 바꾸는 기능은 결과를 **다른 화면에서 한 번 더 읽어** 확인한다.
- 한 진입 경로를 다른 경로로 대신 통과시키고 "검증됨"이라 하지 않는다. 막힌 경로는 막힌 이유와 함께 남긴다.
- 통과시키려고 시나리오를 약하게 고치지 않는다. 전제가 없으면 실패로 보고하고 `Gotchas`에 적는다.

## 기능 파일 형식

frontmatter(`id`·`band`·`status`·`live_verified_at`·`routes`) 다음 H1 제목과 사용자 관점 동작 한 문단, 그리고 정확히 네 개의 H2를 이 순서로 둔다.

1. `Sub-features` — 짧은 ID와 동작 한 줄씩.
2. `How to get to it (user POV)` — 사용자가 들어오는 **모든** 경로(탭·버튼·딥링크·푸시·다른 기능에서의 이동).
3. `Driving it with agent-device` — `Preconditions:`로 시작, 각 bullet이 사용자 행동·손잡이(testID/문구)·관찰 결과를 짝짓는다.
4. `Gotchas` — 검증을 헛돌게 하거나 무효로 만드는 함정.

**사용자 관점만 적는다.** QA는 시뮬레이터 실화면에서 하므로 소스 파일 경로·컴포넌트·함수 이름(`router.back()` 등)·코드 주석 인용은 적지 않는다 — 코드는 바뀌고 적힌 경로는 낡는다. 적는 것은 사용자 경로·손잡이(testID·접근성 라벨·문구·딥링크)·필요한 상태·관찰 가능한 결과뿐이다. 내부가 궁금하면 그때 코드에서 찾는다. `routes`는 화면 배정 색인(`check.mjs`용)일 뿐 본문에서 인용하지 않는다.

## 유지

- 라우트(`app/**`)를 더하거나 지우면 이 지도의 해당 파일 `routes`도 고친다 — `node docs/feature-map/check.mjs`가 어느 기능에도 속하지 않는 라우트와 코드에 없는 testID를 잡는다.
- 재QA로 실화면을 돌면 그 기능 파일의 `status`·`live_verified_at`을 갱신한다.

## 기능 목록

기능 47개 · 라우트 70개 전부 배정. 한 라우트를 두 기능이 함께 쓰면 양쪽 `routes`에 적는다(예: 방문 기록 화면 = `trip-record`·`visit-check`).

### 진입·계정

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [앱 시작 · 게이트](./app-launch.md) | c | 4 |
| [소셜 로그인](./login.md) | c | 3 |
| [온보딩](./onboarding.md) | c | 9 |
| [기능 안내 6장](./feature-tour.md) | c | 1 |
| [기존 계정 권한 안내](./permissions.md) | c | 3 |

### 홈·탐색

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [홈](./home.md) | a | 1 |
| [하단 탭바](./tab-bar.md) | a | 1 |
| [매거진 (여행지 둘러보기)](./magazine.md) | a | 1 |
| [탐색 랜딩 · 지역 선택 · 여행지 상세](./explore-destination.md) | d | 3 |
| [장소 탐색 · 장소 상세 · 장소 저장](./explore-places.md) | d | 2 |
| [담은 장소 · 이 장소들로 여행 만들기](./saved-places.md) | d | 1 |

### 숙소

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [숙소 검색 결과 (e02)](./stay-search.md) | e | 1 |
| [숙소 상세 · 외부 예약 (e03 · 제휴 고지 시트 l07)](./stay-detail.md) | e | 1 |
| [저장한 숙소 (e04)](./saved-stays.md) | e | 1 |
| [숙소 직접 등록 (e05) · 마이 등록 숙소 (l04)](./stay-register.md) | e | 2 |
| [인기 숙소 (Trip.com 큐레이션)](./curated-stays.md) | e | 0 |

### 여행 만들기

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [여행 만들기 (위저드 1/4·2/4)](./trip-create.md) | g | 3 |
| [거점 숙소 지정](./trip-bases.md) | g | 1 |
| [내 여행 목록 (일정 탭)](./my-trips.md) | h | 1 |

### 일정 생성

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [일정 만드는 방식 고르기](./itinerary-method.md) | h | 1 |
| [꼭 갈 곳 (필수 방문지 · 시각 고정)](./must-visits.md) | h | 2 |
| [완전 AI 일정 생성 · AI 추천안](./ai-generate.md) | h | 3 |
| [AI와 같이 짜기](./copick.md) | h | 2 |
| [직접 짜기 (장소 추가 · 시각 · 저장하고 확정)](./manual-plan.md) | h | 2 |

### 일정 보기·편집

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [완성·확정 일정 보기](./itinerary-view.md) | h | 1 |
| [일정 편집](./itinerary-edit.md) | h | 1 |

### 여행 중·Plan-B

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [여행 중 허브](./live-hub.md) | i | 1 |
| [여행 중 위치 (현재 위치·수동 위치·자동 도착)](./live-location.md) | i | 1 |
| [여행 중 장소 상세](./live-place.md) | i | 1 |
| [방문 체크 (도착·완료·건너뛰기·사진·메모)](./visit-check.md) | i | 2 |
| [Plan-B 재계획 요청 (AI에게 맡기기 · 직접 수정)](./planb-request.md) | i | 2 |
| [Plan-B 재계획 진행·초안·적용](./planb-apply.md) | i | 4 |

### 기록·회고

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [기록 탭 (여행 캘린더)](./records-tab.md) | j | 1 |
| [여행 기록 (방문 기록 j01 · 여행 요약 j04)](./trip-record.md) | j | 2 |
| [방문 추가 (계획에 없던 곳 기록)](./add-visit.md) | j | 1 |
| [하루 회고 (j03)](./reflection.md) | j | 1 |
| [공유 카드 (j06)](./share-card.md) | j | 1 |
| [여행 스타일 분석 (j05)](./record-style.md) | j | 1 |

### 마이·설정·알림·도우미

| 기능 | 밴드 | 라우트 수 |
|---|---|---|
| [마이 탭](./my-tab.md) | l | 1 |
| [설정](./settings.md) | l | 1 |
| [로그아웃 · 계정 삭제](./settings-account.md) | l | 1 |
| [여행 취향 · 개인화](./settings-preferences.md) | l | 2 |
| [알림 설정](./settings-notifications.md) | l | 1 |
| [위치정보 동의](./settings-location.md) | l | 1 |
| [약관 열람](./terms.md) | c | 1 |
| [알림함 · 푸시 탭 이동](./notifications.md) | l | 1 |
| [AI 도우미](./assistant.md) | b | 1 |
