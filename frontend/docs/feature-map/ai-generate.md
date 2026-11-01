---
id: ai-generate
band: h
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/itinerary/generating.tsx
  - app/trips/[tripId]/itinerary/draft.tsx
  - app/trips/[tripId]/itinerary/stay-recommend.tsx
---

# 완전 AI 일정 생성 · AI 추천안

꼭 갈 곳을 확인하고 [이 구성으로 일정 짜기]를 누르면 AI가 일정을 만든다. 생성 중 화면이 뜨고, 1일차가 서버에 도착하면 추천안(지도 + 바텀시트)으로 넘어간다. 나머지 날은 추천안에서 진행 카드로 채워지는 것을 보여 준다. 다 만들어지면 일차 칩으로 날을 바꾸고, 장소 하나를 "다른 후보"로 바꾸고, [다시 짜기] 또는 [완성 일정 보기]로 나간다. AI가 취향을 반영하지 못했으면(폴백) 먼저 안내 화면이 가로막는다. 확정은 완성 일정 보기 화면에서 한다(`itinerary-view.md`).

## Sub-features

- `gen-progress` 생성 중 얼굴 — 진행 카드·비결정형 진행바·장식 그림·3단계(`장소 수집`/`동선 계산`/`시간 배치`). 퍼센트·시간 없음.
- `gen-background` 생성 중 뒤로 → 홈으로 나가고 토스트 `백그라운드에서 계속 만들고 있어요`. 생성은 서버에서 계속된다.
- `gen-shell-toast` 앱 셸이 생성 완료/실패를 감지해 토스트(`일정이 완성됐어요`/`일정을 만들지 못했어요`, 액션 `보기`).
- `gen-failed` 생성 요청 실패 → 실패 얼굴 + [다시 시도](요청 재발화).
- `gen-busy` 409 다른 여행 생성 중 → [취소하고 새로 만들기]/[기다리기]. 취소할 세션을 못 찾으면 [기다리기]만.
- `gen-ai-limit` 429 하루 AI 한도 → [직접 짜기 이어가기]/[닫기], 풀리는 시각 안내. [다시 시도] 없음.
- `gen-refused` 서버 규칙 거절(끝난 여행 재생성 등) → 서버 사유 + [닫기].
- `gen-planb-handoff` 여행 기간 중 재생성이 거절되면 토스트 `여행 중이라 재계획으로 다시 짜요` 후 재계획 모드로 다시 연다.
- `gen-replan` 재계획 모드(`replan=1`) — 세션 열기 → 폴링(상한 2분) → 초안 나오면 확인 없이 반영 → 추천안의 그 날로. 대안 없음·거절은 사유 + [닫기], 실패는 [다시 시도].
- `gen-observe` 모드 없이 열면(관찰 모드) 생성 요청을 안 보내고 일정 조회 결과로만 이동(일정 있음 → 추천안, 404 → 방식 고르기).
- `draft-partial` 2단계 생성 중(PARTIAL) — 진행 카드 게이지(`N일차 완성`/`N일차 생성 중`/`N일차 대기`, 5일 이상은 접힘) + 도착한 날 카드. CTA·다른 후보 없음.
- `draft-reveal` 생성 직후 첫 진입이면 경로가 그려지고 카드가 차례로 등장한다(`reveal=1`).
- `draft-listed` 완성 추천안 — 일차 칩·헤더 `AI 추천안 · N일차 · M월 D일 · 요일 · N곳 · X.Xkm`·카드·거리 연결선.
- `draft-day-switch` 일차 칩으로 날 전환(데이터가 도착한 날만 칩이 있다).
- `draft-alt` 비고정 카드의 `다른 후보 ›` → 후보 바텀시트 → 라디오 선택 → [교체하기].
- `draft-alt-states` 후보 시트의 로딩·10초 지연(`시간이 걸리고 있어요` + [다시 시도])·조회 실패·0건(사유 2종 + [장소 검색])·교체 실패 인라인 문구.
- `draft-fallback-interstitial` 폴백이면 `AI 추천은 잠시 쉬어요` 안내 화면 → [기본 일정 보기]/[다시 시도]/[직접 짜기].
- `draft-fallback-banner` 폴백 목록은 제목 `기본 일정` + 안내 + `처음부터 직접 짜기` 링크(비우기 확인).
- `draft-shortfall` 후보 부족이면 시트 안 한 줄 `근처에 … 후보가 적어요`.
- `draft-stale-failed` 2차 생성 실패(FAILED)인데 1일차가 있으면 목록 + `일부 정보를 불러오지 못했어요`.
- `draft-unplaced` 일정에 넣지 못한 꼭 갈 곳 목록.
- `draft-regenerate` [다시 짜기] → 갈 길에 따라 확인(생성 횟수 사용/재계획 바로 반영) · 생성 중 확인 · 확정 일정 거절 안내.
- `draft-loading`/`draft-failed`/`draft-empty` 일정이 0곳일 때의 얼굴(헤더 [다시 만들기]·[직접 고르기]).
- `draft-manual-redirect` 직접 짜기(MANUAL) 일정이 0곳이면 추천안 대신 직접 짜기 편집기로 replace.
- `draft-to-plan` [완성 일정 보기] → 완성 일정 보기 화면 push(확정은 거기서).
- `stay-recommend` (현재 앱 안 진입 없음) 동선 기준 숙소 추천 — 추천 데이터 미배선이라 인기 숙소 또는 안내 얼굴만 뜬다.
- `draft-header-actions` 헤더의 [직접 고르기]와 [다시 만들기] 사이에 구분자가 있어 두 버튼으로 읽힌다([직접 고르기]가 없으면 구분자도 없다). 폴백이면 안내 아이콘이 ✓가 아니라 주의 표시다. *(2026-11-01 jest 축소로 실화면 전용)*
- `draft-day-tabs-scroll` 일차 탭이 7일 이상이면 가로로 밀리고, 다른 날을 고르면 그 탭이 화면 안으로 스크롤된다. *(2026-11-01 jest 축소로 실화면 전용)*
- `draft-alt-states` 후보 조회 실패 카드는 0건 카드와 같은 점선 카드 모양이다. *(2026-11-01 jest 축소로 실화면 전용)*
- `gen-progress-track` 생성 중 카드의 진행 막대는 끝난 날이 빨강으로 차고, 짓는 중·대기 날은 회색이다. *(2026-11-01 jest 축소로 실화면 전용)*

## How to get to it (user POV)

- 꼭 갈 곳 화면 [이 구성으로 일정 짜기]·[건너뛰기] → 홈까지 걷고 생성 중 화면 push(`mode=FULLY_AI`). 세부는 `must-visits.md`.
- 거점 숙소 화면(여행 단위)에서 거점을 바꾸고 재생성을 고르면 홈까지 걷고 생성 중 화면 push(`mode=FULLY_AI`).
- 생성 성공 → 추천안으로 replace(`reveal=1`).
- 홈 히어로 카드(testID: `home-trip-hero-cta`)·일정 탭 카드(testID: `my-trip-card-${tripId}`): 완전 AI 생성 중(PARTIAL)이면 생성 중 화면(관찰 모드, 곧 추천안으로 replace), 미확정 초안·FAILED면 추천안으로 push.
- 앱 셸 토스트 `일정이 완성됐어요`/`일정을 만들지 못했어요`의 `보기` → 같은 목적지 판정으로 push.
- 추천안 [다시 짜기] 확인 → 생성 중 화면으로 replace(생성 또는 `replan=1`).
- 여행 중 허브의 [다시 짜기]는 재계획 모드(`replan=1`)로 온다 — 여행 중 기능 파일 소관.
- 직접 짜기·같이 짜기 일정이 미확정이면 홈·카드 목적지가 추천안이 된다(직접 짜기 0곳은 편집기로 replace — `manual-plan.md`, 같이 짜기 완성은 `copick.md`).
- 딥링크: `/trips/{tripId}/itinerary/generating`(모드 없으면 관찰), `/trips/{tripId}/itinerary/generating?mode=FULLY_AI`(생성 요청 발화 — AI 한도 소모), `/trips/{tripId}/itinerary/draft`(`?day=YYYY-MM-DD`로 날 지정), `/trips/{tripId}/itinerary/stay-recommend`.
- 숙소 추천(`stay-recommend`)은 앱 안에서 들어오는 링크가 없다 — 딥링크로만 열린다.

## Driving it with agent-device

Preconditions:

- 로그인 상태, 꼭 갈 곳까지 마친 **일정 없는 여행**(방식 고르기 → 완전 AI → 꼭 갈 곳 경로로 진입).
- 개발 서버의 AI 모드에 따라 결과가 다르다. 백엔드 기본은 `AI_SCHEDULE_MODE=fake`(결정론 일정, 지역 후보풀에서 채움)이고, 실 AI는 `http`다. 폴백 안내(`isFallback`)·후보 부족(`candidatesSummary`)·차선책(`alternatives`)이 어느 모드에서 실제로 실리는지는 확인 필요 — 폴백 인터스티셜이 안 뜬다고 실패로 보지 않는다.
- 생성 요청 한 번이 하루 AI 한도를 1회 쓴다. 한도 얼굴을 보려면 한도를 다 쓴 계정이 필요하다.
- 여행 기간이 오늘을 포함하면 재생성이 재계획으로 넘어간다 — 생성 경로를 보려면 미래 여행을 쓴다.

- **생성 중.** 진입 직후 앱바 testID: `itinerary-generating-appbar`(제목 `AI 일정 생성`), 카드 `AI가 일정을 짜고 있어요`·`취향·거리·동선까지 맞추는 중`, 진행바 testID: `itinerary-generating-progress`, 단계 testID: `itinerary-generating-step-${n}`(`장소 수집`·`동선 계산`·`시간 배치`)이 보인다. **퍼센트·남은 시간·분/초 문구가 없다**(INV-3).
- **1일차 도착.** 기다리면 추천안으로 바뀐다. 2차 생성 중이면 지도 위 진행 카드 testID: `generation-progress-card`와 게이지 testID: `generation-gauge-cell-${n}-${status}`가 보이고 1일차 셀이 `1일차 완성`, 다음 셀이 `2일차 생성 중`이다. 시트 헤더 testID: `sheet-header-title`이 `AI 추천안`, testID: `sheet-header-meta`가 `N곳 · X.Xkm`(시간 없음)이다. 하단 CTA와 `다른 후보 ›`가 없다.
- **완성.** 계속 기다리면(폴링 2초×15회 → 5초×15회) 진행 카드가 일차 칩 testID: `sheet-daychip-${index}`(`1일차`…)로 바뀌고 하단 CTA testID: `sheet-cta-button-0`(`다시 짜기`)·`sheet-cta-button-1`(`완성 일정 보기`)이 생긴다.
- **카드·거리.** 카드 testID: `slot-stopcard-${slotKey}`(`slotKey` = `YYYY-MM-DD#poiId`)마다 시각 칩 `HH:mm–HH:mm`, 카드 사이 연결선 testID: `sheet-connector-${slotKey}`에 거리(서버 문자열 그대로 — `약 1.4km · 대중교통`·`약 0.1km · 도보 추정`·`약 6.2km · 대중교통 추정` 꼴, 0이면 `바로 옆`, 모르면 `거리 정보 없음`)가 보인다. **연결선에 소요 시간이 없다**(INV-3).
- **일차 전환.** `sheet-daychip-1`을 누른다. 헤더 testID: `sheet-header-day`가 `2일차`, testID: `sheet-header-date`가 그날 날짜로 바뀌고 카드·핀이 그날 것으로 바뀐다. 데이터가 없는 날은 칩이 없다.
- **다른 후보 열기.** 비고정 카드의 `다른 후보 ›`(카드 testID 접두 `slot-stopcard-${role}-${slotKey}`, role `alt`)를 누른다. 시트 testID: `itinerary-candidate-sheet`가 열리고 제목 testID: `itinerary-candidate-sheet-title`, 부제 testID: `itinerary-candidate-sheet-subtitle`(`HH:mm–HH:mm · 컨셉 · 후보 거리는 이 자리의 장소 기준이에요`)이 보인다. 고정 카드에는 `다른 후보 ›`가 없다.
- **후보 로딩.** 차선책이 없으면 요청을 보내 testID: `itinerary-candidate-loading`(스켈레톤)이 보이고, 10초가 넘으면 testID: `itinerary-candidate-slow`(`시간이 걸리고 있어요`)와 testID: `itinerary-candidate-fetch-retry`(`다시 시도`)가 생긴다.
- **후보 선택·교체.** 후보 행 testID: `itinerary-candidate-radio-${poiId}`를 누르면 체크 testID: `itinerary-candidate-check-${poiId}`가 붙는다. testID: `itinerary-candidate-confirm`(`교체하기`, 요청 중 `바꾸는 중이에요`)을 누른다. 시트가 닫히고 그 자리 카드 이름이 바뀐다. 완성 일정 보기 화면에서도 바뀐 이름인지 한 번 더 읽는다.
- **후보 0건.** testID: `itinerary-candidate-empty`가 `이 자리에 맞는 다른 후보가 없어요`/`다른 곳을 직접 검색해 보세요`, 사유가 `ALL_IN_ITINERARY`면 `근처 후보가 이미 모두 일정에 있어요`로 바뀐다. testID: `itinerary-candidate-empty-search`(`장소 검색`)는 장소 추가 화면으로 간다(`manual-plan.md`).
- **후보 실패.** 조회가 실패하면 testID: `itinerary-candidate-fetch-error`, 교체 PUT이 실패하면 testID: `itinerary-candidate-error`에 문구(예: `확정된 일정이라 지금은 바꿀 수 없어요`·`일정을 만드는 중이에요. 잠시 후 다시 시도해 주세요`·`지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요`)가 뜨고 시트는 그대로다.
- **시트 닫기.** 딤 testID: `itinerary-candidate-scrim`(라벨 `닫기`)을 누른다. 시트가 닫힌다.
- **다시 짜기(미래 여행).** `sheet-cta-button-0`(`다시 짜기`)을 누른다. testID: `itinerary-regenerate-confirm`(`일정을 다시 짤까요?`, 본문 끝 `오늘 AI 생성 횟수를 1회 써요`)이 뜬다. testID: `itinerary-regenerate-cancel`(`취소`)은 추천안으로 돌아오고, testID: `itinerary-regenerate-proceed`(`다시 짜기`)는 생성 중 화면으로 replace한다.
- **다시 짜기(여행 중).** 오늘이 여행 기간이면 같은 확인 본문 끝이 `새로 짠 일정이 바로 반영돼요`이고, 진행하면 재계획 모드로 간다.
- **다시 짜기(확정 일정).** 확정 일정이면 확인 대신 testID: `itinerary-regenerate-stop`(`일정을 다시 짤 수 없어요`/`확정한 일정은 지금 다시 짤 수 없어요`)과 testID: `itinerary-regenerate-stop-ok`(`확인`)만 뜬다.
- **다시 짜기(생성 중).** 생성이 도는 중이면 testID: `itinerary-draft-inprogress-confirm`(`지금 만들고 있는 일정이 있어요`)과 [계속]/[취소](testID: `itinerary-draft-inprogress-confirm-continue`·`itinerary-draft-inprogress-confirm-cancel`)가 뜬다.
- **완성 일정 보기.** `sheet-cta-button-1`을 누른다. 완성 일정 보기 화면이 push된다. 확정·편집은 `itinerary-view.md`를 따른다.
- **폴백 인터스티셜.** 폴백 일정이면 추천안 대신 testID: `itinerary-fallback-root`(앱바 `일정 만들기`), testID: `itinerary-fallback-message`(`AI 추천은 잠시 쉬어요`), 체크리스트 testID: `itinerary-fallback-check-${n}`(`동선·거리 계산`·`취향 반영 (건너뜀)`·`기본 일정 완성`, 고정 슬롯이 있으면 `꼭 갈 곳 N곳 배치`)이 보인다. testID: `itinerary-fallback-view-plan`(`기본 일정 보기`) → 같은 데이터의 목록(제목 `기본 일정`), testID: `itinerary-fallback-retry`(`다시 시도`) → 다시 짜기 갈 길, testID: `itinerary-fallback-manual`(`직접 짜기`) → 직접 짜기 편집기.
- **폴백 목록 안내.** 폴백 목록 시트 맨 위 testID: `itinerary-draft-fallback-banner`(`취향 반영 없이 만든 기본 일정이에요` · `장소 하나만 다른 후보로 바꿀 수도 있어요`)와 링크 testID: `itinerary-draft-manual`(`처음부터 직접 짜기`)이 보인다. 미확정이면 testID: `itinerary-draft-manual-reset-confirm`(`지금 일정을 비우고 새로 짤까요?`) → testID: `itinerary-draft-manual-reset-confirm-continue`(`비우고 시작`)가 빈 직접 짜기(`fresh=1`)로 push한다.
- **후보 부족·일부 실패·미배치.** 해당 신호가 있으면 testID: `itinerary-draft-shortfall`(`근처에 명소·맛집 후보가 적어요` 꼴), testID: `itinerary-draft-stale-failed`(`일부 정보를 불러오지 못했어요`), testID: `itinerary-unplaced-mustvisit`(`일정에 넣지 못한 꼭 갈 곳`)가 시트 안에 뜬다.
- **생성 실패.** 네트워크를 끊은 채 생성 화면을 연다. testID: `itinerary-generating-failed`(`일정을 만들지 못했어요`)와 testID: `itinerary-generating-retry`(`다시 시도`)가 뜬다.
- **다른 여행 생성 중(409).** 다른 여행 생성이 도는 동안 새 여행 생성을 시작한다. testID: `itinerary-generation-busy`(`다른 여행의 일정을 만들고 있어요`)와 testID: `itinerary-generation-busy-cancel-retry`(`취소하고 새로 만들기`)·testID: `itinerary-generation-busy-wait`(`기다리기`, 홈으로)가 뜬다. 취소할 세션을 못 얻으면 본문이 `지금은 첫날을 만드는 중이라 취소할 수 없어요. 조금 뒤에 다시 시도해 주세요.`로 바뀌고 [기다리기]만 남는다.
- **AI 한도(429).** 한도를 다 쓴 계정이면 testID: `ai-limit-notice`(`오늘 AI 일정 만들기를 모두 썼어요`, 본문 `오늘|내일 HH:mm 이후에 다시 쓸 수 있어요.` + `직접 짜기는 계속 쓸 수 있어요.`)와 testID: `ai-limit-manual-cta`(`직접 짜기 이어가기` → 직접 짜기로 replace)·testID: `ai-limit-close`(`닫기` → 홈)가 뜬다. [다시 시도]가 없다.
- **서버 거절.** 끝난 여행 재생성 등 규칙 거절이면 testID: `itinerary-generating-refused`(`일정을 다시 만들 수 없어요` + 서버 사유)와 testID: `itinerary-generating-refused-close`(`닫기`)가 뜬다. 여행 중이면 대신 토스트(testID: `itinerary-generating-planb-handoff-toast`)가 뜨고 재계획 모드로 바뀐다.
- **백그라운드 이탈.** 생성 중 testID: `itinerary-generating-back`(라벨 `뒤로`)을 누른다. 홈 탭으로 가고 토스트 testID: `itinerary-generating-background-toast`(`백그라운드에서 계속 만들고 있어요`)가 뜬다. 다 만들어지면 홈에서 토스트 testID: `generation-complete-toast`(`일정이 완성됐어요`)가 뜨고 `보기`가 추천안을 연다.
- **재계획 중지.** 재계획 모드에서 뒤로를 누르면 반영 전이면 토스트 testID: `itinerary-generating-replan-stopped-toast`(`다시 짜기를 멈췄어요. 원래 일정을 그대로 둘게요.`)가 뜬다. 대안이 없으면 `itinerary-generating-refused` 얼굴에 `지금 바꿀 수 있는 곳을 찾지 못했어요. 원래 일정을 그대로 둘게요.`가 보인다.
- **일정 0곳 얼굴.** 일정에 슬롯이 하나도 없으면 셸 대신 testID: `itinerary-draft-title`(`AI 추천안`/폴백 `기본 일정`) 화면이 뜬다. 빈 얼굴 testID: `itinerary-draft-empty`(`아직 만들어진 추천안이 없어요`), 실패 testID: `itinerary-draft-failed`(`추천안을 불러오지 못했어요`), 로딩 testID: `itinerary-draft-loading`. 헤더 testID: `itinerary-draft-retry`(`다시 만들기`, 확정이면 잠김)와 testID: `itinerary-draft-pick-manual`(`직접 고르기`)이 있다.
- **숙소 추천(딥링크).** `/trips/{tripId}/itinerary/stay-recommend`를 연다. 추천 데이터가 넘어가지 않으므로 인기 숙소가 있으면 `인기 숙소`·testID: `stay-recommend-curated-notice`(`이번 동선 기준 추천은 아직 없어요 · 대신 인기 숙소를 보여 드려요`), 없으면 testID: `stay-recommend-empty`(`지금은 동선 기준 추천을 보여 드릴 수 없어요`)와 testID: `stay-recommend-empty-browse`(`다른 숙소 둘러보기` → 숙소 탭)가 보인다. testID: `stay-recommend-empty-back`(`돌아가기`)은 뒤로, 히스토리가 없으면 완성 일정 보기로 replace.

## Gotchas

- [실화면 전용] 지도·핀 맞춤·`reveal=1` 경로 그려지기·카드 등장 모션·진행바가 좌→우로 흐르는지는 실화면으로만 확인된다. 정지 스크린샷으로는 진행바 움직임도 확인되지 않는다.
- [실화면 전용] 다른 후보 바텀시트의 실제 열림·딤 전면 덮임·스와이프 닫힘, 시트 안 로딩·지연·실패 얼굴의 실제 모양은 실화면 전용이다. 시트는 화면의 뒤 형제로 그려지므로 카드·하단 CTA 위에 떠야 한다(과거 결함).
- [실화면 전용] 추천안 지도는 시트가 열려 있어도 손가락 확대·이동이 된다(`mapViewOnly={false}`). 바텀시트 칸 높이는 실화면 전용.
- 1일차 도착 전에 홈으로 나갔다가 홈에서 다시 생성을 고르면 도는 생성이 취소된다(홈 캐시가 404를 들고 있던 창). 생성 대기 중 다른 경로로 재진입하지 않는다.
- 2차 생성 폴링은 약 105초(30회)에서 멈춘다. 그 뒤에도 PARTIAL이면 **1일차가 있는 한 진행 카드가 그대로 남고 실패 안내가 없다**(일부 실패 배너는 완성 셸에만 있다). "계속 생성 중"으로 보이면 포그라운드 복귀·재진입으로 서버 상태를 다시 읽는다.
- 같은 화면에서 일차 칩은 **데이터가 도착한 날만** 그린다 — 칩 수가 여행 일수보다 적으면 그날이 아직 안 왔거나 2차가 실패한 것이다.
- PARTIAL 중에는 `다른 후보 ›`·CTA가 없다(생성 중 전체 교체 PUT 사고 방지). 교체를 보려면 완성을 기다린다.
- 후보 시트는 열 때 경로를 한 번 정한다 — 생성 때 받은 차선책이 있으면 요청 없이 곧장 행이 뜬다(이 첫 화면은 프리뷰 키가 없어 실화면으로만 본다). 백엔드가 409를 전부 `CONFLICT`로 던져 `일정을 만드는 중이에요…` 문구는 실제로 도달하지 않을 수 있다 — 확인 필요.
- 후보 0건의 [장소 검색]은 날짜를 싣지 않고 장소 추가 화면을 연다 — 바꾸려던 자리가 아니라 **1일차 끝**에 추가된다(`manual-plan.md`).
- `다른 후보 ›` 문구는 화면마다 상수 사본이 있어 한쪽만 바뀌어도 테스트가 못 잡는다 — 문구로 잡을 때 화면별로 확인한다.
- 폴백 인터스티셜의 [기본 일정 보기]는 화면 이동이 아니라 같은 화면의 얼굴 교체다(뒤로 가도 인터스티셜로 안 돌아간다). 재진입하면 다시 뜬다.
- [다시 짜기]는 미래 여행이면 AI 하루 한도를 1회 쓴다. 확인 문구로 갈 길(생성/재계획)을 먼저 확인하고 누른다.
- 생성 화면의 `itinerary-fallback-failed` 변형은 화면 경로가 없어 실화면 도달 불가다.
- 직접 짜기(MANUAL) 일정은 폴백 신호가 없어 폴백 안내가 안 뜨는 것이 정상이다. 추천안에 MANUAL 일정이 오면 제목이 `내 일정`, CTA가 `편집하기`다.
- 숙소 추천 화면 부제 `숙소를 직접 둘러보고 저장하면 거점으로 지정할 수 있어요.`는 지금 지켜지지 않는다 — 저장하고 돌아와도 같은 무데이터 얼굴이다. 거점 지정 CTA(`…을/를 거점으로`) 경로는 추천 API 미배선이라 실화면 도달 불가다.
- 생성 화면에서 앱바 뒤로는 취소가 아니다(취소 버튼 없음). 생성은 서버에서 끝까지 간다.
- [실화면] 2026-10-31 개발 서버는 실 AI로 생성했다 — 부산 1박2일 완전 AI가 약 50초 만에 1·2일차가 모두 온 완성 추천안(제목 `AI 추천안`, 폴백 아님)으로 바로 착지해 PARTIAL 진행 카드는 보지 못했다. 시각 고정(12:00, 체류 `여유`) 꼭 갈 곳은 `12:00–13:00` 카드로 들어갔고 `다른 후보 ›` 가 없었다(체류 `여유` 가 1시간으로 배치된 것이 의도인지는 확인 필요).
- [실화면] 2026-10-31 셸 토스트 `일정이 완성됐어요` 는 백그라운드 이탈 뒤 약 48초에 홈에 떴지만 몇 초 만에 사라져 `보기` 를 누르기 전에 걷혔다 — 토스트 `보기` 경로는 뜨자마자 누른다. 다른 후보 시트는 차선책 없이 요청을 보내 스켈레톤 → 약 10초 안에 후보 1곳이 왔다.
- [실화면] 2026-10-31 409 얼굴 본문은 `한 번에 하나만 만들 수 있어요. 기존 생성을 멈추고 이 여행을 만들까요?` 였다(다른 여행 생성 중에 두 번째 여행 생성을 시작해 재현). [기다리기]는 홈으로 갔다.
- [실화면] 2026-10-31 도달 불가 — `gen-failed`·`draft-loading/failed/empty`(네트워크 차단 수단 없음)·`gen-ai-limit`(한도 남은 계정)·`gen-refused`·`gen-planb-handoff`·`gen-replan`(여행 중 여행은 제주뿐이고 수정 금지)·`draft-partial`(생성이 빨라 완성으로 바로 착지)·`draft-fallback-interstitial`·`draft-fallback-banner`·`draft-shortfall`·`draft-stale-failed`·`draft-unplaced`(실 AI가 해당 신호를 안 냄)·`draft-manual-redirect`(0곳 MANUAL 일정 미준비). [다시 짜기]는 확인 다이얼로그와 [취소]까지만 봤다(AI 한도).
