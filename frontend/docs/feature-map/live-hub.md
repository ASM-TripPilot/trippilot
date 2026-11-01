---
id: live-hub
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/live/index.tsx
---

# 여행 중 허브

확정(CONFIRMED)된 일정을 연 사용자가 보는 여행 중 화면이다. 전면 지도(핀·계획 동선) 위 좌상단에 일차 칩이 있고, 아래 시트(중간 55% · 펼침, 더 내리면 완전히 사라짐)에 헤더 `{여행 제목} · {N}일차 · {날짜} · {K}곳`과 레일 타임라인 카드(방문 완료·지금 방문 중·예정 3상태)가 있다. 화면 아래 내비 바는 둥근 뒤로 + `일정`·`수정`·`챗봇`·`행사` 4칸이다. `수정`은 「AI에게 맡기기」(재계획)·「직접 수정」(편집기) 팝업을 띄우고, 발화 중인 위험(날씨·지연·휴무) 트리거가 있으면 지도 위 알약 → 위험 상세 시트 → [대안 보기]로 재계획에 들어간다. 확정 일정은 날짜와 무관하게 이 허브로 열린다 — 여행 전이면 1일차, 여행 후면 마지막 일차가 처음 보인다. 방문 체크·사진·메모는 `visit-check`, 재계획 이후는 `planb-request`·`planb-apply`, 장소 상세는 `live-place` 파일이 맡는다.

## Sub-features

- `hub-open` 확정 일정 진입 → 허브(`execution-live-screen`). 오늘이 여행 기간 안이면 오늘 일차, 여행 전이면 1일차, 여행 후면 마지막 일차가 선택돼 열린다.
- `hub-loading` 일정 조회 중 → 빈 로딩 면(`execution-live-loading`).
- `hub-no-itinerary` 일정 404 → 「아직 일정이 없어요」 + [일정 만들기]·[뒤로].
- `hub-trip-notfound` 여행 자체가 404 → 「페이지를 찾을 수 없어요」 + [홈으로].
- `hub-error` 일정 조회 실패(404 아님) → 「일정을 불러오지 못했어요」 + [다시 시도]·[뒤로].
- `hub-day-switch` 일차 칩 press → 그 일차의 카드·핀·헤더로 바뀐다(알약·떠 있는 팝업은 닫힌다).
- `hub-sheet-snap` 시트 끌기: 중간 ↔ 펼침, 끝까지 내리면 시트가 사라지고 `일정` 칸이 중간으로 다시 올린다.
- `hub-pin-tap` 지도 핀 press → 시트가 펼침으로 올라간 뒤 그 카드로 스크롤.
- `hub-slot-name` 카드 이름 `›` press → 장소 상세(`live-place`).
- `hub-directions` 예정·진행 중 카드 [길찾기] → 외부 지도 앱/웹. 둘 다 실패하면 그 카드 아래 「지도를 열 수 없어요.」(+거리).
- `hub-edit-popup` `수정` 칸 → 팝업 「AI에게 맡기기」·「직접 수정」. 다시 누르거나 다른 칸·지도 탭·시트 이동으로 닫힌다.
- `hub-ai-disabled` 보는 날이 이미 지난 날이거나 여행 시작 전이면 「AI에게 맡기기」가 흐리게 비활성.
- `hub-ai-other-day` 오늘이 아닌(미래) 일차를 보며 「AI에게 맡기기」 → 재계획 요청이 그 날짜(`targetDate`)로 열린다.
- `hub-manual-edit` 「직접 수정」 → 보고 있는 날짜로 편집기(`planb/manual?date=`).
- `hub-chatbot` `챗봇` 칸 → AI 도우미(LIVE 문맥).
- `hub-trigger-pill` 발화 중 트리거(MANUAL 제외)가 있으면 지도 위 알약(`{날짜어}{라벨} · {장소}…`) + 영향 받는 예정 카드의 「예정」 자리에 분홍 배지(라벨). 지도 탭·시트 스크롤·스냅·일차 칩으로 알약을 숨긴다(새 트리거가 오면 다시 보인다).
- `hub-risk-sheet` 알약 press → 위험 상세 시트(「위험 요소 · {분류}」 또는 「주의 · {분류}」, 출처, 영향 슬롯, 「재계획이 지켜보는 것」) → [대안 보기]로 재계획 요청(트리거 진입).
- `hub-opportunity` 보는 날에 기회(행사 추천)가 있으면 `행사` 칸이 활성(접근성 값 「추천 있음」) → 카드 → [넣어서 다시 짜기](자유 입력 `{장소명} 꼭 넣어서 다시 짜 줘`로 재계획 요청) 또는 닫기. 기회가 없으면 칸이 비활성(눌러도 무반응).
- `hub-my-location` 오늘 일차를 보고 있고 위치정보 이용 동의가 켜져 있으면 지도에 내 위치(네이버 기본 현위치) 점.
- `hub-actual-route` 자동 기록 빌드 + 동의 + 그날 경로가 있으면 계획 동선 위에 실제 경로가 겹친다(`live-location` 참고).
- `hub-applied-sheet` 재계획 적용 직후(`?applied=`) 반영 시트 — `planb-apply` 참고.
- `hub-back` 뒤로 원 → 이전 화면, 히스토리가 없으면(딥링크·푸시 직행) 홈 탭으로 replace.
- `hub-pin-color` 지도 핀이 진행 상태대로 그려진다 — 완료는 초록에 체크, 진행 중(지금 갈 곳)은 분홍 번호, 예정은 회색 번호. *(2026-11-01 jest 축소로 실화면 전용)*
- `hub-rail` 카드 왼쪽 레일 점이 카드마다 상태(완료·진행 중·예정)대로 하나씩 선다. *(2026-11-01 jest 축소로 실화면 전용)*
- `hub-bar-layout` 하단 바가 앱 탭 바와 같은 자리에 서고(홈 인디케이터 높이를 더 띄우지 않는다, 뒤로 버튼과 칸 캡슐 사이 간격은 한 번만), 목록 마지막 카드·지도 로고·행사 카드가 바에 가리지 않는다. 수정 팝업은 수정 칸 바로 위에 붙는다. *(2026-11-01 jest 축소로 실화면 전용)*
- `hub-daychip-scroll` 일차가 많아 칩 줄이 넘치면, 고른 일차(또는 오늘이라 처음부터 선택된 일차) 칩이 보이도록 줄이 옆으로 스크롤된다. *(2026-11-01 jest 축소로 실화면 전용)*
- `hub-fit-pins` 허브를 열면(재계획 적용 직후 펼침으로 열 때 포함) 그날 핀이 전부 일차 칩 아래·시트 위 지도 영역에 들어온다. 알약이 숨거나 시트를 움직여도 지도가 다시 맞춰지며 튀지 않는다. *(2026-11-01 jest 축소로 실화면 전용)*
- `hub-large-text` 글자를 가장 크게 키우면 카드 머리 줄이 이름 위·시각(또는 예정 배지) 아래로 쌓이고 이름이 잘리지 않는다. 예정 카드의 아래 버튼 줄은 넘치면 다음 줄로 꺾인다. *(2026-11-01 jest 축소로 실화면 전용)*

## How to get to it (user POV)

- 홈 탭 여행 카드 CTA(여행 중이면 「여행 일정 보기」, 확정·여행 아님이면 「확정 일정 보기」) — 일정이 CONFIRMED 일 때만 허브로 간다. 초안이면 「일정 이어서 짜기」로 다른 화면에 간다.
- 일정 탭(내 여행 목록)의 여행 카드 press — 같은 목적지 판정(CONFIRMED → 허브).
- 재계획 적용 성공·편집기(`planb/manual`) 저장 뒤 자동 복귀.
- 재계획 진입 게이트가 "이미 반영한 대안"·"지금은 해당하지 않는 알림"으로 판정하면 토스트와 함께 허브로 dismissTo(`planb-request` 참고).
- 장소 상세를 콜드 딥링크로 연 뒤 뒤로 — 허브로 replace.
- 딥링크 `trippilot:///trips/<tripId>/live`(선택 `?day=YYYY-MM-DD` — 그 일차로 연다, 일정에 없거나 형식이 틀리면 무시).
- 푸시·알림함에는 허브로 직행하는 actionType 이 없다(`TRIP_ITINERARY` 는 `itinerary?from=notification` 로 간다).

## Driving it with agent-device

Preconditions:

- 소셜 로그인된 계정, 서버 `dev-api`.
- **시작일 = 오늘(KST)인 여행**을 만들고 일정을 생성·확정한다(여행 만들기 → 방식 선택 → 확정). 확정 안 한 초안은 허브로 가지 않는다. 일정 슬롯에 좌표가 있어야 핀·[길찾기]가 선다.
- "여행 시작 전" 분기 확인용으로 시작일 = 내일인 확정 여행 하나를 더 둔다. "여행 후"는 이미 끝난 확정 여행이 있어야 한다 — 과거 날짜로 여행을 새로 만들 수 있는지는 **확인 필요**.
- 내 위치 점을 보려면 l06 위치정보 동의 ON + `xcrun simctl privacy booted grant location com.trippilot.travel` + `xcrun simctl location booted set <오늘 슬롯 근처 lat,lng>`.
- 트리거 알약은 서버가 그 여행에 발화 중 트리거를 가져야 뜬다 — dev-api 에서 트리거를 만드는 방법은 **확인 필요**(없으면 프리뷰 `live-trigger-weather`·`live-risk-sheet` 로 표면만 본다).

- **홈에서 진입.** 홈 여행 카드의 「여행 일정 보기」를 누른다(testID: `home-trip-hero-cta`). 허브 루트(testID: `execution-live-screen`)가 뜨고 시트 헤더(testID: `execution-live-sheet-header`)에 오늘 일차(`· 2일차 ·` 등 — 여행 첫날이면 `· 1일차 ·`)와 `곳`이 보인다.
- **일정 탭에서 진입.** 하단 탭 「일정」(좌표 탭 — `trippilot-sim-qa` §2) → 여행 카드(testID: `my-trip-card-${tripId}`). 같은 허브가 뜬다.
- **일차 전환.** 2일차 칩(testID: `execution-live-daychip-1`)을 누른다. 헤더가 `· 2일차 ·`로 바뀌고 카드 목록(testID: `execution-live-timeline`)이 그날 슬롯으로 바뀐다.
- **여행 전 진입.** 시작일 = 내일인 여행의 허브를 연다. 1일차가 선택돼 있고, 예정 카드에 [도착]이 없으며, `수정` 칸(testID: `execution-live-bar-edit`) → 「AI에게 맡기기」(testID: `execution-live-edit-popup-ai`)가 흐리고 눌러도 이동하지 않는다.
- **지난 날 AI 비활성.** 여행 2일차 이후 날짜에 1일차 칩을 고른 뒤 `수정` → 「AI에게 맡기기」가 비활성이다. 오늘 일차로 돌아오면 다시 활성.
- **수정 팝업 → 직접 수정.** `수정` 칸 → 「직접 수정」(testID: `execution-live-edit-popup-manual`). 편집기(testID: `itinerary-edit-back` 이 있는 화면)가 그 일차로 열리고 안내 「방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요」가 보인다.
- **수정 팝업 → AI.** 오늘 일차에서 `수정` → 「AI에게 맡기기」. 허브 위에 「✦ AI에게 맡길게요」 시트(testID: `planb-request-sheet`)가 겹쳐 뜬다 — 이후는 `planb-request`.
- **팝업 닫힘.** 팝업(testID: `execution-live-edit-popup`)이 열린 채 `일정` 칸(testID: `execution-live-bar-schedule`)을 누르면 팝업이 사라진다.
- **시트 완전 내림·복귀.** 시트를 끝까지 끌어내린다. 카드 목록이 화면에서 사라진다. `일정` 칸을 누르면 시트가 중간 칸으로 올라온다.
- **핀 탭.** 지도 핀을 좌표로 누른다. 시트가 펼침으로 올라간 뒤 해당 카드(testID: `execution-live-slot-row-${slotKey}`)가 보이게 스크롤된다.
- **장소 상세.** 카드 이름(testID: `execution-live-slot-name-${slotKey}`)을 누른다. 장소 상세(testID: `execution-place-detail`)가 뜬다 — `live-place`.
- **길찾기.** 예정 카드의 「길찾기」(testID: `execution-live-slot-directions-${slotKey}`). 외부 지도 앱(또는 웹)이 열린다. 앱 복귀 시 같은 허브다. 둘 다 못 열면 그 카드에 testID: `execution-live-slot-directions-notice-${slotKey}` 「지도를 열 수 없어요.」.
- **챗봇.** `챗봇` 칸(testID: `execution-live-bar-chatbot`). 허브 위에 AI 도우미 시트(입력 「무엇이든 물어보세요…」·칩 「이 일정에 관해 질문하기」)가 겹쳐 뜬다. 우상단 ✕로 닫으면 같은 허브다.
- **트리거 알약 → 위험 상세.** 발화 중 트리거가 있을 때 지도 위 알약(testID: `execution-live-trigger-alternative`, 라벨 testID: `execution-live-trigger-label`)을 누른다. 시트(testID: `planb-risk-sheet`)에 머리 「위험 요소 · 날씨」류(testID: `planb-risk-eyebrow`), 「재계획이 지켜보는 것」이 보인다. 스크림(testID: `planb-risk-scrim`, 라벨 「닫기」)으로 닫힌다.
- **위험 상세 → 대안 보기.** 「대안 보기」(testID: `planb-risk-cta`). 시트가 닫히고 `planb?scope=…&triggerId=…`의 진입 게이트로 간다 — `planb-request`.
- **영향 배지.** 트리거가 가리키는 슬롯의 예정 카드 상태 칸(testID: `execution-live-slot-status-${slotKey}`)이 「예정」 대신 트리거 라벨이다.
- **행사 칸.** 기회가 있는 날 `행사` 칸(testID: `execution-live-bar-event`)을 누른다. 카드(testID: `execution-live-opportunity-card`)가 바 위에 선다. 「넣어서 다시 짜기」(testID: `execution-live-opportunity-cta`) → 자유 입력이 채워진 재계획 요청 시트. 「이 추천 닫기」(testID: `execution-live-opportunity-dismiss`) → 카드가 사라진다. 기회 없는 날엔 칸이 비활성이라 무반응.
- **뒤로.** 바의 뒤로 원을 누른다(접근성 트리에서 바 루트 testID: `execution-live-bottom-bar` 안). 들어온 화면(홈·일정 탭)으로 돌아간다. 딥링크로 연 경우 홈 탭으로 간다.
- **딥링크 + day.** 앱을 종료한 뒤 `xcrun simctl openurl booted "com.trippilot.travel:///trips/<tripId>/live?day=<원하는 일차 날짜>"`. 그 일차 칩이 선택된 채 열린다(콜드 진입에서만 — 아래 Gotchas).
- **일정 없음.** 일정을 만들지 않은 여행 id 로 `trippilot:///trips/<tripId>/live` 를 연다. 「아직 일정이 없어요」(testID: `execution-live-notfound`) + 「일정 만들기」(testID: `execution-live-notfound-create`) → 일정 짜는 방식 선택 화면.
- **없는 여행.** 존재하지 않는 id 로 같은 딥링크. 「페이지를 찾을 수 없어요」(testID: `execution-live-trip-notfound`) + 「홈으로」(testID: `execution-live-notfound-home`).
- **조회 실패.** 허브를 연 뒤 Mac 네트워크를 끊고 재조회를 유도한다. 「일정을 불러오지 못했어요」(testID: `execution-live-error`) + 「다시 시도」(testID: `execution-live-error-retry`)·「뒤로」(testID: `execution-live-error-back`). 첫 조회부터 실패하면 재시도 동안 로딩 면(testID: `execution-live-loading`)에 머문다.

## Gotchas

- **[실화면 전용]** 지도 화면이라 접근성 캡처가 워치독 타임아웃 날 수 있다 — 스크린샷+좌표 탭으로 판정한다(`trippilot-sim-qa` §2). 지도·핀 위치·계획 동선·실제 경로·내 위치 점·시트 실제 칸 이동·유리 블러·팝업/카드가 시트 위에서 실제로 눌리는지는 실화면으로만 확인된다.
- **[실화면 전용]** 시트 칸 번호는 허브만 −1(완전 내림)·0(중간)·1(펼침)이다. 펼침 칸에서만 안쪽 스크롤이 먹으므로 핀 탭 스크롤은 시트가 펼침에 도착한 뒤에 일어난다.
- **[실화면 전용]** 하단 바는 홈 탭 바에서 변신 모션으로 들어온다(허브 연 직후 약 0.3초+ 동안 5칸 복제본은 눌러도 무반응). 입장 직후 바로 뒤로를 누르면 엉뚱한 화면이 닫힐 수 있다 — 허브가 정착한 뒤 조작한다.
- iOS 가장자리 스와이프 뒤로는 허브에서 지도가 먹어 동작하지 않는다(QA 2026-10-21 N-089) — 바의 뒤로 원을 쓴다.
- 메모 시트·위험 상세·반영 시트·위치 '항상' 설명이 떠 있는 동안 하단 바 전체가 사라진다(뒤로 원 포함). 바가 안 보이면 겹친 시트부터 닫는다.
- `${…}` 가 든 testID 는 실행 값으로 채운다. `slotKey` = `YYYY-MM-DD#<poiId>`, 카드 필드는 `execution-live-slot-<필드>-<slotKey>` 꼴이다.
- 확정 일정만 허브로 간다(초안·생성 중은 다른 화면). 홈 CTA 라벨이 「일정 이어서 짜기」면 아직 확정 전이다.
- `수정` 칸은 이동하지 않고 팝업만 여닫는다. 「AI에게 맡기기」가 흐린 이유는 지난 날·여행 전 두 가지다 — 여행 후(마지막 날이 어제 이전)면 오늘이 일정에 없어 마지막 일차도 지난 날이라 비활성이다.
- 트리거 알약은 첫 트리거 하나만 대표로 싣는다. 숨긴 알약은 같은 트리거면 허브를 다시 열 때까지 안 돌아온다.
- 「행사」 칸이 흐린 것은 보는 날 기회가 없다는 뜻이지 고장이 아니다(N-020 판단 필요).
- 시각 표기는 계획값(`startAt`) 그대로라 지난 예정 카드도 「HH:MM 도착 예정」으로 남는다(N-019) — 판정 기준으로 쓰지 않는다.
- 위치정보 동의 토글을 켰다 껐다 반복하지 마라 — 동의 변경은 법정 append-only 로그로 남는다. 필요한 상태로 한 번만 맞춘다.
- 과거 날짜로 여행을 만들 수 있는지(여행 후 분기 재현)는 **확인 필요**.
- dev-api 에 트리거·기회를 만드는 방법은 **확인 필요** — 없으면 `trippilot://_dev/preview?state=live-trigger-weather`·`live-risk-sheet`·`live-hub-opportunity` 로 표면만 보고 "실경로 미검증"으로 남긴다.
- [실화면] 2026-10-31 — `?day=` 는 같은 여행 허브가 이미 떠 있는 상태(웜)에서 딥링크하면 무시되고 보던 일차 그대로다. 콜드 진입에서는 지정 일차로 열린다.
- [실화면] 2026-10-31 — 도우미 시트가 떠 있는 동안 접근성 트리엔 뒤의 허브 노드만 잡힌다. ✕는 좌표(≈360,240)로 누른다.
- [실화면] 2026-10-31 — 지난 일차에 진행 중으로 남은 방문(이전 날 [도착]만 누른 곳)은 그 일차 카드에 [방문 완료]·[사진]·[메모]가 그대로 선다(자동 기록 무장 빌드 관찰). 지난 날 예정 카드엔 [도착] 없이 [길찾기]만 남는다.
- [실화면] 2026-10-31 도달 불가 — `hub-loading`(조회가 1초 안에 끝나 로딩 면을 못 잡음), `hub-error`(Mac 네트워크를 끊으면 조작 세션도 끊겨 재현 불가), `hub-trigger-pill`·`hub-risk-sheet`(제주 여행에 발화 트리거 없음 — 알약 미노출), `hub-opportunity`(보는 날 기회 없음 — `행사` 칸 비활성만 확인), `hub-actual-route`(실제 경로 선을 화면에서 구분 못 함), `hub-directions` 실패 안내(시뮬에선 웹으로 항상 열림).
- 시뮬레이터 `simctl io screenshot`·`terminate`·`launch` 가 사진 선택기 사용 직후 통째로 멈춘 적이 있다(2026-10-31, 1회) — CoreSimulatorService 를 재시작하면 기기가 Shutdown 되니 `simctl boot` → 앱 launch → `agent-device open` 으로 복구한다(로그인은 유지됨).
