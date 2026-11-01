---
id: itinerary-view
band: h
status: live-verified
live_verified_at: 2026-11-02 (f153fe245)
routes:
  - app/trips/[tripId]/itinerary/index.tsx
---

# 완성·확정 일정 보기

사용자는 완성된 일정(미확정 PLANNED, Figma h14)이나 확정된 일정(CONFIRMED, h16)을 전면 지도 + 3칸 바텀시트로 본다. 지도에는 고른 일차의 장소 핀이, 시트에는 일정 제목·일차·날짜·곳 수·총 이동 거리 머리줄과 장소 카드(검증된 시각 칩)·카드 사이 거리 커넥터가 뜬다. 일차 칩으로 날을 바꾸고, 미확정이면 [일정 확정하기]로 확정하고, 확정이면 [일정 수정]으로 편집기(`itinerary-edit.md`)에 들어가거나 [돌아가기]로 일정 탭에 간다. 소요시간은 어디에도 보이지 않고 거리만 보인다(INV-3).

## Sub-features

- `view-planned` 미확정(PLANNED) 얼굴 — 머리줄 `N곳 · X.Xkm`, CTA [일정 확정하기] 1개, 좌상단 뒤로 버튼 있음.
- `view-confirmed` 확정(CONFIRMED) 얼굴 — 머리줄 `확정됨 · N곳 · X.Xkm`(머리 아래 줄), CTA [일정 수정]·[돌아가기] 2개, 좌상단 뒤로 버튼 없음, 휴관 경고 `휴관일 확인`.
- `view-day-switch` 일차 칩으로 날 바꾸기 — 칩은 여행 기간(시작~종료일) 기준, 재조회 없이 카드·핀·머리줄이 그 날로 바뀐다.
- `view-distance` 카드 사이 거리 커넥터 — 서버 거리 문자열 그대로, `약 0.0km…`는 `바로 옆`, 값이 없으면 `거리 정보 없음`. 한 구간이라도 거리를 모르면 머리줄 km 를 뺀다.
- `view-confirm` [일정 확정하기] → 확정 토스트 `일정이 확정됐어요` + 같은 화면이 확정 얼굴로 바뀐다.
- `view-confirm-locked` 생성 중(`generationState=PARTIAL`)이면 [일정 확정하기] 비활성(회색, 눌러도 무반응).
- `view-confirm-error` 확정 실패 인라인 안내 `일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요`.
- `view-to-edit` 확정 얼굴 [일정 수정] → 보고 있던 날짜로 편집기 진입(`itinerary-edit.md`).
- `view-back` 뒤로 — 확정 얼굴의 [돌아가기]는 일정 탭 목록으로(알림 진입이면 이전 화면=알림함으로), 그 밖 얼굴은 이전 화면, 히스토리가 없으면 홈 탭.
- `view-no-base` 고른 날에 고정 숙소 카드가 없으면 시트 말미에 `거점 숙소가 없어요` 카드.
- `view-unplaced` 일정에 못 넣은 꼭 갈 곳이 있으면 `일정에 넣지 못한 꼭 갈 곳` 안내(일차와 무관, 여행 전체).
- `view-violation` 시간 위반 슬롯 카드에 위반 배지(서버 정성 문구, 숫자가 섞이면 `일정 확인이 필요해요`) — 확정 여부와 무관하게 데이터가 정한다.
- `view-fixed-stay` 고정 숙소 카드 — 단일 시각 칩 + `{시간대} · 숙소 · 변경 불가` 부제, 머리줄 곳 수에서 빠진다.
- `view-loading` 로딩 — 빈 화면 + 뒤로 버튼만.
- `view-notfound` 일정 없음(404) — `아직 완성된 일정이 없어요` + [일정 만들기] → 방식 선택.
- `view-failed` 조회 실패 — `일정을 불러오지 못했어요` (다시 시도 버튼 없음, 뒤로만).
- `view-trip-deleted` 여행 삭제됨(여행 404) — `삭제된 여행이에요`.
- `view-map-fallback` 지도 로드 실패 — `지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요` + [다시 시도], 시트·칩·CTA 는 유지. 지도 키 부재면 지도 자리에 실패 표면.
- `view-from-notification` 알림 진입(`?from=notification`) — 오늘(KST) 일차로 열리고, 확정이어도 [돌아가기]가 이전 화면(알림함)으로 간다.
- `view-statusbar-cover` 지도 화면 맨 위 상태바 자리는 흰 막으로 덮인다 — 시트를 내려 지도가 드러나도 상태바 글자가 지도에 묻히지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `view-pin-face` 지도 번호 핀은 분홍 물방울 안의 번호로 보이고 네이버 기본 초록 마커가 나오지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*

## How to get to it (user POV)

- **일정 생성 완료 뒤(AI 추천안 h08)**: 초안 화면 CTA [완성 일정 보기](`sheet-cta-button-${index}` 의 index 1) → 이 화면(push). 대개 PLANNED 얼굴로 열린다.
- **같이 짜기 완성 확인(h17)**: CTA [완성 일정 보기](index 0) → 이 화면(push).
- **직접 짜기 편집기**: [저장하고 확정하기] 성공 → 확정 토스트 뒤 이 화면으로 replace(확정 얼굴).
- **알림함 행 탭 / 푸시 탭**: 알림 `actionType=TRIP_ITINERARY` → `/trips/<id>/itinerary?from=notification`.
- **딥링크**: `trippilot:///trips/<tripId>/itinerary`(뒤로 갈 히스토리 없음 → 뒤로 = 홈 탭, 확정 얼굴 [돌아가기] = 일정 탭).
- **편집기 저장 뒤 복귀**: 편집기를 딥링크로 열어 히스토리가 없을 때 저장 성공 → 이 화면으로 replace.
- **일정 탭 카드·홈 카드·생성 완료 배너·도우미 「일정 보기」에서는 이 화면으로 오지 않는다** — 목적지 판정이 확정이면 여행 중 허브(`/trips/<id>/live`, `live-hub.md`), 미확정이면 초안(`/itinerary/draft`), 생성 중이면 생성 화면으로 보낸다(`resolveItineraryDestination`).
- **여행 중 허브에서도 이 화면으로 오지 않는다** — 허브의 편집은 i07 편집기로 간다(`itinerary-edit.md`·`live-hub.md`).

## Driving it with agent-device

Preconditions:

- 로그인된 계정에 일정이 있는 여행 1개 이상. PLANNED 얼굴은 AI 생성 직후(확정 전), CONFIRMED 얼굴은 확정한 여행이 필요하다. 2일 이상 여행이어야 일차 전환을 볼 수 있다.
- 여행 상태(시작 전/중/후)는 이 화면 얼굴을 바꾸지 않는다 — 얼굴은 일정 `status`·`generationState`만 본다. 단 알림 진입의 "오늘 일차"는 오늘이 여행 기간 안일 때만 의미가 있다(밖이면 1일차).
- 지도는 네이버 네이티브 SDK — dev build 에 `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID` 가 있어야 타일이 뜬다.

- **PLANNED 진입.** 일정 생성 → 초안(h08) → [완성 일정 보기]. 시트 머리 `sheet-header-title` 에 여행 제목, `sheet-header-day` 에 `1일차`, `sheet-header-meta` 에 `N곳 · X.Xkm`(접두 `확정됨` 없음)이 보이고, 하단 CTA testID: `sheet-cta-button-${index}`(index 0)이 `일정 확정하기`다. 좌상단 testID: `sheet-daychip-back` 이 보인다(접근성 트리에는 testID 대신 라벨 `뒤로` 버튼으로 잡힌다 — `role=button label="뒤로"`로 누른다).
- **카드·시각 칩.** 카드 testID: `slot-stopcard-${slotKey}`(slotKey = `YYYY-MM-DD#poiId`)마다 시각 칩 `HH:mm–HH:mm`(en-dash)이 보이고, 고정 숙소 카드는 단일 시각 `HH:mm` + 부제 `저녁 · 숙소 · 변경 불가` 류 + `고정` 알약이다. 카드 필드는 testID: `slot-stopcard-${role}-${slotKey}`(role = `time`·`fixed`·`subtitle`·`warning`·`violation`).
- **거리만, 시간 없음(INV-3).** 카드 사이 testID: `sheet-connector-${slotKey}` 에 거리 문자열 testID: `sheet-connector-distance-${slotKey}`(서버 원문, 예 `약 0.5km` 계열) 또는 `바로 옆`, 값이 없으면 testID: `sheet-connector-unknown-${slotKey}` = `거리 정보 없음`. 화면 어디에도 `분`·`시간` 소요 표기가 없어야 한다. 머리줄 km 는 커넥터 거리 합이고, 한 구간이라도 `거리 정보 없음`이면 `N곳`만 남는다.
- **일차 전환.** 칩 testID: `sheet-daychip-${index}`(0부터) 중 `2일차` 를 탭한다. `sheet-header-day` 가 `2일차`, `sheet-header-date` 가 그 날짜로 바뀌고 카드·지도 핀이 2일차 것으로 바뀐다. 칩은 여행 기간 일수만큼 있어서 일정이 비어 있는 날도 칩이 있고 카드 0곳이다.
- **확정.** [일정 확정하기] 탭. 토스트 testID: `itinerary-confirmed-toast` = `일정이 확정됐어요` 가 한 번 뜨고, 같은 화면이 확정 얼굴로 바뀐다 — `sheet-header-meta` 가 `확정됨 · …`, CTA 가 `일정 수정`(index 0)·`돌아가기`(index 1), `sheet-daychip-back` 이 사라진다. 다른 화면에서 한 번 더 읽기: 일정 탭 카드 배지가 확정으로 바뀌고 카드 탭이 허브로 간다.
- **확정 잠금(생성 중).** 2단계 생성이 아직 도는 일정(`generationState=PARTIAL`)으로 이 화면을 열면 [일정 확정하기]가 회색이고 눌러도 토스트·요청이 없다.
- **확정 실패.** 확정 요청이 실패하면(서버 409·5xx·오프라인) 시트 상단 testID: `itinerary-confirm-error` = `일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요`. 409 면 화면이 재조회돼 서버 상태로 맞춰진다.
- **확정 얼굴 → 편집.** 확정 얼굴에서 `2일차` 칩을 고른 뒤 [일정 수정] 탭. 편집기(`/trips/<id>/itinerary/edit?date=<그날>`)가 2일차로 열린다 — 이후는 `itinerary-edit.md`.
- **확정 얼굴 [돌아가기].** 탭하면 일정 탭 목록으로 스택을 거슬러 간다(생성·확정 화면이 스택에 남지 않는다). 알림 진입(`from=notification`)이면 대신 이전 화면(알림함)으로 간다.
- **거점 없음.** 고른 날에 고정 숙소 카드가 없으면 시트 말미에 testID: `itinerary-plan-no-base` = `거점 숙소가 없어요`(링크 없음).
- **못 넣은 꼭 갈 곳.** 서버 `unplacedMustVisits` 가 있으면 시트 상단 testID: `itinerary-unplaced-mustvisit` 에 `일정에 넣지 못한 꼭 갈 곳` + 행 testID: `itinerary-unplaced-mustvisit-${poiId}`(이름은 저장 장소 조회가 끝나야 붙는다).
- **위반 배지.** `hasViolation` 슬롯 카드에 role `violation` 배지 — 문구에 숫자가 없어야 한다(숫자 섞인 옛 형식은 `일정 확인이 필요해요`로 대체).
- **휴관 경고.** 확정 얼굴에서 `openingHoursKnown === false` 슬롯 카드에 role `warning` = `휴관일 확인`. PLANNED 얼굴에서는 같은 슬롯이어도 안 뜬다.
- **일정 없음.** 일정이 없는 여행 id 로 딥링크. testID: `itinerary-view-notfound` = `아직 완성된 일정이 없어요` / `일정을 만들면 여기에서 볼 수 있어요` + testID: `itinerary-plan-create-cta`(`일정 만들기`) → 방식 선택 화면. 뒤로는 testID: `itinerary-view-back`(트리에는 라벨 `뒤로` 버튼으로 잡힌다).
- **조회 실패.** 오프라인으로 진입. 자동 재시도 뒤 testID: `itinerary-view-failed` = `일정을 불러오지 못했어요` / `네트워크를 확인하고 다시 시도해주세요`, 다시 시도 버튼은 없고 `itinerary-view-back` 만 있다.
- **삭제된 여행.** 삭제한 여행 id 로 딥링크. testID: `itinerary-view-trip-deleted` = `삭제된 여행이에요` / `이 여행은 삭제되어 일정을 볼 수 없어요`(일정 만들기 없음).
- **지도 실패.** 지도 로드가 실패하면 지도 자리에 testID: `map-sheet-fallback` + testID: `map-sheet-fallback-retry`(`다시 시도`), 키 부재면 testID: `map-failure`. 어느 쪽이든 시트·칩·CTA 는 그대로다.
- **알림 진입.** 알림함에서 `TRIP_ITINERARY` 알림 행 탭(또는 `trippilot:///trips/<id>/itinerary?from=notification`). 오늘이 여행 기간 안이면 오늘 일차 칩이 선택돼 열리고, 확정이어도 [돌아가기]가 알림함으로 돌아간다.
- **증거.** 각 얼굴에서 접근성 트리 스냅샷 + 스크린샷. 머리줄·커넥터 문구가 같이 찍혀야 INV-3 판정이 된다.

## Gotchas

- **일정 탭·홈 카드로는 이 화면에 못 온다.** 확정 카드는 허브(`live-hub.md`), 미확정 카드는 초안으로 간다. "일정 탭에서 열었다"로 이 화면을 검증했다고 적지 마라 — 생성 흐름·알림·딥링크로 들어온다.
- **확정 얼굴은 뒤로 버튼이 없다**(사용자 결정) — `sheet-daychip-back` 부재가 정상이다. iOS 엣지 스와이프 뒤로는 [돌아가기]와 달리 이전 화면으로 간다(스택 정리 없음).
- **CTA 에 고유 testID 가 없다** — `sheet-cta-button-${index}` 는 위치 번호라 얼굴마다 뜻이 바뀐다(PLANNED 0=확정하기, CONFIRMED 0=일정 수정·1=돌아가기). 라벨 문구로 같이 확인한다.
- **일차 칩 번호 체계가 화면마다 다르다** — 여기 `sheet-daychip-${index}` 는 0부터, 편집기 `itinerary-edit-day-${dayIndex}` 는 1부터. 이 화면 칩은 여행 기간 기준이라 일정 days 와 개수가 다를 수 있다(편집기 칩은 일정 days 기준).
- **확정 실패 문구는 원인을 구별하지 않는다** — 409(재확정·생성 중)와 5xx 가 같은 문구. PARTIAL 이면 버튼이 먼저 잠겨 이 문구까지 안 간다.
- **확정 토스트는 성공 사건에 1회뿐** — 재진입·재조회에는 안 뜬다. 토스트를 놓쳤으면 머리줄 `확정됨 · ` 접두로 판정한다.
- **[실화면 전용]** 지도 핀·핀 맞춤·시트 3칸(닫힘/45%/88%) 실제 열림·시트 열린 채 지도 손가락 확대/이동(`mapViewOnly=false`)·딤. jest 목은 시트를 항상 렌더한다(`repo-traps.md` 바텀시트 절, `traps-map.md`).
- **[실화면 전용]** 커넥터 이동수단 글리프(도보·대중교통·자가용)는 서버 문자열의 단어로 고른다 — 모양은 육안으로만.
- **머리줄 km 와 커넥터 합이 어긋난 승인 카피가 Figma 에 있다**(`figma-traps.md` h14/h16) — 화면 값이 Figma 숫자와 다르다고 결함으로 적지 마라. 화면 기준은 커넥터 합이다.
- **조회 실패 얼굴은 자동 재시도(최대 3회) 뒤에야 뜬다** — 몇 초 빈 화면(로딩 얼굴)을 실패로 오판하지 마라.
- 확인 필요: 서버가 `TRIP_ITINERARY` 알림을 어떤 조건에 보내는지(알림함 행 문구 포함)는 앱에서 알 수 없다 — 알림 진입은 알림이 실재할 때만 검증된다. 과거 QA(2026-10-21 N-057)에서 여행 중 알림이 허브가 아니라 이 화면으로 온 것이 지적됐다.
- [실화면] 2026-10-31 알림함의 `일정` 분류 행(`오늘의 일정 · 오늘 어디를 가는지 확인해 보세요.`, `내일 일정 확인해보세요`)이 이 화면으로 온다. 지난 여행(10/26, PLANNED)의 행을 눌러 열었더니 오늘이 기간 밖이라 1일차로 열렸고 좌상단 `뒤로`가 알림함으로 돌아갔다. 확정 얼굴의 [돌아가기]→알림함은 확정 여행의 알림 행이 제주 여행(수정 금지)뿐이라 보지 못했다.
- 확인 필요: `openingHoursKnown === false` 슬롯이 dev-api 데이터에 실재하는지 — 없으면 휴관 경고는 도달 불가로 남긴다.
- 확인 필요: PARTIAL 일정으로 이 화면에 오는 실경로 — 카드·홈은 생성 화면으로 보내므로, 생성 중 초안에서 [완성 일정 보기]를 누르는 경우만 남는다(초안이 그때 그 버튼을 보이는지 미확인).
- [결함 의심 FM-L3-01] 2026-10-31 확정 + 시작 전 여행(서울 11/25·부산 11/17)에서 [일정 수정]은 편집기를 열어 주지만 저장은 `확정된 일정은 수정할 수 없어요`(409)로, 장소 추가는 `장소를 담지 못했어요. 잠시 후 다시 시도해 주세요`로 늘 거절된다 — 이 CTA 는 시작 전에는 막다른 길이다. 상세는 `itinerary-edit.md` Gotchas.
- [실화면] 2026-10-31 일정 탭 카드 동선 확인: 미확정 부산 카드 → 초안(h08), 확정 뒤 같은 카드 → 여행 중 허브(`execution-live-screen`, 시작 전 여행이어도 허브). 머리줄은 PLANNED 얼굴에서 제목 줄 오른쪽(`9곳 · 19.5km`), 확정 얼굴에서는 제목 아래 줄(`확정됨 · 3곳`)에 놓인다. 서울 일정은 커넥터 하나가 `거리 정보 없음`이라 머리줄이 `확정됨 · 3곳`으로 km 가 빠졌다.
- [실화면] 2026-10-31 도달 불가 — `view-confirm-locked`(PARTIAL 일정 없음 — 실 AI 생성이 빨라 완성으로 바로 착지)·`view-confirm-error`(실패 유도 수단 없음)·`view-unplaced`·`view-violation`·`view-fixed-stay`·휴관 경고(dev-api 데이터에 해당 신호가 있는 일정 없음 — 부산의 `고정` 카드는 시각 고정 꼭 갈 곳이지 숙소가 아니었다)·`view-loading`(로딩이 짧아 연속 스크린샷에도 안 잡힘)·`view-failed`·`view-map-fallback`(네트워크·지도 차단 수단 없음). 히스토리 없는 콜드 딥링크에서 PLANNED 얼굴 `뒤로`→홈도 PLANNED 테스트 여행이 남지 않아 못 봤다.
- [실화면] 2026-10-31 판단 필요(FM-L3-04) — 서울 확정 일정 지도에서 2번 핀이 `경복궁` 카드인데 용산(국립중앙박물관 부근)에 꽂혔다. 경복궁→의릉 커넥터 `약 14.4km`도 실제 거리보다 길어 POI 좌표 데이터 문제로 추정한다(앱 결함인지 미판정).
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `view-loading`(빈 화면 + 뒤로)·`view-failed`(`/trips/*/itinerary` 지연·500).
