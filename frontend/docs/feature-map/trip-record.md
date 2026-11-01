---
id: trip-record
band: j
status: live-verified
live_verified_at: 2026-11-02 (f153fe245)
routes:
  - app/trips/[tripId]/records/index.tsx
  - app/trips/[tripId]/records/summary.tsx
---

# 여행 기록 (방문 기록 j01 · 여행 요약 j04)

방문 기록(j01)은 한 여행의 일차별 방문을 전면 지도 + 바텀시트로 보여 준다. 사용자는 좌상단 일차 칩으로 날을 바꾸고, 도착한 카드에 사진·메모를 붙이고, 방문 시각을 고치거나 건너뛰기를 하고, 오늘 탭에서는 계획 장소를 직접 방문 체크하거나 계획에 없던 곳을 추가한다. 여행 요약(j04)은 끝난 여행의 총 방문·거리·사진과 일차별 하이라이트를 보여 주고, 일차 회고·공유 카드로 이어진다. 두 화면과 회고(j03)는 같은 하단 바(뒤로 + 기록·회고·요약)를 공유한다.

## Sub-features

- `tr-day-switch` 좌상단 일차 칩으로 일차를 바꾼다. 시트 헤더가 `여행명 · N일차 · 날짜 · N곳` 으로 바뀐다(`N곳` = 카드 + 계획 행 수).
- `tr-empty` 그날 방문 기록이 0건이면 `아직 방문 기록이 없어요`.
- `tr-error` 그날 기록 조회 실패면 `기록을 불러오지 못했어요` + `다시 시도`.
- `tr-plan-row` 그날 계획 슬롯 중 방문 기록이 없는 곳은 계획 행(빈 원 + 계획 번호 + 이름)으로 남는다. **오늘 탭에서만** `방문 체크` 버튼이 붙는다.
- `tr-card-status` 방문 카드 상태 원: 도착 전(비활성)·관람 중(누르면 완료)·완료(체크)·건너뜀(상태 라벨 `— 건너뜀`).
- `tr-skip` 도착 전·관람 중 카드의 `건너뛰기` → 확인 다이얼로그(`이 방문을 건너뛸까요?`) → `건너뛰기` 확정. 실패하면 다이얼로그 안에 `건너뛰지 못했어요. 다시 시도해 주세요.`
- `tr-time-edit` 도착한 실 레코드 카드의 `시각 수정` → 방문 시각 수정 시트(도착·완료 시·분 휠). 저장 실패·충돌은 하단 토스트(`방문 시각을 저장하지 못했어요` / `다른 기기에서 먼저 수정됐어요`), 성공은 안내 없음.
- `tr-photo` 도착한 카드의 사진 추가 → 사진 선택기 → 썸네일. 셀 상태: 이 기기 사진·`다른 기기에서 찍은 사진`·`업로드 실패`·`사진을 불러올 수 없어요`. 업로드 실패가 있으면 카드에 `다시 시도` + `메모와 방문 체크는 저장되었어요`.
- `tr-photo-notice` 권한 거부·제한·자산 없음이면 카드 안 안내 + `설정 열기`. 취소는 안내 없음, 미재빌드 빌드는 `사진을 불러올 수 없어요`.
- `tr-memo` 도착한 카드의 메모 입력(`메모를 남겨보세요`). 포커스가 빠지면 저장하고 성공 토스트 `메모를 저장했어요`, 실패면 카드 안 `메모를 저장하지 못했어요. 다시 시도해 주세요.`
- `tr-manual-mode` 기기 위치 권한이 없으면 수동 체크인 모드: GPS 배너(`위치 권한 없음 — 수동 체크인으로 기록해요`) + 지도 배지(`GPS 자동기록 꺼짐`) + 안내문 교체 + 도착 전 카드에 `방문 체크`.
- `tr-stay` 그날 숙소 배정이 있으면 숙소명 + `N일차` 줄.
- `tr-add-visit` 오늘 탭에서만 시트 끝에 `방문 추가`(→ `add-visit` 기능).
- `tr-pin-tap` 지도 번호 핀을 누르면 시트가 최상단 칸으로 올라간 뒤 그 번호 카드/행으로 스크롤한다.
- `tr-bar` 하단 바: `회고` 칸(선택 일차가 오늘 이전·당일일 때만 켜짐)·`요약` 칸(서버 요약 ready 일 때만 켜짐, 아니면 값 `요약 준비 중`)·활성 `기록` 칸(시트가 내려가 있으면 중간 칸으로 되올림)·뒤로. 바는 시트·지도에 덮이지 않고 시트와 함께 움직이지 않는다.
- `sum-pending` 요약 조회 중·`ready:false`·본문 없음이면 `여행 요약을 준비하고 있어요` + `방문 기록 보기`.
- `sum-error` 요약 조회 실패면 `요약을 불러오지 못했어요` + `다시 시도`.
- `sum-default` 요약 준비됨: 여행 제목·총 방문/총 거리(+출처 `근사`/`경로`, 미측정이면 `—`)/총 사진, 이야기 카드(`이번 여행`), 일차 하이라이트 카드.
- `sum-visit-list` 위치 데이터가 하나도 없으면 지도 대신 `위치 기록이 없어 지도를 표시할 수 없어요` + 순서 방문 목록(방문 0곳이면 `기록된 방문 장소가 없어요`).
- `sum-day-reflection` 여행 기간 일차마다 `N일차 회고` 칩 → j03.
- `sum-share` 헤더 `공유` → j06 공유 카드. 캡처 네이티브 모듈이 없는 빌드면 버튼 자체가 없다.
- `tr-sheet-layout` 지도가 화면 전체에 깔리고 시트 본문이 헤더 → 숙소 줄 → 안내문 → 방문 카드 → 계획 행 → 방문 추가 순서로 선다. 수동 체크인 GPS 배너는 헤더 바로 아래, 지도 배지 「GPS 자동기록 꺼짐」은 일차 칩 옆에 서고 누를 수 없다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass(일부 — Gotchas))*
- `tr-keyboard` 메모를 입력하느라 키보드가 떠 있어도 시트 안 버튼(완료·건너뛰기·방문 추가)이 첫 탭에 눌린다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass(일부 — Gotchas))*
- `tr-map` 시트가 열린 채 지도를 손가락으로 확대·이동할 수 있고, 처음엔 그날 핀이 전부 보이게 맞춰진다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `tr-card-rows` 방문 카드는 장소 이름 줄 아래에 도착 시각·「시각 수정」·「건너뛰기」 줄이 따로 서고, 동작이 없는 카드는 이름 줄 하나뿐이다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `tr-memo-limit` 도착 카드 메모 입력은 2000자에서 더 받지 않는다(붙여넣기 포함). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass(일부 — Gotchas))*
- `tr-memo-return` 메모를 쓰고 return(완료)을 한 번 누르면 키보드가 내려가고 저장 토스트 「메모를 저장했어요」가 **한 번만** 뜬다(이중 저장 없음). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `tr-map-markers` 기록 지도 핀은 허브와 같은 상태 핀이다 — 도착하고 건너뛰지 않은 곳은 초록 체크, 나머지는 회색 번호. 사진 썸네일·점선 원·숙소 bed 마커는 그리지 않는다(즉석 방문은 좌표가 없어 핀 없음). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 — 지도 정정)*
- `tr-check-pop` 진행 중 카드를 [완료]하면 체크가 한 번 톡 튀었다 제 크기로 선다. 처음부터 완료인 카드(진입·일차 전환·스크롤)와 동작 줄이기가 켜진 기기에서는 튀지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass(일부 — Gotchas))*

## How to get to it (user POV)

- 기록 탭 캘린더에서 칠한 날짜·범례 줄·진행 중 카드 `오늘 기록 보기` → j01 (`records-tab`).
- 기록 탭 '지난 여행' 카드 → j04.
- 홈 여행 후(여행 완료) 히어로의 `회고 보기` → j01.
- 마이 페이지 지난 여행 행 → j01 (이 섹션은 예정 여행이 0건일 때만 그려진다).
- j03 회고·j04 요약 하단 바 `기록` 칸 → j01(j03 에서는 그 날짜 `?day=` 로).
- j01·j03 하단 바 `요약` 칸 → j04. j04 준비 중 얼굴의 `방문 기록 보기` → j01.
- 알림함 행·푸시 탭: 종류 `TRIP_SUMMARY` → j04.
- 도우미 다음 행동 `OPEN_TRIP_SUMMARY` → j04, `OPEN_REFLECTION`(날짜 없음) → j01.
- 딥링크 `trippilot://trips/<tripId>/records`(선택 `?day=YYYY-MM-DD`), `trippilot://trips/<tripId>/records/summary`. 시뮬레이터에선 `com.trippilot.travel://` 스킴으로 연다.

## Driving it with agent-device

Preconditions:

- 로그인된 계정과 일정이 있는 여행. 상태별 데이터:
  - 오늘 탭 동작(`방문 체크`·`방문 추가`): 오늘이 여행 기간 안이어야 한다. 여행 중 허브(i01)나 계획 행 `방문 체크`로 도착을 1건 이상 만든다.
  - 사진·메모·시각 수정 칸: **서버에 저장된 도착 레코드**(낙관 자리표시자가 아닌 것). 도착 직후 응답이 오기 전 카드엔 칸이 없다.
  - 수동 체크인 모드: 시뮬레이터 설정에서 TripPilot 위치 권한을 `안 함` 으로 바꾸고 화면을 다시 연다(권한은 묻지 않고 조회만 한다).
  - 숙소 줄: 그 일차에 거점 숙소가 배정된 여행.
  - j04 요약 ready: 종료일이 KST 오늘 이전인 여행이 있어야 하고, 서버 스위퍼(기본 10분 주기)가 종료를 찍어야 요약이 생긴다. 스위퍼가 붙기 전에 끝난 여행은 영영 `ready:false` 다(openapi `/trips/{tripId}/summary`). 오늘 끝나는 여행을 만들고 다음 날 확인하거나, 이미 끝난 여행이 있는 계정을 쓴다.
  - j04 위치 없는 목록 얼굴: 요약 `hasLocationData:false` 인 여행(확인 필요: 서버 판정 조건).
- 사진 첨부는 `expo-image-picker`·`expo-media-library` 가 들어간 dev build 여야 한다(재빌드 전 빌드는 조용히 `사진을 불러올 수 없어요`). 공유 버튼은 캡처 3종이 들어간 빌드여야 보인다.
- 조작 절차·셀렉터 함정은 `trippilot-sim-qa` 스킬 §2.

- **j01 진입.** 캘린더에서 칠한 날을 누른다. testID: `record-trip-view` 와 시트 헤더 testID: `record-trip-sheet-header`(`여행명 · N일차 · 날짜 · N곳`)가 보인다. 딥링크 `?day=` 를 주면 그 일차 칩이 선택돼 있다.
- **일차 전환.** 좌상단 칩 testID: `sheet-daychip-{index}`(index=1, 0부터) 을 누르면 칩의 `selected` 가 옮겨 가고 헤더의 `N일차`·날짜가 바뀐다. j01 엔 좌상단 뒤로 칩(`sheet-daychip-back`)이 없다.
- **빈 날.** 방문이 없는 일차에서 testID: `record-trip-empty`(`아직 방문 기록이 없어요`)와 계획 행 testID: `record-trip-plan-row-{slotKey}` 가 보인다.
- **조회 실패.** 네트워크를 끊고 일차를 바꾼다. testID: `record-trip-error`(`기록을 불러오지 못했어요`) → 네트워크 복구 후 testID: `record-trip-error-retry`(`다시 시도`)를 누르면 카드 목록이 돌아온다.
- **계획 행 방문 체크.** 오늘 탭에서 testID: `record-trip-plan-check-{slotKey}`(`방문 체크`)를 누른다. 그 행이 사라지고 같은 장소의 방문 카드 testID: `record-trip-visit-card-{visitCheckId}` 가 생기며, 지도 핀이 번호에서 체크로 바뀐다. 다른 일차 탭엔 이 버튼이 없다.
- **완료.** 관람 중 카드의 상태 원 testID: `record-visit-check-active-{visitCheckId}` 를 누르면 testID: `record-visit-check-done-{visitCheckId}` 로 바뀐다. 도착 전 원 testID: `record-visit-check-upcoming-{visitCheckId}` 는 눌러도 반응이 없다.
- **건너뛰기.** testID: `record-visit-skip-{visitCheckId}`(`건너뛰기`) → 다이얼로그 testID: `record-visit-skip-dialog`(`이 방문을 건너뛸까요?`) → testID: `record-visit-skip-dialog-confirm` 을 누른다. 카드에 testID: `record-visit-skipped-label-{visitCheckId}`(`건너뜀`)·`record-visit-check-skipped-{visitCheckId}` 가 보인다. `record-visit-skip-dialog-cancel` 은 아무것도 바꾸지 않는다.
- **시각 수정.** 도착 카드의 testID: `record-trip-visit-time-edit-{visitCheckId}`(`시각 수정`) → 시트 testID: `record-trip-visit-time-sheet`(`방문 시각 수정`, 장소명 testID: `record-trip-visit-time-place`). 도착 칸 testID: `record-trip-visit-time-arrived`, 완료 칸 testID: `record-trip-visit-time-completed`(완료 전이면 testID: `record-trip-visit-time-completed-pending` `아직 완료 전이에요`). 휠을 돌리고 testID: `record-trip-visit-time-save`(`저장`)를 누르면 카드의 도착 시각(HH:mm, 서울)이 바뀐다. 잘못된 조합이면 testID: `record-trip-visit-time-error`(`입력한 시각이 올바르지 않아요`). testID: `record-trip-visit-time-cancel` 은 그대로 닫는다.
- **시각 저장 실패.** 저장 직전 네트워크를 끊는다. 시트는 닫히고 하단 토스트 testID: `record-trip-visit-time-result` 가 `방문 시각을 저장하지 못했어요` 를 보인다. 토스트를 누르면 사라진다.
- **사진 추가.** 도착 카드 사진 줄 testID: `record-trip-photo-strip` 의 testID: `record-trip-photo-add` 를 누른다 → OS 사진 선택기에서 1장 → 셀 testID: `record-photo-available-{visitPhotoMetaId}`(이미지 testID: `record-photo-thumb-image-{visitPhotoMetaId}`)가 생긴다.
- **사진 권한 거부.** 사진 권한을 거부한 상태에서 사진 추가를 누른다. testID: `record-trip-photo-notice-{visitCheckId}` 가 `사진 접근 권한이 없어 사진을 불러올 수 없어요` 를 보이고, testID: `record-trip-photo-settings`(`설정 열기`)가 OS 설정을 연다. "선택한 사진만" 이면 `사진 접근이 "선택한 사진만"으로 제한돼 있어요. 접근 범위는 설정에서 바꿀 수 있어요`.
- **업로드 실패.** 업로드 중 네트워크를 끊는다. 셀 testID: `record-photo-upload-failed-{localAssetId}`(`업로드 실패`)와 카드 testID: `record-trip-upload-retry-{visitCheckId}`(`다시 시도`) + `메모와 방문 체크는 저장되었어요` 가 보인다. 복구 후 다시 시도하면 실패 셀이 사라진다.
- **메모.** 도착 카드 testID: `record-trip-memo-input`(접근성 라벨 `메모 입력`, placeholder `메모를 남겨보세요`)에 글을 넣고 return(완료)으로 키보드를 내린다. 토스트 testID: `record-trip-memo-saved-toast`(`메모를 저장했어요`). 화면을 나갔다 다시 와도 글이 남아 있는지 본다. 실패면 testID: `record-trip-memo-notice-{visitCheckId}`.
- **수동 체크인 모드.** 위치 권한을 끈 뒤 j01 을 연다. testID: `record-gps-banner`(`위치 권한 없음 — 수동 체크인으로 기록해요`), 지도 배지 testID: `record-map-gps-off`(`GPS 자동기록 꺼짐`), 안내문 `수동 체크인 · 방문한 곳을 직접 선택해 기록해요 (좌표 자동기록 비활성)` 이 보인다. 도착 전 카드의 testID: `record-visit-manual-check-{visitCheckId}`(`방문 체크`)를 누르면 그 카드가 도착 상태가 된다. 권한이 있으면 안내문은 `오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요` 다.
- **숙소 줄.** 숙소 배정 일차에서 testID: `record-trip-attribution-stay` 에 숙소명과 `N일차` 가 보인다.
- **핀 탭.** 지도 번호 핀을 누른다. 시트가 최상단으로 올라간 뒤 같은 번호의 카드(번호 testID: `record-trip-visit-plan-order-{visitCheckId}`) 또는 계획 행(번호 testID: `record-trip-plan-order-{slotKey}`)이 보이게 스크롤된다.
- **하단 바.** testID: `record-trip-bottom-bar{-tab-reflection}`(`회고`)을 누르면 그 일차의 j03 이 열린다(미래 일차면 비활성). testID: `record-trip-bottom-bar{-tab-summary}`(`요약`)는 요약 ready 전엔 비활성·값 `요약 준비 중`. 시트를 끝까지 내린 뒤 testID: `record-trip-bottom-bar{-tab-records}` 를 누르면 시트가 중간 칸으로 되올라온다. testID: `record-trip-bottom-bar{-back}` 은 탭 위에서 열렸으면 기록 탭으로 돌아간다.
- **j04 준비 중.** 요약이 없는 여행을 j04 로 연다. testID: `reflection-summary-pending`(`여행 요약을 준비하고 있어요`) → testID: `reflection-summary-pending-records`(`방문 기록 보기`)를 누르면 j01 이 열린다. 하단 바 `요약` 칸이 활성 상태로 그대로 있다.
- **j04 오류.** 네트워크를 끊고 j04 를 연다. testID: `reflection-summary-error`(`요약을 불러오지 못했어요`) → testID: `reflection-summary-retry`(`다시 시도`).
- **j04 요약.** 끝난 여행으로 연다. 헤더 `여행 요약`, 제목 testID: `reflection-summary-trip-title`, 통계 testID: `reflection-summary-stats` 에 `총 방문`·`총 거리`·`총 사진`. 이야기가 있으면 testID: `reflection-summary-narrative`(`이번 여행`), 일차 카드 testID: `reflection-summary-day-card` 가 일차 수만큼(`N일차`·`N곳`). 위치 자동화 플래그가 켜진 빌드면 일차별 출처 testID: `summary-day-distance-source-{YYYY-MM-DD}`(`· 거리 근사`/`· 거리 경로`).
- **j04 위치 없음.** 위치 없는 여행이면 `위치 기록이 없어 지도를 표시할 수 없어요`, 방문이 있으면 `대신 방문 장소를 순서대로 보여드릴게요` + testID: `reflection-summary-visit-item` 줄들, 없으면 testID: `reflection-summary-visit-empty`(`기록된 방문 장소가 없어요`).
- **j04 → 일차 회고.** testID: `reflection-summary-day-reflection-{N}`(N=1)(`1일차 회고`)을 누르면 1일차 j03 이 열린다.
- **j04 → 공유.** testID: `reflection-summary-share`(`공유`)를 누르면 j06 이 열린다 (`share-card`). 하단 바 testID: `reflection-summary-bottom-bar{-tab-reflection}` 은 여행 중이면 오늘, 끝났으면 마지막 일차 j03 으로 간다.
- **교차 확인.** j01 에서 완료·사진·메모를 바꾼 뒤 j03 회고(그날)와 j04 요약의 방문 수·사진 수를 다시 읽어 맞는지 본다.

## Gotchas

- 바텀시트 실제 칸(닫힘 98·45%·88%)·끝까지 내림(-1)·핀 탭 뒤 스크롤·지도 제스처·키보드가 시트를 밀어 올리는지는 실화면으로만 확인된다. **[실화면 전용]**
- gorhom 시트는 최상단 칸에서만 안쪽 스크롤을 받는다 — 중간 칸에서 목록 끝(`방문 추가`)이 안 보이면 시트를 먼저 끝까지 올린다. **[실화면 전용]**
- 사진 선택기·권한 다이얼로그·`설정 열기` 로 가는 OS 설정은 앱 밖이다. **[실화면 전용]**
- 메모 저장은 blur 하나뿐이다. 키보드가 떠 있는 채 일차 칩을 누르면 메모가 저장 없이 사라질 수 있다(traps-record.md) — 메모 검증은 return 으로 키보드를 먼저 내린 뒤 한다. **[실화면 전용]**
- 키보드가 떠 있는 동안 하단 바는 트리에서 빠진다 — 바 손잡이를 못 찾으면 키보드부터 내린다.
- 하단 바는 처음 마운트될 때 홈 5칸에서 3칸으로 변신하는 모프가 돈다. 그 동안 보이는 `-start-{탭}` 칸은 눌리지 않는 복제본이다 — 모프가 끝난 뒤 `-tab-{탭}` 을 누른다.
- 사진·메모·시각 수정 칸은 서버에 저장된 도착 레코드 카드에만 있다. 방금 체크한 카드는 응답이 와서 낙관 자리표시자가 교체될 때까지 칸이 없다.
- 일차 칩·카드·핀 번호는 그날 계획 슬롯 위치 기준이다. 즉석 방문 카드는 계획 번호가 없고 지도 핀도 없다(좌표가 없다).
- `방문 체크`(계획 행)·`방문 추가` 는 오늘 탭에서만 보인다. 지난 날의 사후 기록은 불가능하다(BE 선행) — 지난 여행으로 이 동작을 검증하려 하지 않는다.
- 사진 썸네일은 서버 URL 이 아니라 이 기기 앨범에서 꺼낸다. 다른 기기·앱 재설치 뒤엔 `다른 기기에서 찍은 사진`/`사진을 불러올 수 없어요` 가 정상이다.
- 여행에 일정이 없거나(404) 일정 조회가 실패하면 일차 칩이 없고 기록 조회도 꺼져, 빈 안내·오류 없이 시트가 비어 보인다(아래 결함 의심). 이 얼굴을 "빈 날"로 판정하지 않는다.
- j04 지도는 요약 계약에 좌표가 없어 늘 그려지지 않는다(`hasLocationData:true` 여도 지도 자리 없음). 지도가 안 보이는 것은 정상이다.
- j04 `공유` 는 캡처 3종 네이티브 모듈이 없는 빌드에서 버튼 자체가 없다 — 재빌드 여부를 먼저 확인한다.
- j04·j03 은 iOS 가장자리 스와이프 뒤로가 꺼져 있다. 뒤로는 하단 바 뒤로 원뿐이다.
- 푸시(`TRIP_SUMMARY`)는 개발 서버에서 발송이 꺼져 있을 수 있다(확인 필요). 알림함 행으로 대신 통과시키지 말고 두 경로를 따로 적는다.
- 여행 요약은 딥링크뿐 아니라 캘린더 지난 여행 카드·알림·도우미로도 온다.
- testID 표기: `a-{x}` 는 `a-` 뒤에 실행 값 x 가 붙은 것이고, `a{-b}` 는 실제 testID `a-b` 다(하단 바·헤더·행 카드). 접근성 트리에서는 합친 값으로 찾는다.
- [실화면] 2026-10-31 `오늘 기록 보기`·`방문 기록 보기`·캘린더 날짜 탭처럼 `?day=` 없이 열면 1일차 탭이 선택된다 — 오늘 탭 동작(`방문 체크`·`방문 추가`)을 보려면 오늘 칩(`sheet-daychip-{index}`)을 먼저 누르거나 `?day=<오늘>` 딥링크로 연다.
- [실화면] 2026-10-31 시트 끌어올리기는 `agent-device swipe` 로는 지도가 끌려가고 시트가 안 움직인다. `agent-device gesture pan 201 521 0 -440 800`(핸들 y≈521에서 천천히)으로 최상단 칸에 올리고, 목록은 `gesture pan 201 700 0 -400 500` 으로 스크롤한다. 오늘 탭 `방문 추가`(접근성 [cell] `방문 추가`)는 testID `record-trip-spontaneous-add` 로도 눌린다.
- [실화면] 2026-10-31 j04 요약 ready 여행: 부산 10.16–10.18(`630cb42a…`, 방문 3·사진 1·`근사`·이야기·일차 카드 2장·`· 거리 근사`)과 강남구 10.26–10.27(`1f6315b0…`, 방문 0 — 위치 없음 박스 + `기록된 방문 장소가 없어요`, 일차 카드 없음). 제주(`86b28ba8…`, 오늘 종료)는 `reflection-summary-pending`(`여행이 끝나면 자동으로 요약을 만들어 드려요`).
- [실화면] 2026-10-31 j04 일차 카드는 방문 수, j03 통계는 생성 시점 집계라 어긋날 수 있다 — 부산 1일차 j04 `· 2곳`·j01 완료 카드 2장인데 j03 은 `방문 1`(위 회고 Gotchas의 생성 1회 규칙과 같은 원인으로 추정).
- [실화면] 2026-10-31 j03·j04·j01 어느 쪽에서든 하단 바 뒤로는 한 번에 기록 탭으로 돌아왔다(중간 기록 화면을 쌓지 않는다). 알림함에서 연 j03 은 알림함으로 돌아왔다.
- [실화면] 2026-10-31 도달 불가 — `tr-error`·`sum-error`(네트워크 차단 수단 없음), `tr-photo`(사진 선택기를 열면 시뮬레이터가 멈춘 이력이 있어 열지 않았다 — 셀 `record-photo-available-…`·`record-photo-unavailable-…`(`사진을 불러올 수 없어요`)만 관찰), `tr-photo-notice`(사진 권한 거부 상태 아님), `tr-manual-mode`(OS 위치 권한 해제는 앱을 죽이고 위치 동의 쪽 부작용이 있어 생략), 오늘 탭 계획 행 `방문 체크`(제주 2일차 슬롯 5곳이 모두 기록돼 계획 행이 없다), `sum-visit-list` 의 방문 목록 줄(위치 없음 + 방문 있음 여행 없음). 진입 중 홈 `회고 보기`(홈이 여행 중 얼굴)·마이 지난 여행 행(예정 여행 4건)·알림 `TRIP_SUMMARY`(알림함에 해당 행 없음)·도우미 다음 행동(대화로 특정 행동을 재현할 수단 없음)은 못 밟았다.
- [실화면] 2026-11-02 메모 2000자 상한은 2010자를 넣어 2000에서 멈추는 것으로 봤다(붙여넣기는 미확인). 키보드가 뜬 채 [완료] 원 첫 탭이 먹고 체크가 톡 튀었다(녹화 프레임). 건너뛰기·방문 추가는 안 눌렀다. GPS 배너·「GPS 자동기록 꺼짐」 배지는 `simctl privacy revoke location` 이 앱 권한 읽기를 바꾸지 못해(sim-qa §2) 못 열었다.
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `tr-error`(`/trips/*/visits/days/*` 500 → `record-trip-error`)·`sum-error`(`/trips/*/summary` 500).
