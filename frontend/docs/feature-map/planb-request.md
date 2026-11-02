---
id: planb-request
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/planb/index.tsx
  - app/trips/[tripId]/planb/manual.tsx
---

# Plan-B 재계획 요청 (AI에게 맡기기 · 직접 수정)

여행 중 일정을 바꾸는 입구 두 개다. **AI에게 맡기기**(i04)는 허브 위에 투명 모달로 겹쳐 뜨는 시트 「✦ AI에게 맡길게요」에서 사유(여러 개)·범위(「지금 이후」/「오늘 전체」, 미래 일차면 「{N}일차 전체」 하나)·지시(여러 개)·자유 입력을 고르고 「AI가 다시 짜기」를 누르면 재계획 세션을 열어 진행 화면으로 넘어간다(이후는 `planb-apply`). 위험 트리거·푸시·알림함에서 `triggerId`를 싣고 들어오면 먼저 **진입 게이트**가 서버에 그 트리거와 미리 준비된 대안을 물어(최대 3초) 준비된 초안·진행 중·이미 반영됨·해당 없음·요청 시트 중 하나로 보낸다. **직접 수정**(i07)은 일정 편집기를 여행 중 모드로 연다 — 방문 완료한 곳은 잠기고 저장하면 허브로 돌아간다.

## Sub-features

- `req-open-manual` 트리거 없이 열면(허브 수정 팝업) 폼이 비워진 채 시트가 뜬다. 기본 범위가 선택돼 있다.
- `req-reasons` 「왜 바꾸나요 · 여러 개 가능」 6칩: 「임시 휴무」·「이동 지연」·「체력 저하」·「예약 마감」·「날씨」·「그냥 바꾸고 싶어요」.
- `req-scope` 「바꿀 범위」 2칩: 「지금 이후」·「오늘 전체」. 미래 일차(`targetDate`)면 「{N}일차 전체」(일차를 모르면 「이 날 전체」) 한 칩으로 고정.
- `req-directives` 「어떻게 바꿀까요 · 지킬 것도 함께」 10칩: 「여유 있게」·「더 채워서」·「실내로」·「시간만 당기기」·「가까운 곳으로」·「맛집 추가」·「숙소 근처에서 끝내기」·「이동 짧게」·「저녁은 그대로」·「야외 피하기」.
- `req-freetext` 「직접 말하기」 자유 입력(자리표시 「예: 저녁은 광안리 야경 보이는 곳으로」). 기회 카드에서 오면 `{장소명} 꼭 넣어서 다시 짜 줘`로 채워져 있다.
- `req-detected-chip` 트리거로 들어오면 사유 맨 앞에 감지 칩(알약과 같은 카피). 그 알림이 **위험**이면 대응 사유가 켜진 채, **주의**면 꺼진 채.
- `req-submit` 「AI가 다시 짜기」 → GPS 출발지 1회 읽기(최대 5초, 실패해도 진행) → 세션 시작 → 진행 화면으로 replace. 대기 중엔 버튼 비활성.
- `req-error-period` 여행 기간 밖(409) → 「여행 기간에만 AI에게 맡길 수 있어요」.
- `req-error-day` 미래 일차 요청이 409 → 「아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요」 + 「닫기」.
- `req-error-generic` 그 밖 실패 → 「다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요」. 형식이 틀린 `targetDate` → 「다시 짤 날짜를 확인하지 못했어요. 일정 화면에서 다시 열어 주세요」(요청 안 보냄).
- `req-close` 스크림 탭·아래로 끌기 → 뒤로(히스토리 없으면 허브로 replace).
- `gate-wait` 트리거 진입 → 반투명 대기 면(접근성 이름 「확인하고 있어요」) 최대 3초.
- `gate-draft` 준비된 대안이 초안(DRAFT)·대안 없음·실패 → 재계획안 화면으로 replace(초안이면 「미리 준비한 대안」 표식).
- `gate-solving` 준비 세션이 수집·계산 중 → 진행 화면으로 replace.
- `gate-applied` 이미 반영됨 → 토스트 「이미 반영한 대안이에요」 + 허브로.
- `gate-inactive` 해당 트리거가 더는 활성 아님 → 토스트 「지금은 해당하지 않는 알림이에요」 + 허브로.
- `gate-request` 준비된 대안 없음·낡음 ∧ 아직 활성 → 요청 시트(위험이면 사유 시드, 주의면 빈 시드).
- `gate-fallback` 조회 실패·3초 초과 → URL 그대로 요청 시트.
- `gate-notfound` 트리거 상세 404 → 「페이지를 찾을 수 없어요」 + 「홈으로」.
- `req-reseeded` 재계획안 「조건 바꿔 다시 짜기」에서 오면 그 세션의 사유·지시·제외로 시드된 요청 시트(게이트를 거치지 않는다).
- `manual-edit` 「직접 수정」 → 일정 편집기(그 일차), 방문 완료 슬롯은 잠김·삽입 불가, 「일정 저장하기」 → 허브로 복귀.
- `planb-cold-close` 재계획 요청 시트를 링크로 바로 열고 닫으면 그 여행의 여행 중 허브로 닫힌다(시트가 남지 않는다). *(TRIP-1685 · 실화면 미검증 — 오케 실기 몫)*

## How to get to it (user POV)

- 허브 `수정` 칸 → 「AI에게 맡기기」(오늘 일차면 `planb`, 미래 일차면 `planb?targetDate=`). 지난 날·여행 전엔 비활성.
- 허브 지도 위 트리거 알약 → 위험 상세 시트 「대안 보기」 → `planb?scope=…&triggerId=…` (게이트).
- 푸시 알림 탭(`actionType: PLANB_REPLAN` + `tripId` + `triggerId`) → `planb?triggerId=` (게이트).
- 알림함(설정 → 알림)의 Plan-B 행 탭 → 같은 경로(게이트).
- 허브 `행사` 카드 「넣어서 다시 짜기」 → `planb?prefill=…&includePoiId=…`(오늘이 아니면 `targetDate` 포함).
- 재계획안 「조건 바꿔 다시 짜기」 → 시드 파라미터가 붙은 `planb`.
- 진행 화면 8분 상한 얼굴에서 입력을 모를 때의 「다시 시도」 → `planb`.
- 직접 수정: 허브 `수정` → 「직접 수정」(`planb/manual?date=`), 재계획안 화면 「직접 수정」.
- 딥링크 `trippilot:///trips/<tripId>/planb`·`…/planb?triggerId=<id>`·`…/planb?targetDate=YYYY-MM-DD`·`…/planb/manual?date=YYYY-MM-DD`.

## Driving it with agent-device

Preconditions:

- **시작일 = 오늘(KST)인 확정 여행**, 오늘 일차가 있고 슬롯이 남아 있다(여행 기간 밖이면 서버 409). 미래 일차 분기는 2일 이상 여행.
- 재계획 출발지가 기기 위치라 `xcrun simctl location booted set <여행 도시 안 lat,lng>`로 맞춘다(`live-location` 참고). 위치 동의가 꺼져 있어도 요청은 나간다(출발지 없음).
- 트리거·준비된 대안 분기는 서버에 그 여행의 트리거가 있어야 한다 — dev-api 에서 트리거·준비 세션을 만드는 방법은 **확인 필요**. 푸시는 `xcrun simctl push <UDID> com.trippilot.travel <파일>`, 데이터는 `"body": {"actionType":"PLANB_REPLAN","tripId":"<id>","triggerId":"<id>"}` 안에 넣는다(`trippilot-sim-qa` §2).

- **허브에서 열기.** 허브 오늘 일차 `수정`(testID: `execution-live-bar-edit`) → 「AI에게 맡기기」(testID: `execution-live-edit-popup-ai`). 시트(testID: `planb-request-sheet`)가 허브 위에 겹쳐 뜨고 범위 칩 「지금 이후」(testID: `planb-request-scope-PARTIAL_SLOTS`)·「오늘 전체」(testID: `planb-request-scope-FULL_DAY`) 중 하나가 선택돼 있다.
- **칩 고르기.** 「체력 저하」(`planb-request-reason-LOW_ENERGY`)·「여유 있게」(`planb-request-directive-RELAX`)를 누른다. 둘 다 선택 상태(접근성 selected)로 바뀌고 다시 누르면 풀린다.
- **자유 입력.** 「직접 말하기」 입력(testID: `planb-request-freetext`)에 `fill`로 한글 문장을 넣는다.
- **제출.** 「AI가 다시 짜기」(testID: `planb-request-submit`). 버튼이 흐려졌다가 진행 화면(testID: `generation-progress-card`)으로 replace 된다. 요청 시트는 replace 로 사라졌으므로 진행 화면에서 나가면(‹ → 이탈 확인 「나가기」) 요청 시트가 아니라 허브로 돌아간다 — 이후 `planb-apply`.
- **닫기.** 시트를 다시 열고 시트 위쪽 어두운 스크림(testID: `planb-request-scrim`, 라벨 「닫기」 — `id=` 로 누르면 화면 중앙=시트 위를 눌러 안 닫힌다, 좌표 y≈120 을 누른다)을 누른다. 허브로 돌아가고 아무 요청도 없다.
- **미래 일차.** 허브에서 내일 일차 칩을 고른 뒤 「AI에게 맡기기」. 범위 칩이 「2일차 전체」류 하나뿐이다. 제출하면 진행 화면 캡션이 「{N}일차 일정 다시 짜는 중」.
- **기간 밖 실패.** 여행 기간이 아닌 확정 여행으로 `trippilot:///trips/<tripId>/planb` 를 열어 제출한다. 오류 줄(testID: `planb-request-error`) 「여행 기간에만 AI에게 맡길 수 있어요」, 시트에 머문다.
- **미래 일차 409.** 일정에 없는 날짜로 `…/planb?targetDate=<날짜>` 를 열어 제출한다. 「아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요」 + 「닫기」(testID: `planb-request-error-close`) → 시트가 닫히고 이전 화면으로(홈에서 딥링크했으면 홈).
- **위험 상세에서 진입.** 허브 알약 → 「대안 보기」(testID: `planb-risk-cta`). 게이트 대기 면(testID: `planb-entry-gate-waiting`, 라벨 「확인하고 있어요」)이 잠깐 뜬 뒤 판정된 화면으로 간다. 요청 시트로 오면 사유 맨 앞에 감지 칩(testID: `planb-request-trigger-chip`).
- **푸시 진입.** 앱을 백그라운드에 두고 위 형식의 푸시를 보낸 뒤 배너를 탭한다. 같은 게이트를 지나 같은 판정 화면으로 간다.
- **이미 반영된 알림.** 이미 대안을 적용한 트리거로 들어간다. 토스트(testID: `planb-entry-gate-applied-toast`) 「이미 반영한 대안이에요」 + 허브.
- **해당 없는 알림.** 해제된 트리거로 들어간다. 토스트(testID: `planb-entry-gate-inactive-toast`) 「지금은 해당하지 않는 알림이에요」 + 허브.
- **없는 알림.** `com.trippilot.travel:///trips/<tripId>/planb?triggerId=00000000-0000-4000-8000-000000000000`(UUID 꼴이어야 한다 — `nonexistent` 같은 문자열은 게이트 폴백으로 요청 시트가 뜬다). 「페이지를 찾을 수 없어요」(testID: `planb-entry-gate-notfound`) + 「홈으로」(testID: `planb-entry-gate-notfound-home`).
- **게이트 폴백.** 네트워크를 끊고 같은 트리거 딥링크를 연다. 3초 뒤 요청 시트가 URL 값 그대로 뜬다(감지 칩 없음 — 목록을 못 받았다).
- **직접 수정.** 허브 `수정` → 「직접 수정」(testID: `execution-live-edit-popup-manual`). 편집기 뒤로(testID: `itinerary-edit-back`)·일차 탭(testID: `itinerary-edit-day-${dayIndex}`)이 있는 화면이 그 일차로 열리고 안내(testID: `itinerary-edit-guide`) 「방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요」. 방문 완료 슬롯 사이엔 삽입 「+」(testID: `itinerary-edit-insert-${index}`)가 없다. 「일정 저장하기」 → 토스트(testID: `itinerary-edit-saved`) + 허브로 복귀, 허브 카드에 바뀐 순서가 보인다.

## Gotchas

- **[실화면 전용]** 요청 시트는 허브 위 `transparentModal`이라 뒤에 허브가 비친다. 시트 실제 열림·끌어 닫기·딤은 실화면으로만 확인된다. 지도+시트 화면 위 중첩 시트는 다음 터치 전까지 안 그려질 수 있다(`trippilot-sim-qa` §2) — 무반응으로 판정하기 전에 `snapshot -i`에 `planb-request-sheet`가 있는지 본다.
- 칩 id 는 접두 `planb-request-reason`·`planb-request-directive` + `-` + 서버 키를 붙인 값이라 `check.mjs` 대조 밖이다(라벨로 교차 확인). 와이어 키: 사유 `TEMP_CLOSED`·`SLOW_MOVE`·`LOW_ENERGY`·`FULLY_BOOKED`·`WEATHER`·`JUST_CHANGE`, 지시 `RELAX`·`FILL_MORE`·`INDOOR`·`EARLIER`·`NEARBY`·`ADD_FOOD`·`END_NEAR_STAY`·`LESS_MOVE`·`KEEP_DINNER`·`AVOID_OUTDOOR`.
- 제출 연타를 하지 마라 — 서버는 새 세션 시작마다 열린 세션을 취소한다. 화면이 잠그지만 연타 검사(`dt.sh`) 결과에 세션 2개가 생겼다면 그 원인부터 본다.
- 재계획 출발지는 기기 위치다 — 시뮬 기본 위치로 다른 도시 여행을 재계획하면 엉뚱한 장소가 붙는다(N-021, critical). 결과 품질을 판정하기 전에 위치부터 맞춘다.
- 감지 칩이 꺼진 채인 것은 알림이 **주의**(CAUTION)일 때 정상이다. 위험일 때만 켜진다.
- 게이트 판정은 결정당 한 번이다 — 같은 화면에서 서버 상태가 바뀌어도 다시 판정하지 않는다. 다른 판정을 보려면 다시 진입한다.
- 푸시 데이터를 최상위 키에 두면 탭해도 이동이 없다 — `body` 안에 넣는다. 콜드 스타트 푸시 탭 라우팅은 **확인 필요**.
- dev-api 에 트리거·준비 세션을 만드는 방법은 **확인 필요** — 없으면 `trippilot://_dev/preview?state=planb-request`·`live-risk-sheet` 로 표면만 보고 게이트 분기는 "실경로 미검증"으로 남긴다.
- 직접 수정 편집기의 드래그·삭제 영역·장소 추가는 일정 편집 레인 파일 소관이다. 여기서는 여행 중 모드(잠금·안내·허브 복귀)만 본다. 편집기를 열 때 dev 콘솔 `measureLayout` 오류가 찍힐 수 있다(N-108).
- 위치정보 동의 토글을 반복하지 마라(법정 append-only 로그).
- [실화면] 2026-10-31 — 「AI가 다시 짜기」 뒤 진행 화면은 약 5초 만에 재계획안으로 바뀌었다(실 AI 성공 2회 + 위치 화면 경유 1회). 「직접 말하기」(「실내 카페 한 곳 넣어 줘」)는 결과에 반영되지 않았다(품질 — 판정 대상 아님).
- [실화면] 2026-10-31 — 형식이 틀린 `targetDate=abc` 로 열면 시트는 오늘용 2칩을 그리고 「오늘 전체」가 미리 선택돼 있다(정상 진입의 기본은 「지금 이후」). 제출하면 「다시 짤 날짜를 확인하지 못했어요…」만 뜨고 요청은 없다.
- [실화면] 2026-10-31 — 직접 수정 편집기는 방문한 슬롯에 「방문 완료」 배지가 붙고 그 사이 「+」가 없다. 시트가 중간 칸이라 안내(testID: `itinerary-edit-guide`)까지 스크롤이 안 됐다(핸들 위 pan 도 무효) — 안내 문구는 이번에 못 봤다. 변경 없이 「일정 저장하기」 → 토스트 「일정을 저장했어요」 + 허브.
- [실화면] 2026-10-31 도달 불가 — 트리거·푸시·알림함 진입과 게이트 분기 `gate-wait`·`gate-draft`·`gate-solving`·`gate-applied`·`gate-inactive`·`gate-request`·`req-detected-chip`(제주 여행에 발화 트리거 없음), `gate-fallback`(네트워크 차단 불가 — 단 비UUID triggerId 로 같은 "URL 그대로 시트" 결과는 봤다), 행사 카드 진입(기회 없음), `req-reseeded`(대안 없음 얼굴을 못 만듦), 미래 일차 정상 제출(오늘이 마지막 날), `req-error-generic`.
