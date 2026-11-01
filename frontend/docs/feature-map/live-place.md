---
id: live-place
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/live/place/[poiId].tsx
---

# 여행 중 장소 상세

허브 카드의 장소 이름 `›`를 누르면 그 일정 장소의 상세가 뜬다(Figma i10). 별도 장소 API 가 아니라 **여행 일정 응답의 슬롯**에서 그 `poiId`를 찾아 그린다 — 히어로 사진(대표 1장)·제목·분류, 태그 칩, 정보 카드(영업시간·주소 — 없으면 「미확인」), 「네이버 지도에서 보기」, 1핀 미니맵. 히어로 위 원형 버튼은 뒤로·공유(OS 공유 시트에 장소명+주소)뿐이고 저장 하트는 없다. 이 장소가 일정에 없으면 「장소를 찾을 수 없어요」, 조회가 실패하면 「일정을 불러오지 못했어요」 + [다시 시도]다.

## Sub-features

- `place-loading` 일정 조회 중 → 빈 로딩 면.
- `place-detail` 일정에 있는 poiId → 히어로·태그·정보 카드·미니맵.
- `place-missing-fields` 영업시간·주소가 없으면 「미확인」, 영업시간을 모르면 캡션 「확인 필요」.
- `place-open-naver` 이름·좌표가 있으면 「네이버 지도에서 보기」 → 네이버 지도 앱(없으면 웹). 실패하면 「네이버 지도를 열 수 없어요. 잠시 후 다시 시도해 주세요.」.
- `place-share` 공유 원형 버튼 → OS 공유 시트(`{장소명}` + 줄바꿈 + `{주소}`, 주소 없으면 이름만).
- `place-back` 뒤로 원형 버튼 → 이전 화면, 히스토리가 없으면(콜드 딥링크) 그 여행의 허브로 replace.
- `place-notfound` 일정 어느 날에도 없는 poiId 또는 404 → 「장소를 찾을 수 없어요」·「이 장소는 일정에 없어요」 + 앱바 뒤로.
- `place-error` 404 아닌 조회 실패 → 「일정을 불러오지 못했어요」 + 「다시 시도」(뒤로 버튼 없음).

## How to get to it (user POV)

- 허브(`live-hub`) 카드의 장소 이름 `›` press — 완료·진행 중·예정 카드 모두.
- 딥링크 `trippilot:///trips/<tripId>/live/place/<poiId>` — 오늘이 아닌 날의 슬롯도 열린다(poiId 가 든 첫 일차에서 찾는다).
- 프리뷰(표면만): `trippilot://_dev/preview?state=live-place`.

## Driving it with agent-device

Preconditions:

- 확정 일정이 있는 여행(`live-hub` 전제). poiId 는 허브 카드 testID(`slotKey` = `YYYY-MM-DD#<poiId>`)의 `#` 뒤 값으로 얻는다.
- 공유·네이버 지도 앱 동작은 시뮬레이터에 해당 앱이 없으면 웹/공유 시트로 대신 뜬다.

- **허브에서 진입.** 허브 카드 이름(testID: `execution-live-slot-name-${slotKey}` — 옆에 `chevron`)을 누른다. 상세 루트(testID: `execution-place-detail`)가 뜨고 제목(testID: `execution-place-title`)이 카드 이름과 같다.
- **정보 카드.** 정보 카드(testID: `execution-place-info`)에 「영업시간」 행 값(testID: `execution-place-openhours`, 결측이면 testID: `execution-place-unknown-openhours` 「미확인」)과 「주소」 행(결측이면 testID: `execution-place-unknown-address` 「미확인」)이 있다. 영업시간을 모르면 캡션(testID: `execution-place-hours-caption`) 「확인 필요」.
- **네이버 지도.** 「네이버 지도에서 보기」(testID: `execution-place-open-naver`). 네이버 지도 앱 또는 Safari 가 열린다. 실패하면 안내(testID: `execution-place-opennaver-error`).
- **공유.** 히어로 우상단 공유 원(testID: `execution-place-share`). iOS 공유 시트에 장소명(+주소)이 실린다. 공유 시트를 닫으면 같은 상세다.
- **미니맵.** 좌표가 있으면 미니맵(testID: `execution-place-map`)이 1핀으로 뜬다 — 스크린샷으로 본다.
- **뒤로.** 히어로 좌상단 뒤로 원(testID: `execution-place-back`). 허브(같은 일차·같은 시트 칸)로 돌아간다.
- **콜드 딥링크 뒤로.** 앱을 종료한 뒤 `xcrun simctl openurl booted "trippilot:///trips/<tripId>/live/place/<poiId>"`. 상세가 뜬다. 뒤로 원 → 그 여행 허브(testID: `execution-live-screen`)로 replace 된다.
- **없는 장소.** 같은 딥링크에 일정에 없는 poiId(아무 문자열)를 넣는다. 「장소를 찾을 수 없어요」(testID: `execution-place-notfound`)와 앱바 뒤로(testID: `execution-place-notfound-back`, 라벨 「뒤로」).
- **조회 실패.** 네트워크를 끊고 콜드 딥링크로 연다. 재시도가 끝난 뒤 「일정을 불러오지 못했어요」(testID: `execution-place-error`) + 「다시 시도」(testID: `execution-place-retry`). 네트워크를 살리고 누르면 상세가 뜬다.

## Gotchas

- **[실화면 전용]** 히어로 사진·미니맵 타일·핀 위치는 실화면으로만 확인된다. 네이버 지도 Client ID 가 없는 빌드면 미니맵이 지도 실패 표면으로 접힌다.
- 데이터 출처가 일정 슬롯이라 같은 이름의 탐색 장소 상세(d06)와 사진·영업시간·주소가 다를 수 있다 — 일정이 정보가 빈 중복 POI 를 골랐을 때(QA 2026-10-21 N-018). 탐색 화면 값과 대조해 "틀렸다"로 판정하지 않는다.
- 저장 하트·「이곳의 사진 · 모두 보기 ›」는 의도적으로 없다(사진 뷰어·장소 저장 계약 없음). 사진 섹션은 갤러리 사진이 썸네일 개수 이상일 때만 서는데 운영 응답은 대표 1장뿐이라 사실상 안 뜬다.
- 오류 얼굴엔 뒤로 버튼이 없다 — 「다시 시도」 또는 iOS 가장자리 스와이프로 나간다.
- 딥링크로 연 화면은 스택에 쌓인다(`trippilot-sim-qa` §2). 여러 번 열었으면 하나씩 닫는다.
- [실화면] 2026-10-31 — 「네이버 지도에서 보기」는 시뮬(네이버 앱 없음)에서 Safari `map.naver.com` 이름 검색으로 열리고, 검색 중심이 「서울특별시 중구」로 잡혀 제주 장소도 이름만으로 찾는다(좌표 미전달로 보임 — 판단 필요). 상단 「◀ TripPilot」로 돌아온다.
- [실화면] 2026-10-31 — 주소가 「미확인」인 장소의 공유 시트엔 장소명 한 줄만 실린다.
- [실화면] 2026-10-31 도달 불가 — `place-loading`(너무 짧음), `place-error`(네트워크 차단 불가). `place-open-naver` 실패 안내는 웹 폴백이 늘 열려 재현 불가.
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `place-loading`·`place-error`(장소가 아니라 `/trips/*/itinerary` 를 건다 — `/places/*` 에 걸면 아무 일 없다).
