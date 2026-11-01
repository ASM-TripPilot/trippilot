---
id: copick
band: h
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/itinerary/copick/[slotKey].tsx
  - app/trips/[tripId]/itinerary/copick/complete.tsx
---

# AI와 같이 짜기

AI가 먼저 초안(`CO_PLAN`)을 만들고, 사용자는 고정되지 않은 칸을 하나씩 돌며 직접 고른다. 칸마다 테마(식사·카페·전시·문화·야외·산책·쇼핑)를 고르거나 건너뛰면, 반경 안의 후보 A/B/C가 지도와 목록으로 뜨고 하나를 골라 [A로 선택]을 누른다. 마지막 칸을 고르면 "내가 고른 완성" 화면(지도 + 시트)이 열리고, [완성 일정 보기]로 완성 일정 보기 화면에 넘어간다(확정은 `itinerary-view.md`).

## Sub-features

- `copick-seed` 꼭 갈 곳 화면 → 생성 중 화면(`mode=CO_PLAN`) → 첫 비고정 칸으로 replace. 비고정 칸이 없으면 곧장 완성 화면.
- `copick-concept` 테마 고르기(앱바 `다음 활동 고르기`) — 5개 테마 카드 + `테마 없이 건너뛰기 · AI가 알아서 추천`.
- `copick-progress` 진행 줄 `지역 · N일차 / 전체 · M월 D일(요일)` + `칸 번호/그날 칸 수` + 일차 막대.
- `copick-stepper` 두 번째 칸부터 이전(`선택함`)·지금(`지금 고르는 중`)·다음(`비어 있음`) 3칸 스텝퍼.
- `copick-slot-fill` 후보 고르기(앱바 `{테마} 후보 고르기`) — 반경 3단(`700m`/`1.1km`/`최대`), 지도(기준 핀 + 반경 원 + 후보 A/B/C), 후보 라디오, [A로 선택].
- `copick-radius` 반경 세그먼트·하단 [반경 넓히기]/[반경 좁히기]. 서버가 더 넓혀 찾았으면 `700m 안에 없어 약 1.1km까지 넓혔어요` 꼴 안내.
- `copick-default-select` 후보가 오면 첫 후보(A)가 자동 선택된다.
- `copick-zero` 후보 0건 — `근처에서 조건에 맞는 곳을 못 찾았어요` + [반경 넓히기]/[컨셉 변경]/[장소 검색]. 최대 반경이면 `이 지역엔 더 넓혀도 후보가 없어요`. 사유가 "모두 일정에 있음"이면 다른 문구.
- `copick-locked` 2차 생성 중(PARTIAL)이면 선택이 잠기고 `나머지 일정을 만드는 중이에요`. 생성이 끝나면 실패했던 후보 조회를 자동으로 다시 한다.
- `copick-confirm` [A로 선택] → 그 칸만 바꿔 일정 저장(PUT) → 다음 비고정 칸으로 replace(마지막이면 완성 화면).
- `copick-confirm-error` 저장 실패면 인라인 문구, 화면에 남아 다시 누를 수 있다.
- `copick-candidates-error` 후보 조회 실패 문구.
- `copick-back-to-concept` 후보 고르기의 뒤로 = 테마 고르기로(나가기 아님).
- `copick-leave` 테마 고르기의 뒤로 — 고른 칸이 0이면 곧장 일정 탭으로, 1칸 이상이면 이탈 확인(`고른 N곳은 저장돼 있어요…`).
- `copick-resume` 같이 짜기 생성 중(PARTIAL) 여행을 홈·일정 탭에서 열면 첫 비고정 칸으로 다시 들어온다.
- `copick-complete` 완성 화면 — 제목 = 여행 이름, `N일차 · 날짜 · N곳`, 일차 칩, 카드 + 거리 연결선, 숙소 고정 칸 부제 `{시간대} · 숙소 · 변경 불가`.
- `copick-complete-error` 완성 화면 조회 실패 → `일정을 불러올 수 없어요` + [다시 시도].
- `copick-to-plan` [완성 일정 보기] → 완성 일정 보기 화면 push.

## How to get to it (user POV)

- 방식 고르기 `AI와 같이 짜기`(기존 일정이 있으면 확인 [계속]) → 꼭 갈 곳(`mode=CO_PLAN`) → [이 구성으로 일정 짜기]/[건너뛰기] → 생성 중 화면(`mode=CO_PLAN`, 성공 경로 = 칸 채우기) → 첫 비고정 칸. 앞 단계는 `itinerary-method.md`·`must-visits.md`·`ai-generate.md`.
- 칸 채우기 [A로 선택] → 다음 칸 또는 완성 화면으로 replace.
- 홈 히어로 카드(testID: `home-trip-hero-cta`)·일정 탭 카드(testID: `my-trip-card-${tripId}`)·앱 셸 생성 토스트 `보기`: 같이 짜기 PARTIAL이면 첫 비고정 칸, 같이 짜기 COMPLETE·미확정이면 완성 화면으로 push.
- 도우미 시트의 일정 열기도 같은 목적지 판정을 쓴다.
- 딥링크: `/trips/{tripId}/itinerary/copick/{slotKey}`(`slotKey` = `YYYY-MM-DD#poiId`, `#`은 `%23`으로 인코딩), `/trips/{tripId}/itinerary/copick/complete`.

## Driving it with agent-device

Preconditions:

- 로그인 상태, 꼭 갈 곳까지 마친 일정 없는 미래 여행(방식 고르기 → `AI와 같이 짜기`).
- 생성 요청 한 번이 하루 AI 한도를 1회 쓴다. 후보 조회는 칸마다 서버(→ AI)를 부른다. 백엔드 기본 `AI_SCHEDULE_MODE=fake`면 지역 후보풀에서 결정론으로 채우고, `http`면 실 AI가 후보를 낸다 — 후보 수·반경 확장 안내는 모드에 따라 다르다(확인 필요).
- 1박 2일이면 고를 칸이 15개 안팎이고 칸마다 후보 로딩이 수 초 걸린다(과거 QA 실측 8~10초). 전부 돌 시간이 없으면 몇 칸만 고르고 이탈 경로로 검증한다.

- **첫 칸 착지.** 생성 중 화면이 끝나면 testID: `itinerary-copick-concept-root`(앱바 `다음 활동 고르기`)가 뜬다. 진행 줄 testID: `itinerary-copick-concept-progress-day`(예 `부산 · 1일차 / 2 · 6월 10일(수)`), testID: `itinerary-copick-concept-progress-count`가 보인다. 첫 칸이면 스텝퍼가 없다.
- **테마 카드.** testID: `itinerary-copick-concept-${key}`(`key` = `meal`/`cafe`/`culture`/`outdoor`/`shopping`, 라벨 `식사`/`카페`/`전시·문화`/`야외·산책`/`쇼핑`)와 설명 testID: `itinerary-copick-concept-desc-${key}`(`근처 식당`·`쉬어 가기`·`전시·박물관`·`공원·산책로`·`상점·시장`)가 보인다.
- **테마 고르기.** `itinerary-copick-concept-meal`을 누른다. testID: `itinerary-copick-slotfill-root`(앱바 `식사 후보 고르기`)로 바뀌고 로딩 중 testID: `itinerary-copick-slotfill-skeleton`이 보인다.
- **건너뛰기.** 테마 화면에서 testID: `itinerary-copick-concept-skip`(`테마 없이 건너뛰기 · AI가 알아서 추천`)을 누른다. 앱바가 `후보 고르기`(테마 없음)로 뜬다.
- **후보 목록.** 후보가 오면 행 testID: `itinerary-candidate-radio-${poiId}`가 A부터 보이고 첫 후보가 자동 선택돼 있다. 지도 testID: `itinerary-copick-slotfill-map`에 기준 핀·반경 원·후보 A/B/C 핀이 보인다. 후보 행에는 거리만 있고 소요 시간이 없다(INV-3).
- **반경 바꾸기.** testID: `itinerary-copick-radius-seg-${key}`(`near` `700m` / `mid` `1.1km`(기본) / `max` `최대`)를 누른다. 고른 칸이 접근성 selected가 되고 후보를 다시 묻는다. 서버가 더 넓혔으면 testID: `itinerary-copick-radius-used`에 `… 안에 없어 약 …까지 넓혔어요`가 보인다. `최대`를 고르면 셋째 칸 라벨이 서버가 쓴 반경(`약 10.0km` 꼴)으로 바뀐다.
- **반경 넓히기/좁히기.** 하단 testID: `itinerary-copick-slotfill-radius`가 최대 전엔 `반경 넓히기`, 최대에선 `반경 좁히기`다. 누르면 한 단계 바뀐다.
- **다른 후보 고르기.** 다른 후보 행을 누른다. 확정 버튼 testID: `itinerary-copick-slotfill-confirm`의 라벨이 `B로 선택`처럼 바뀐다.
- **선택(저장).** `itinerary-copick-slotfill-confirm`을 누른다. 다음 칸의 테마 화면으로 바뀌고, (그날의 둘째 칸부터 — 2일차 첫 칸엔 스텝퍼가 없다) 스텝퍼 testID: `copick-stepper`에 이전 칸 이름(testID: `copick-stepper-${role}-title`)과 `선택함`, 지금 칸 `지금 고르는 중`, 다음 칸 `비어 있음`이 보인다.
- **생성 중 잠김.** 2차 생성이 끝나기 전이면 testID: `itinerary-copick-confirm-locked`(`나머지 일정을 만드는 중이에요`)가 뜨고 확정 버튼이 잠긴다. 기다리면 풀리고, 그 사이 실패했던 후보 조회는 자동으로 다시 나간다.
- **후보 0건.** 좁은 반경에서 후보가 없으면 testID: `itinerary-copick-zero`(`근처에서 조건에 맞는 곳을 못 찾았어요`)와 testID: `itinerary-copick-zero-radius`(`반경 넓히기`, 최대면 잠기고 `이 지역엔 더 넓혀도 후보가 없어요`)·testID: `itinerary-copick-zero-concept`(`컨셉 변경` → 테마 화면)이 보인다. "모두 일정에 있음" 사유면 `근처 후보가 이미 모두 일정에 있어요`와 testID: `itinerary-copick-zero-search`(`장소 검색` → 장소 추가 화면)가 보인다.
- **조회·저장 실패.** 후보 조회가 실패하면 testID: `itinerary-copick-candidates-error`, 저장(PUT)이 실패하면 testID: `itinerary-copick-slotfill-error`에 문구(예: `지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요`)가 뜨고 화면에 남는다.
- **후보 화면 뒤로.** testID: `itinerary-copick-slotfill-back`(라벨 `뒤로`)을 누른다. 같은 칸의 테마 화면으로 돌아온다(나가지 않는다).
- **이탈(고른 칸 있음).** 한 칸 이상 고른 뒤 테마 화면 testID: `itinerary-copick-concept-back`을 누른다. testID: `itinerary-copick-leave-confirm`(`고른 N곳은 저장돼 있어요. 나머지는 AI가 고른 그대로 남아요.`)이 뜬다. testID: `itinerary-copick-leave-confirm-stay`(`머무르기`)는 닫고, testID: `itinerary-copick-leave-confirm-leave`(`나가기`)는 일정 탭으로 간다.
- **이탈(고른 칸 없음).** 첫 칸에서 테마 화면 뒤로를 누르면 확인 없이 일정 탭으로 간다.
- **재진입.** 이탈한 여행의 일정 탭 카드를 누른다. 생성이 아직 PARTIAL이면 첫 비고정 칸으로 다시 들어온다(이미 고른 칸 포함 — 처음부터다). COMPLETE면 완성 화면으로 간다.
- **완성 화면.** 마지막 칸을 고르면 `MapSheetShell` 셸이 뜬다. 헤더 testID: `sheet-header-title`이 여행 이름, testID: `sheet-header-meta`가 `N곳`(숙소 고정 칸 제외)이다. 일차 칩 testID: `sheet-daychip-${index}`, 카드 testID: `slot-stopcard-${slotKey}`, 연결선 testID: `sheet-connector-${slotKey}`(거리만)이 보인다. 숙소 고정 칸 부제는 `오전 · 숙소 · 변경 불가` 꼴이다.
- **완성 일정 보기.** CTA testID: `sheet-cta-button-0`(`완성 일정 보기`)을 누른다. 완성 일정 보기 화면이 push된다. 고른 장소 이름이 그 화면에도 같은지 한 번 더 읽는다. 이후는 `itinerary-view.md`.
- **완성 화면 실패.** 네트워크를 끊고 완성 화면을 열면 testID: `itinerary-copick-complete-error`(`일정을 불러올 수 없어요`)와 testID: `itinerary-copick-complete-retry`(`다시 시도`)가 뜬다. 로딩 중엔 빈 testID: `itinerary-copick-complete-loading`.

## Gotchas

- [실화면 전용] 칸 채우기 지도(반경 원·A/B/C 핀·핀 맞춤)와 완성 화면 지도·바텀시트 칸 높이는 실화면으로만 확인된다.
- 칸 이동은 모두 `replace`다 — 이전 칸으로 돌아가는 뒤로가 없다. 고친 칸을 다시 고르려면 완성 일정 보기 → 편집(`itinerary-view.md`)으로 간다.
- 재진입은 진행 위치를 기억하지 않는다 — PARTIAL 재진입은 늘 "첫 비고정 칸"으로 간다. 이미 고른 칸을 다시 보여 주는 것이 정상 동작이다.
- [나가기]·고른 칸 0 이탈은 그 여행이 아니라 **일정 탭 목록**으로 간다.
- 진행 막대는 일차 기준이라 같은 날 안에서는 칸을 골라도 막대가 그대로다. 칸 수(분모)는 날마다 다르다.
- 후보가 오면 첫 후보가 자동 선택된다 — 행을 안 눌러도 확정 버튼이 열려 있다. "선택 없음" 상태를 기대하지 않는다.
- 반경 확장 안내와 세그먼트 선택 표시가 어긋날 수 있다(서버가 넓혀도 세그먼트는 요청한 칸 그대로). 과거 QA에서 백엔드가 사용자가 고른 반경을 AI에 안 넘긴 사례가 있다 — 후보 거리 수치로 반경을 단정하지 않는다.
- [장소 검색](0건 얼굴)은 날짜 없이 장소 추가 화면을 연다 — 지금 칸을 바꾸는 게 아니라 **1일차 끝에 추가**된다. 생성 중(PARTIAL)에도 이 경로의 저장은 막히지 않는다(`manual-plan.md`).
- 완성 화면은 일차 칩을 여행 기간 전체로 그린다 — 데이터가 없는 날 칩을 누르면 아무 반응이 없다(선택이 데이터 있는 날로 되돌아간다).
- 완성 화면의 뒤로(`sheet-daychip-back`)는 히스토리 뒤로만 한다 — 딥링크로 콜드 오픈하면 갈 곳이 없을 수 있다(확인 필요).
- 비고정 칸이 하나도 없으면(전부 고정) 생성 직후 테마 화면 없이 완성 화면으로 곧장 간다.
- [실화면] 2026-10-31 같이 짜기 생성 중에 ‹ 로 백그라운드로 나가면 생성이 끝난 뒤(COMPLETE) 일정 탭 카드·「일정 이어서 짜기」가 칸 고르기가 아니라 **완성 화면**으로 간다 — 한 칸도 고르지 않은 채 같이 짜기가 끝난 것처럼 보인다. 칸 고르기를 보려면 생성 화면에서 기다리거나 `com.trippilot.travel://trips/{id}/itinerary/copick/{YYYY-MM-DD}%23{poiId}` 딥링크로 연다(이번 검증은 딥링크로 첫 칸에 들어갔다).
- [실화면] 2026-10-31 후보 행은 트리에서 `itinerary-candidate-${poiId}` cell(라벨 「A, 이름, 설명, #태그, ·, 이동, 약 1.0km」)로 보이고 선택은 selected로 읽는다. `itinerary-candidate-radio-${poiId}` id 탭은 통한다. 반경 `최대` 를 고르면 셋째 칸이 `약 3.0km` 로 바뀌었다. 같은 칸·같은 반경이라도 다시 물을 때 후보 수가 달라졌다(실 AI, 2곳 → 1곳).
- [실화면] 2026-10-31 부산 1박 2일 15칸(1일차 8 · 2일차 7)을 모두 [A로 선택]으로 채워 완성 화면(제목 여행 이름, `8곳`, 거리 없음)까지 갔다. 거점 미지정이라 숙소 고정 칸은 없었다.
- [실화면] 2026-10-31 도달 불가 — `copick-seed`(생성 직후 첫 칸 착지: 백그라운드로 나가 보지 못함)·`copick-locked`(PARTIAL을 못 봄)·`copick-zero`(0건 반경 없음)·`copick-confirm-error`·`copick-candidates-error`·`copick-complete-error`(네트워크 차단 수단 없음). 이탈 확인은 [머무르기]까지만 눌렀고 [나가기]·0칸 이탈은 누르지 않았다.
