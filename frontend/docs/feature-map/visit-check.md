---
id: visit-check
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/live/index.tsx
  - app/trips/[tripId]/records/index.tsx
---

# 방문 체크 (도착·완료·건너뛰기·사진·메모)

여행 당일 허브 카드에서 방문을 기록한다. 예정 카드의 [도착]이 그 장소를 "지금 방문 중"으로 만들고, 다음 예정 카드의 [도착]은 **앞 장소 완료 → 다음 장소 도착**을 한 번에 보낸다. [방문 완료] 단독 버튼은 그날 마지막 장소(뒤에 [도착]이 설 카드가 없을 때)나 자동 기록이 무장된 여행에서만 보인다. 진행 중·완료 카드에는 [사진](사진 보관함에서 골라 첨부, 위치 동의 시 촬영 좌표 포함)·[메모](허브 위 메모 시트, 2000자) 버튼이 붙는다. **허브에는 건너뛰기가 없다** — 건너뛰기는 기록(j01) 화면의 진행 중 방문 카드에서 확인 다이얼로그를 거쳐 하고, 건너뛴 방문은 되돌릴 수 없다. 모든 기록은 낙관적으로 먼저 바뀌고 실패하면 그 카드만 되돌린 뒤 카드 아래 한 줄로 알린다.

## Sub-features

- `visit-arrive-gate` [도착]은 보는 일차 = 오늘(KST) ∧ 그날 방문 기록을 한 번이라도 받았을 때만. 다른 날·여행 전후엔 없다. 위치 권한은 보지 않는다.
- `visit-arrive-first` 진행 중 장소가 없으면 모든 예정 카드에 [도착] → 누른 카드가 「지금 방문 중」(+실제 도착 시각) 카드로.
- `visit-arrive-chain` 진행 중 장소가 있으면 그 뒤 예정 카드(건너뛴 곳 제외)에만 [도착] → 앞 장소가 방문 완료, 누른 장소가 진행 중.
- `visit-complete-last` 그날 마지막 장소가 진행 중이면 [방문 완료] → 완료 카드(「HH:MM 방문」).
- `visit-complete-armed` 자동 기록 무장(ARMED) 여행이면 진행 중 카드에 [방문 완료]가 늘 있다.
- `visit-action-failed` 완료 실패 → 앞(진행 중) 카드에 「방문 완료를 기록하지 못했어요. 다시 눌러 주세요.」, 도착 실패 → 누른 카드에 「도착을 기록하지 못했어요. 다시 눌러 주세요.」. 완료가 실패하면 도착은 보내지 않는다.
- `visit-photo` 진행 중·(방문 id 를 아는) 완료 카드 [사진] → 보관함 선택 → 성공 토스트 「사진을 기록했어요」. 허브 카드엔 사진 썸네일이 생기지 않는다.
- `visit-photo-notice` 선택 실패 안내(그 카드에만): 권한 거부 「사진 접근 권한이 없어 사진을 불러올 수 없어요」, 제한 「사진 접근이 "선택한 사진만"으로 제한돼 있어요. 접근 범위는 설정에서 바꿀 수 있어요」, 자산 번호 없음, 불러오기 실패 「사진을 불러올 수 없어요」. 권한 계열이면 「설정 열기」가 함께. 취소는 무안내. 업로드 실패는 「사진을 기록하지 못했어요. 다시 시도해 주세요」.
- `visit-memo` [메모] → 메모 시트 `{장소명} · 메모` → 입력 → 「저장」 → 시트 닫힘 + 토스트 「메모를 저장했어요」 + 카드 메모 박스. 같은 글이면 요청 없이 닫기만.
- `visit-memo-locked` 첫 서버 메모 조회 중엔 입력이 잠기고 「저장」 비활성. 공백만·저장 중에도 비활성.
- `visit-memo-failed` 저장 실패 → 시트 안 「메모를 저장하지 못했어요. 다시 시도해 주세요.」(시트를 닫은 뒤 실패가 오면 그 카드 아래).
- `visit-skip` 기록(j01)의 진행 중 방문 카드 「건너뛰기」 → 다이얼로그 「이 방문을 건너뛸까요?」 → 「건너뛰기」 → 카드에 「— 건너뜀」. 「취소」는 요청 없음. 실패하면 다이얼로그 안 「건너뛰지 못했어요. 다시 시도해 주세요.」.
- `visit-skipped-in-hub` 건너뛴 장소는 허브에서 다시 「예정」으로 보이지만, 진행 중 장소 뒤의 [도착] 대상과 "마지막 장소" 판정에서 빠진다.

## How to get to it (user POV)

- 허브(`live-hub`의 모든 진입 경로)에서 오늘 일차 카드.
- 자동 기록 빌드에서는 지오펜스 체류로 도착·완료가 자동으로 찍힌다(`live-location`).
- 건너뛰기: 기록 화면(j01) — 기록 탭에서 그 여행 기록으로 들어가거나 딥링크 `trippilot:///trips/<tripId>/records`.
- 프리뷰(표면만): `trippilot://_dev/preview?state=live-hub-manual-arrive` · `live-hub-manual-last-active` · `live-hub-manual-arrive-notice` · `live-hub-done-media` · `live-hub-memo-sheet` · `live-hub-memo-sheet-locked` · `live-hub-memo-saved`.

## Driving it with agent-device

Preconditions:

- **시작일 = 오늘(KST)인 확정 여행**, 오늘 일차 슬롯 3곳 이상(첫 [도착] → 사슬 [도착] → 마지막 [방문 완료]를 한 번에 보려면). 오늘 일차에 방문 기록이 하나도 없는 상태에서 시작한다(다른 기기·이전 QA 기록이 있으면 첫 상태가 다르다).
- 허브가 오늘 일차를 보고 있어야 한다(다른 일차 칩이면 [도착]이 없다). 시뮬레이터 시계는 Mac 시계 — 날짜만 오늘이면 되고 슬롯 시각대는 [도착] 노출에 쓰이지 않는다.
- 사진: 시뮬레이터 보관함에 사진을 넣는다(`xcrun simctl addmedia booted <jpg>` — 2026-10-31 실측에선 이 명령이 멈춰 kill 했다, 보관함이 이미 차 있으면 생략). iOS 26 시뮬에선 [사진]이 권한 창 없이 「사진에 비공개 접근」 선택기를 바로 띄운다(아래 Gotchas).
- 실패 분기는 네트워크 차단(Mac 네트워크 끄기)으로 만든다.

- **첫 도착.** 오늘 일차 첫 예정 카드의 「도착」(testID: `execution-live-slot-arrive-${slotKey}`)을 누른다. 그 카드가 진행 중이 되어 상태줄(testID: `execution-live-slot-time-${slotKey}`)이 「HH:MM 도착 · 지금 방문 중」(응답 전엔 「지금 방문 중」)이고 [사진](testID: `execution-arrive-photo`)·[메모](testID: `execution-arrive-memo`)·「길찾기」가 선다. [방문 완료]는 아직 없다.
- **사슬 도착.** 두 번째 예정 카드의 「도착」을 누른다. 첫 카드가 완료 카드(시각 testID: `execution-live-slot-visit-time-${slotKey}` + 「방문」)로, 두 번째가 진행 중으로 바뀐다. 첫 카드 앞쪽 예정 카드에는 [도착]이 없다.
- **마지막 장소 완료.** 마지막 슬롯까지 사슬 도착한다. 진행 중 카드에 「방문 완료」(testID: `execution-arrive-complete`)가 생긴다. 누르면 완료 카드가 된다.
- **다른 화면에서 재확인.** `trippilot:///trips/<tripId>/records` 를 연다. 같은 날 방문이 완료 체크(testID: `record-visit-check-done-${visitCheckId}`)·진행 중(testID: `record-visit-check-active-${visitCheckId}`)으로 보인다.
- **도착 실패.** 네트워크를 끊고 예정 카드 「도착」. 카드가 잠깐 진행 중으로 바뀌었다가 되돌아오고 그 카드 아래(testID: `execution-live-slot-action-notice-${slotKey}`) 「도착을 기록하지 못했어요. 다시 눌러 주세요.」.
- **완료 실패(사슬).** 진행 중 장소가 있는 채 네트워크를 끊고 다음 카드 「도착」. 앞 카드 아래 「방문 완료를 기록하지 못했어요. 다시 눌러 주세요.」, 누른 카드는 예정 그대로.
- **다른 일차엔 도착 없음.** 다른 일차 칩(testID: `execution-live-daychip-1`)을 누른다. 예정 카드에 「도착」이 없고 흐린 아이콘 3개(testID: `execution-live-slot-disabled-check-${slotKey}`)만 있다.
- **사진 첨부.** 진행 중 카드 [사진](testID: `execution-arrive-photo`) → 보관함에서 한 장 고른다. 토스트(testID: `live-photo-saved-toast`) 「사진을 기록했어요」. 완료 카드는 testID: `execution-live-slot-done-photo-${slotKey}`.
- **사진 권한 거부.** 권한 창에서 거부(또는 설정에서 끔) 뒤 [사진]. 카드 아래 안내(testID: `execution-arrive-photo-notice`) 「사진 접근 권한이 없어 사진을 불러올 수 없어요」 + 「설정 열기」(testID: `execution-arrive-photo-settings`) → iOS 설정 앱.
- **메모 저장.** 진행 중 카드 [메모](testID: `execution-arrive-memo`). 시트(testID: `live-memo-sheet`) 제목(testID: `live-memo-title`) `{장소명} · 메모`, 글자 수(testID: `live-memo-count`) `0/2000`. 입력 상자(testID: `live-memo-box`)를 눌러 글을 넣고 「저장」(testID: `live-memo-save`). 시트가 닫히고 토스트(testID: `live-memo-saved-toast`) 「메모를 저장했어요」, 카드에 메모 박스(testID: `execution-live-slot-memo-${slotKey}`).
- **메모 닫기.** 시트의 ✕(testID: `live-memo-close`, 라벨 「닫기」) 또는 스크림(testID: `live-memo-scrim`). 초안은 버려지고 요청이 없다.
- **메모 실패.** 네트워크를 끊고 「저장」. 시트가 열린 채 안내(testID: `live-memo-notice`) 「메모를 저장하지 못했어요. 다시 시도해 주세요.」.
- **건너뛰기.** 허브에서 [도착]만 누른 진행 중 방문을 기록 화면에서 연다(`trippilot:///trips/<tripId>/records`, 오늘 탭). 그 카드의 「건너뛰기」(testID: `record-visit-skip-${visitCheckId}`) → 다이얼로그(testID: `record-visit-skip-dialog`) 「이 방문을 건너뛸까요?」·「건너뛴 곳은 되돌리거나 완료로 바꿀 수 없어요.」 → 「건너뛰기」(testID: `record-visit-skip-dialog-confirm`). 카드에 「— 건너뜀」(testID: `record-visit-skipped-label-${visitCheckId}`).
- **건너뛰기 취소·실패.** 다이얼로그 「취소」(testID: `record-visit-skip-dialog-cancel`) → 아무 요청 없이 닫힌다. 네트워크를 끊고 확정하면 다이얼로그 안 「건너뛰지 못했어요. 다시 시도해 주세요.」(testID: `record-visit-skip-dialog-error`).
- **건너뛴 뒤 허브.** 허브로 돌아온다. 건너뛴 장소는 「예정」으로 보이지만 진행 중 장소 뒤에 있으면 「도착」이 없다.

## Gotchas

- **[실화면 전용]** 메모 시트(바텀시트) 실제 열림·딤·키보드 밀어 올림·끌어 닫기, 다이얼로그 딤·중앙 정렬·터치 차단은 jest 원리적 사각이다.
- 허브 메모 시트 입력칸은 이제 접근성 트리에 `[text-view] "메모 입력 …"` 로 잡힌다(2026-10-31 실화면). `fill 'role=text-view' …` 는 실패하고 `fill @e<ref>` 는 된다. 키보드가 떠 있으면 첫 탭은 키보드만 닫는다.
- [도착]은 시각이 아니라 날짜(보는 일차 = 오늘)와 방문 기록 수신 여부로 켜진다. 시각을 맞추느라 시간을 쓰지 말고, [도착]이 없으면 일차 칩·방문 기록 로딩부터 본다.
- 허브에 건너뛰기를 찾지 마라 — 도착 전 슬롯엔 서버 레코드가 없어 건너뛸 수 없고, 건너뛰기는 j01 진행 중 카드에만 있다. 건너뛴 방문은 되돌릴 수 없으니 버릴 여행에서만 확정한다.
- 수동 허브에서 [방문 완료]가 안 보이는 건 정상이다 — 다음 장소의 [도착]이 앞 장소를 완료한다. 단독 완료는 마지막 장소·자동 기록 무장에서만.
- 무장 여행의 첫 프레임은 수동 상태라 [방문 완료]가 잠깐 숨을 수 있다(미확인).
- [도착]·[방문 완료]는 처리 중 다른 [도착]을 모두 잠근다 — 빠른 연타 결과를 "무반응 결함"으로 판정하기 전에 응답을 기다린다.
- 허브 [사진]은 카드에 흔적을 남기지 않는다(토스트뿐, N-031). 붙었는지는 기록 화면(j01)에서 확인한다. 스크린샷 자산은 기록 화면에서 못 불러올 수 있다(N-041, 원인 판단 필요).
- 메모 저장 비교 기준은 최신 서버 값이다 — 같은 글이면 요청 0(토스트 없음)이 정상이다.
- 사진 GPS 좌표는 위치정보 동의의 `gpsRecordingOptIn` 이 켜져 있을 때만 실린다. 동의 토글을 반복하지 마라(법정 append-only 로그).
- 허브 카드 testID 의 `${slotKey}`는 실행 값이다(`slotKey` = `YYYY-MM-DD#<poiId>`). 진행 중 카드의 [방문 완료]·[사진]·[메모]만 고정 testID(`execution-arrive-*`)다.
- 기록 화면(j01) 자체의 진입·다른 기능은 기록 레인 파일 소관 — 여기서는 건너뛰기 검증에 필요한 부분만 적었다.
- [실화면] 2026-10-31 — 이 dev build 는 자동 기록이 무장(ARMED)된 상태라 첫 [도착] 직후부터 진행 중 카드에 [방문 완료]가 늘 보였다(`visit-complete-armed`). 수동 허브의 "마지막 장소에만 [방문 완료]"(`visit-complete-last` 의 숨김 조건)는 이 빌드에서 관찰할 수 없다.
- [실화면] 2026-10-31 — [사진] 토스트 「사진을 기록했어요」는 화면 캡처가 느려 못 잡았다. 붙은 것은 j01 카드에 사진 칸(testID: `record-photo-unavailable-<id>`)이 생기는 것으로 확인했고, 그 칸은 「사진을 불러올 수 없어요」로 뜬다(N-041 그대로). 재계획 진행 화면의 방문 행에는 그 사진이 썸네일로 보였다.
- [실화면] 2026-10-31 — 기록 딥링크 `…/records` 는 오늘이 아니라 1일차 탭으로 열린다. 오늘 방문을 보려면 일차 칩(`2일차`)을 누른다.
- [결함 의심 FM-L4-01] 건너뛴 슬롯은 진행 중 방문이 없을 때 허브에서 다시 [도착]이 선다. 누르면 「도착을 기록하지 못했어요. 다시 눌러 주세요.」가 뜨고 몇 번을 눌러도 같다(서버 거절로 보임). 이 안내 줄은 Plan-B 적용 뒤에도 그 카드에 남았다. 진행 중 방문이 생기면 그 앞 슬롯이라 [도착]이 사라진다.
- [실화면] 2026-10-31 도달 불가 — `visit-action-failed` 의 완료 실패·`visit-memo-failed`·건너뛰기 실패(네트워크 차단 불가, 단 도착 실패 문구는 FM-L4-01 로 실측), `visit-photo-notice` 권한 계열(iOS 26 비공개 선택기는 권한을 묻지 않음), `visit-memo-locked`(서버 메모 조회가 너무 빠름).
