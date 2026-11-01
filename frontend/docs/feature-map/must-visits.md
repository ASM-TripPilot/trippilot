---
id: must-visits
band: h
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/itinerary/must-visits/index.tsx
  - app/trips/[tripId]/itinerary/must-visits/[poiId].tsx
---

# 꼭 갈 곳 (필수 방문지 · 시각 고정)

AI 일정(완전 AI·같이 짜기)을 만들기 직전, 이 여행에 꼭 넣을 장소를 확인한다. 담아 둔 장소 중 고른 곳이 번호 카드와 지도 핀으로 보이고, 카드에서 빼거나 시각을 고정할 수 있다. 시각 고정 화면에서는 "시각 고정" 스위치를 켜고 방문 날짜·시작 시각·체류 시간을 고른다. 0곳이어도 그대로 생성으로 넘어갈 수 있다.

## Sub-features

- `mv-list` 담은 꼭 갈 곳이 번호 카드로 보이고, 좌표가 있는 것만 지도 핀으로 뜬다(연결선 없음).
- `mv-loading` 조회 중이면 지도·카드 자리표시 얼굴, 진행 CTA 잠김.
- `mv-empty` 0곳이면 점선 안내 + [꼭 갈 곳 추가], 진행 CTA는 **열려 있다**(필수 방문지 없이 생성).
- `mv-failed` 조회 실패면 실패 얼굴 + [다시 시도], 앱바에 [건너뛰기]가 생기고 진행 CTA는 잠긴다.
- `mv-remove` 아무 때나(ANYTIME) 카드의 빼기 버튼 → 꼭 갈 곳에서만 빠진다(담은 장소는 그대로).
- `mv-no-coords` 좌표 없는 카드는 보조행이 `위치를 확인할 수 없어요`로 바뀐다.
- `mv-name-missing` 담은 장소에서 이름을 못 찾으면 `이름을 불러오지 못한 곳`.
- `mv-add` [꼭 갈 곳 추가] → 담은 장소 화면의 여행 선택 모드(다른 레인).
- `mv-proceed` [이 구성으로 일정 짜기] → 생성 중 화면. 완전 AI면 `mode=FULLY_AI`, 같이 짜기면 `mode=CO_PLAN`.
- `mv-copick-copy` 같이 짜기 갈래는 안내 문구가 다르다.
- `mvt-open` 카드·시각 칩·연필 → 방문 시각 지정 화면.
- `mvt-toggle` "시각 고정" 스위치 — 꺼짐=아무 때나(값 없이 저장 가능), 켜짐=날짜·시각 필수.
- `mvt-date` 여행 날짜 세그먼트. 하루짜리 여행이면 자동 선택.
- `mvt-start-sheet` 시작 시각 바텀시트(시·분 휠).
- `mvt-dwell` 체류 시간 `짧게`/`보통`/`여유`(기본 보통).
- `mvt-block-reason` 켜고 날짜·시각을 안 고르면 저장 잠김 + 사유 문구.
- `mvt-save` 저장 = 기존 등록 삭제 → 새로 등록(2단계). 성공하면 목록으로 돌아간다.
- `mvt-kept-error` 삭제가 실패하면 항목은 그대로 + 실패 문구.
- `mvt-lost-error` 삭제는 됐는데 등록이 실패하면 "목록에서 빠졌어요" + [다시 시도](등록만 다시).
- `mvt-duplicate` 등록이 409(이미 있음)면 `이미 추가된 곳이에요` 안내, 화면에 남는다.
- `mvt-leave-warning` 고른 값이 있는데 저장 없이 뒤로 → 첫 누름은 경고만, 두 번째에 나간다.
- `mvt-load-failed` 여행·꼭 갈 곳 조회 실패 문구.

## How to get to it (user POV)

- 방식 고르기 화면에서 `완전 AI가 짜기` 또는 `AI와 같이 짜기`(확인 카드 [계속] 포함) → push. 세부는 `itinerary-method.md`.
- 시각 지정 화면은 이 목록의 카드·시각 칩·연필에서만 push된다.
- 딥링크: `/trips/{tripId}/itinerary/must-visits`(같이 짜기는 `?mode=CO_PLAN`), `/trips/{tripId}/itinerary/must-visits/{poiId}`(`poiId` = 꼭 갈 곳의 `sourcePoiId`).
- 꼭 갈 곳을 처음 채우는 길은 여행 만들기 1/4·담은 장소 화면이다 — 여행 만들기·탐색 기능 파일 소관.

## Driving it with agent-device

Preconditions:

- 로그인 상태(게스트면 담은 장소 조회가 안 돌아 이름·사진·핀이 없다).
- 여행에 꼭 갈 곳이 2곳 이상 등록돼 있고, 그 장소들이 담은 장소(♥)에도 있다. 0곳 얼굴은 등록 없는 여행으로 본다.
- 이 화면은 AI를 부르지 않는다. [이 구성으로 일정 짜기]는 생성을 시작하므로 AI 하루 한도를 쓴다(`ai-generate.md`).

- **목록.** 진입하면 앱바 `꼭 갈 곳`, 안내 `AI가 시간·동선을 맞춰 배치해요`, 카드 testID: `itinerary-mustvisit-${sourcePoiId}`가 번호순으로 보인다. 카드마다 칩 `필수`(아무 때나) 또는 `고정`(시각 고정), 이름(testID: `itinerary-mustvisit-name-${sourcePoiId}`), 보조행 `영업시간 맞춰 자동 배치` 또는 `M.D · HH:mm`이 보인다.
- **지도.** 좌표가 있는 카드가 하나라도 있으면 testID: `itinerary-mustvisit-screen-map`이 보이고 핀이 카드 번호와 같다. 핀 사이 선이 없다. 시간·소요 표시가 없다.
- **같이 짜기 안내.** `mode=CO_PLAN`으로 들어오면 안내가 `일정은 이어서 함께 골라요`다.
- **빼기.** 아무 때나 카드의 testID: `itinerary-mustvisit-remove-${sourcePoiId}`(라벨 `꼭 갈 곳에서 빼기`)를 누른다. 재조회 뒤 그 카드가 사라진다. 담은 장소 화면에서 그 장소의 ♥는 그대로인지 한 번 더 확인한다.
- **고정 카드.** 고정 카드에는 빼기 대신 연필 testID: `itinerary-mustvisit-edit-${sourcePoiId}`(라벨 `시각 고치기`)가 있다.
- **0곳.** 등록 없는 여행이면 testID: `itinerary-mustvisit-screen-empty`(`아직 담은 꼭 갈 곳이 없어요`)와 testID: `itinerary-mustvisit-screen-empty-add`(`꼭 갈 곳 추가`)가 보이고, testID: `itinerary-mustvisit-screen-proceed`가 활성이다.
- **추가.** testID: `itinerary-mustvisit-screen-add`(목록 있을 때) 또는 `itinerary-mustvisit-screen-empty-add`를 누른다. 담은 장소 화면이 여행 선택 모드로 열린다.
- **진행.** `itinerary-mustvisit-screen-proceed`(`이 구성으로 일정 짜기`)를 누른다. 생성 중 화면(앱바 `AI 일정 생성`)으로 바뀐다. 이때 스택이 홈까지 걷혀서, 생성 화면에서 뒤로 가면 꼭 갈 곳이 아니라 홈이 나온다.
- **실패 얼굴.** 네트워크를 끊고 진입하면 testID: `itinerary-mustvisit-screen-failed`(`담은 곳을 불러오지 못했어요`)와 testID: `itinerary-mustvisit-screen-retry`(`다시 시도`), 앱바 testID: `itinerary-mustvisit-screen-skip`(`건너뛰기`)가 보이고 진행 CTA는 잠겨 있다. [건너뛰기]는 생성 화면으로 간다.
- **시각 지정 열기.** 카드 본문 또는 testID: `itinerary-mustvisit-timemode-fixed-${sourcePoiId}`(`시간 정해두기`)를 누른다. testID: `itinerary-mustvisit-time-${sourcePoiId}` 화면(앱바 `방문 시각 지정`)이 열린다. `아무 때나` 칩(testID: `itinerary-mustvisit-timemode-anytime-${sourcePoiId}`)은 누를 수 없는 표시다.
- **스위치.** testID: `itinerary-mustvisit-time-toggle`(라벨 `시각 고정`, 접근성 역할 switch)을 누른다. 꺼져 있으면 날짜·시각·체류 칸이 흐리게 잠기고 저장 버튼이 `아무 때나로 두기`, 켜면 `이 시각으로 고정`이다.
- **날짜.** testID: `itinerary-mustvisit-time-date-${date}`(`YYYY-MM-DD`)를 누른다. 고른 칸이 굵게 바뀐다.
- **시작 시각.** testID: `itinerary-mustvisit-time-start-field`(`시각 선택`)를 누른다. testID: `itinerary-mustvisit-time-start-sheet`(제목 `시작 시각`)가 열린다. 시 휠 testID: `itinerary-mustvisit-time-start-wheel-h`, 분 휠 testID: `itinerary-mustvisit-time-start-wheel-m`에서 셀 testID: `itinerary-mustvisit-time-start-option-h-${hour}`·`itinerary-mustvisit-time-start-option-m-${minute}`(둘 다 두 자리, 분은 00~59 **1분 단위** — 예 `option-m-02`)을 누르면 값이 칸에 `HH:mm`으로 들어간다. testID: `itinerary-mustvisit-time-start-close`(`닫기`)로 닫는다.
- **체류.** testID: `itinerary-mustvisit-time-dwell-${key}`(`key` = `SHORT`/`NORMAL`/`LONG`, 라벨 `짧게`/`보통`/`여유`) 중 하나를 누른다.
- **저장 막힘.** 스위치를 켜고 날짜 없이 두면 testID: `itinerary-mustvisit-time-error`에 `방문 날짜를 골라 주세요`, 날짜만 고르면 `시작 시각을 골라 주세요`가 뜨고 testID: `itinerary-mustvisit-time-submit`이 잠긴다.
- **저장.** 다 고르고 `itinerary-mustvisit-time-submit`을 누른다. 목록으로 돌아오고 그 카드가 `고정` 칩·`M.D · HH:mm` 보조행으로 바뀐다.
- **아무 때나로 강등.** 고정 카드를 열어 스위치를 끄고 `아무 때나로 두기`를 누른다. 목록에서 `필수` 칩·`영업시간 맞춰 자동 배치`로 바뀐다.
- **뒤로 경고.** 값을 하나 바꾼 뒤 testID: `itinerary-mustvisit-time-back`을 누른다. 화면에 남고 testID: `itinerary-mustvisit-time-leave-warning`(`저장하지 않았어요. 한 번 더 뒤로 가면 고른 시각이 사라져요`)이 뜬다. 한 번 더 누르면 나간다.
- **저장 실패.** 저장 직전 네트워크를 끊는다. 삭제부터 실패하면 `고정하지 못했어요. 다시 시도해 주세요`(항목 유지), 삭제 후 등록이 실패하면 `고정하지 못해 목록에서 빠졌어요. 다시 시도해 주세요`와 testID: `itinerary-mustvisit-time-retry`(`다시 시도`)가 뜬다.

## Gotchas

- [실화면 전용] 시작 시각 시트의 실제 열림·딤 덮임·휠 스크롤이 시트에 딸려가지 않는지는 실화면으로만 확인된다. 휠은 탭과 스크롤 정지 둘 다 값을 확정하고, 시트는 닫기·딤 탭·핸들 끌기로만 닫힌다(값을 굴리다 멈춰도 안 닫힌다).
- [실화면 전용] 목록 지도는 보기 전용이다(`viewOnly`). 핀 맞춤·카메라는 실화면으로만 확인된다.
- 시각 저장은 원자적이지 않다(삭제 → 등록). 등록이 실패하면 실제로 항목이 서버에서 빠진 상태다 — 재시도 없이 나가면 목록에서 그 카드가 없다. "실패 = 원상태"로 가정하고 다음 단계를 진행하지 않는다.
- 빼기(삭제)가 실패해도 목록에 카드가 하나라도 있으면 **화면에 아무 안내가 없다**(목록 얼굴이 이기고, 실패 표시는 화면이 그리지 않는다). 빼기 결과는 재조회 뒤 카드가 실제로 사라졌는지로 판정한다.
- 고정 → 아무 때나 강등은 목록에서 못 한다 — `아무 때나` 칩은 눌리지 않는 표시다. 시각 지정 화면에서 스위치를 꺼야 한다.
- 시각 지정 화면의 장소 이름·사진은 담은 장소에서 찾는다. 담은 장소에 없는 장소(♥ 해제 등)면 이름이 비어 보일 수 있다 — 확인 필요.
- 시작 시각을 안 고른 채 시트를 열면 휠은 여행의 하루 시작 시각(첫날이면 첫날 시작, 없으면 `09:00`)에 서 있지만 값은 비어 있다. 휠이 서 있는 자리를 "고른 값"으로 보지 않는다.
- 진행 CTA는 스택을 홈까지 걷고 생성 화면을 올린다. 그래서 스와이프 뒤로로 꼭 갈 곳에 돌아올 수 없다(의도).
- [꼭 갈 곳 추가]의 목적지(담은 장소 여행 선택 모드)는 탐색 레인 기능 파일 소관 — 여기서 돌아왔을 때 목록이 갱신되는지 한 번 더 읽어 확인한다.
- [실화면] 2026-10-31 카드 testID `itinerary-mustvisit-${sourcePoiId}` 는 트리에서 접근성 라벨(「N, 필수, 이름, …」)에 가려 안 보이지만 id 탭은 통한다. 보이는 testID는 `itinerary-mustvisit-chip-must-*`·`itinerary-mustvisit-timemode-anytime-*`·`itinerary-mustvisit-image-*` 다.
- [실화면] 2026-10-31 빼기 뒤 [꼭 갈 곳 추가] → 고르기 화면 머리 「담은 곳 5곳 · 1곳 선택됨」으로 ♥ 유지를 확인했고, 다시 골라 [완료]하면 목록이 2곳으로 갱신됐다.
- [실화면] 2026-10-31 도달 불가 — `mv-loading`(순간 상태)·`mv-failed`·`mvt-kept-error`·`mvt-lost-error`·`mvt-load-failed`(네트워크 차단 수단 없음)·`mvt-duplicate`(409 재현 경로 없음)·`mv-no-coords`·`mv-name-missing`(해당 데이터 없음). 뒤로 경고는 첫 누름 경고까지만 보고 두 번째 누름 대신 저장했다.
