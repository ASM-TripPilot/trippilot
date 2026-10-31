---
id: live-location
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/live/location.tsx
---

# 여행 중 위치 (현재 위치·수동 위치·자동 도착)

여행 중 앱이 사용자 위치를 쓰는 세 갈래다. ① **재계획 출발지** — AI 재계획을 요청하는 순간 위치 동의와 단말 권한이 있으면 GPS 를 한 번(최대 5초) 읽어 출발지로 싣고, 못 읽으면 출발지 없이 조용히 진행한다. ② **현재 위치 직접 입력**(i20·i21) — 지도를 움직여 중앙 고정 핀으로 위치를 고르고 「이 위치로 계속」을 누르면 그 좌표를 추정 출발지(MANUAL)로 재계획을 바로 시작한다. 이 화면은 지금 앱 안 진입이 없고 딥링크로만 열린다. ③ **자동 기록(U10)** — 자동 기록 빌드(`TRIPPILOT_LOCATION_AUTOMATION=1`)에서 허브를 열면 '항상' 권한 설명을 거쳐 오늘 슬롯에 지오펜스를 걸고, 진입 체류가 확정되면 도착·완료를 서버에 남긴다. 강등·전송 실패는 허브 시트 위 한 줄 안내로 알린다. 허브의 내 위치 점·실제 경로 겹치기도 같은 동의를 본다.

## Sub-features

- `loc-replan-gps` 재계획 요청([AI가 다시 짜기]) 시 동의 ON·권한 있음·5초 안 측위면 GPS 출발지로, 아니면 출발지 없이(막지 않음). 미래일 재계획은 좌표를 읽지 않는다.
- `loc-manual-face` `?state=manual`(또는 값 없음·모르는 값) → 「위치를 확인할 수 없어 현재 위치를 직접 입력해 주세요」 얼굴.
- `loc-denied-face` `?state=permission-denied` → 「위치 권한이 꺼져 있어 현재 위치를 직접 입력해 주세요」 얼굴.
- `loc-map-anchor` 지도 중심 = 오늘 첫 좌표 슬롯 → 일정 전체 첫 좌표 슬롯 → 서울시청. 일정 조회 중엔 지도 대신 로딩 자리.
- `loc-selected-label` 「선택한 위치」 값 = `{슬롯명} 인근(추정)` 또는 `여행지 기준(추정)`.
- `loc-confirm` 「이 위치로 계속」 → 지도 중심 좌표로 재계획 세션 시작 → 진행 화면(solving)으로 replace.
- `loc-confirm-error` 시작 실패 → 409 면 「여행 기간에만 AI에게 맡길 수 있어요」, 그 밖 「다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요」.
- `loc-skip-inert` 「위치 입력 건너뛰기」·「변경」은 모양만 있고 동작이 없다.
- `loc-my-location` 허브에서 오늘 일차 ∧ 위치정보 동의 ON → 지도에 내 위치 점(OS 권한은 조회만, 묻지 않음).
- `loc-auto-explainer` 자동 기록 빌드 + 동의 ON + 오늘이 여행 날짜 + '항상' 아님 → 허브 위 설명 시트 「앱을 닫아도 방문을 자동으로 기록할까요?」 → [자동 기록 켜기]·[나중에].
- `loc-auto-armed` '항상' 권한이면 설명 없이 무장 — 활성 카드 [방문 완료]가 늘 보인다(`visit-check` 참고).
- `loc-auto-arrive` 무장 상태에서 슬롯 반경 진입 후 체류 → 서버 도착 기록(진입 시각), 11분 체류 후 이탈 → 완료 기록. 허브 카드가 진행 중·완료로 바뀐다.
- `loc-auto-notice` 강등(권한 '사용하는 동안'·꺼짐·정확한 위치 꺼짐·동의 꺼짐·서버 비활성·기기 등록 실패)·경로 만료·전송 실패 → 허브 시트 위 띠 「자동 기록이 꺼졌어요」/「이동 경로 일부를 올리지 못했어요」/「보내지 못한 자동 기록 N건」(+ 필요 시 「설정 열기」).
- `loc-actual-route` 자동 기록 빌드 + 동의 ON + 그날 경로 있음 → 허브 지도에 실제 경로 겹침(토글 없음).

## How to get to it (user POV)

- 재계획 출발지(GPS): 허브 `수정` → 「AI에게 맡기기」 → 「AI가 다시 짜기」, 또는 위험 상세 「대안 보기」·푸시 Plan-B 알림 경로의 같은 버튼(`planb-request`).
- 현재 위치 입력: **딥링크로만** — `trippilot:///trips/<tripId>/live/location?state=manual` · `?state=permission-denied`. 앱 안 어떤 버튼도 이 라우트로 보내지 않는다(GPS 실패도 이 화면으로 오지 않는다).
- 자동 기록 설명·안내·실제 경로: 허브 진입(`live-hub`의 모든 경로)에서만 뜬다. 앱이 홈에 있으면 포그라운드 확정이 미뤄진다.
- 프리뷰(표면만): `trippilot://_dev/preview?state=live-location-manual` · `live-location-denied` · `u10-explainer` · `u10-degrade-notice` · `u10-dropped-notice` · `u10-route-actual`.

## Driving it with agent-device

Preconditions:

- 시작일 = 오늘(KST)인 확정 여행(`live-hub` 전제와 같다). tripId 는 허브 URL 이나 일정 탭 카드에서 얻는다.
- 위치: `xcrun simctl privacy booted grant location com.trippilot.travel`, 좌표 `xcrun simctl location booted set <lat>,<lng>`. 재계획 출발지는 **기기 위치**라 여행 도시 안 좌표를 준다(서울 기본 좌표로 부산 여행을 재계획하면 후보가 서울에서 뽑힌다 — QA 2026-10-21 N-021).
- l06 위치정보 동의는 필요한 값으로 **한 번만** 맞춘다(토글 반복 금지 — 아래 Gotchas).
- 자동 기록 시나리오는 `docs/u10-location-sim.md` §2 의 빌드(prebuild·빌드 둘 다 `TRIPPILOT_LOCATION_AUTOMATION=1`)와 '항상' 권한(`xcrun simctl privacy booted grant location-always com.trippilot.travel`)이 있어야 한다. 플래그 OFF 빌드에선 설명·안내·실제 경로·자동 도착이 전부 없다.

- **수동 얼굴.** `xcrun simctl openurl booted "trippilot:///trips/<tripId>/live/location?state=manual"`. 루트(testID: `live-location-manual`)에 제목 「현재 위치 입력」, 배너 「위치를 확인할 수 없어 현재 위치를 직접 입력해 주세요」, 「선택한 위치」 아래 `{오늘 첫 슬롯명} 인근(추정)`이 보인다. 지도 대신 로딩 자리(testID: `live-location-loading`)가 잠깐 보일 수 있다.
- **권한 거부 얼굴.** `?state=permission-denied` 로 다시 연다. 루트(testID: `live-location-permission-denied`)에 배너 「위치 권한이 꺼져 있어 현재 위치를 직접 입력해 주세요」와 힌트 「현재 위치 대신 일정 속 장소를 기준으로 잡았어요. 핀을 옮겨 직접 지정할 수 있어요」.
- **핀 옮기기.** 지도를 끌어 중앙 핀을 다른 곳에 맞춘다(좌표 스와이프). 화면 문구는 바뀌지 않는다 — 좌표는 확정 때 쓰인다.
- **확정.** 「이 위치로 계속」(testID: `live-location-confirm`). 재계획 진행 화면(testID: `generation-progress-card`, 제목 「AI가 일정을 다시 짜고 있어요」)으로 replace 된다. 요청 시트에서 고른 사유·범위가 남아 있으면 그대로 실린다.
- **확정 실패.** 여행 기간 밖인 확정 여행 id 로 같은 딥링크를 열고 확정한다. 「여행 기간에만 AI에게 맡길 수 있어요」(testID: `live-location-error`)가 버튼 위에 뜨고 화면에 머문다.
- **건너뛰기 무동작.** 「위치 입력 건너뛰기」(testID: `live-location-use-last-visit`)를 누른다. 아무 일도 없다(배선 없음 — 결함 의심으로 기록).
- **GPS 출발지.** 위치를 여행 도시 안으로 맞추고 허브 → 「AI에게 맡기기」 → 「AI가 다시 짜기」. 진행 화면 지도가 그 좌표 근처를 비춘다. 권한을 거부(`xcrun simctl privacy booted revoke location com.trippilot.travel`)하고 같은 요청을 하면 막힘 없이 진행되고 지도가 그날 첫 슬롯을 비춘다.
- **내 위치 점.** 동의 ON·권한 있음 상태로 허브 오늘 일차를 본다. 지도에 파란 점이 뜬다. 다른 일차 칩을 고르면 사라진다.
- **'항상' 설명.** 자동 기록 빌드에서 권한을 '사용하는 동안'으로 두고 허브를 연다. 설명 시트(testID: `location-explainer-root`, 제목 testID: `location-explainer-title`)와 「자동 기록 켜기」(testID: `location-explainer-enable`)·「나중에」(testID: `location-explainer-later`)가 뜨고 하단 바가 숨는다. 「나중에」 → 시트가 닫히고 바가 돌아온다.
- **자동 도착.** '항상' 권한으로 허브를 연 뒤 `scripts/u10-sim-location.sh arrive <오늘 슬롯 lat> <lng>` 를 돌리고 4분 뒤 허브를 다시 앞으로 가져온다. 그 슬롯 카드가 「HH:MM 도착 · 지금 방문 중」이 된다. `complete` 재생 뒤엔 방문 완료 카드(「HH:MM 방문」)가 된다.
- **강등 안내.** 자동 기록 무장 뒤 권한을 '사용하는 동안'으로 바꾸고 포그라운드로 복귀한다. 시트 헤더 위 띠(testID: `execution-live-automation-notice`)에 「자동 기록이 꺼졌어요」 + 사유 줄(testID: `execution-live-automation-notice-detail`) 「위치 권한이 '사용하는 동안'으로 바뀌었어요」 + 「설정 열기」(testID: `execution-live-automation-notice-settings`).

## Gotchas

- **[실화면 전용]** 중앙 고정 핀 위치 고르기·지도 pan·내 위치 점·실제 경로 선·지오펜스 발화는 실화면으로만 확인된다. 지도 화면은 스크린샷+좌표로 판정한다.
- 위치정보 이용 동의(l06) 토글을 켰다 껐다 반복하지 마라 — 동의 변경은 법정 append-only 로그에 남고 앱 역할엔 삭제 권한이 없다. 시나리오마다 필요한 값으로 한 번만 맞춘다.
- `live/location` 은 앱 안 진입이 없다 — 딥링크 결과를 "앱 안 경로 검증"으로 대신 세지 않는다. 재계획 GPS 실패는 이 화면으로 오지 않고 출발지 없이 진행된다.
- 이 화면 머리의 ‹ 는 그림일 뿐 누를 수 없다. 나가려면 iOS 가장자리 스와이프(`trippilot-sim-qa` §2의 스와이프 방법)를 쓴다. 「변경」도 무동작이다.
- 「이 위치로 계속」은 지도를 안 움직였으면 받은 중심(오늘 첫 슬롯) 그대로 보낸다. 요청 시트의 폼 값을 리셋하지 않으므로 앞서 요청 시트에서 고른 사유가 섞여 나갈 수 있다 — 깨끗한 상태가 필요하면 요청 시트를 한 번 열어 초기화한다.
- 재계획 출발지는 기기 위치다. 시뮬 기본 위치(애플 본사·서울)로 다른 도시 여행을 재계획하면 엉뚱한 후보가 붙는다(N-021).
- `xcrun simctl privacy booted reset location` 은 앱을 죽인다 — dev-client URL 로 다시 띄운다(`trippilot-sim-qa` §2).
- 자동 기록은 빌드 시점 플래그다. prebuild 에만 env 를 주면 Info.plist 는 ON, JS 는 OFF 로 갈라진다(`docs/u10-location-sim.md` §2 확인 명령).
- 자동 도착 재생 좌표는 dev-api POI 좌표로 잡는다(로컬 DB 좌표는 id·좌표가 달라 반경 밖) — `trippilot-sim-qa` §2·`docs/u10-location-sim.md`.
- 포그라운드 wake 는 허브에서만 들어간다 — 앱을 홈에 둔 채 "4분 정지했는데 안 뜬다"면 허브를 연다. 자정을 넘기면 무장 리전이 그날 슬롯으로 바뀌어 전날 좌표 재생은 무효다.
- 무장 여행의 첫 프레임은 수동(MANUAL) 상태라 [방문 완료]가 잠깐 숨을 수 있다(미확인).
- 앱 종료 상태 wake·상태바 위치 표시·잠금 상태 wake 는 시뮬레이터로 못 본다 — TestFlight 실기(6-b) 전용.
- `downgrade` 시나리오는 실행 중 앱의 포그라운드 복귀로만 확인됐다 — 콜드 재시작 반영은 **확인 필요**.
- [결함 의심 FM-L4-02] 2026-10-31 실화면 — 머리 ‹(28,90)·「변경」·「위치 입력 건너뛰기」 셋 다 눌러도 무반응이다(`?state=manual`·`?state=permission-denied` 공통). ‹ 는 뒤로 버튼처럼 보이고, 확정 전에 나갈 방법은 iOS 가장자리 스와이프뿐이다(agent-device 로는 못 함 — 앱 재기동으로 빠져나왔다). 「위치 입력 건너뛰기」 아래 설명 「마지막 방문지나 등록 숙소 기준·추정 출발지로 이어져요」는 일어나지 않는 동작을 약속한다.
- [실화면] 2026-10-31 — 앱 안 진입 없음 확인: 허브 「AI에게 맡기기」→「AI가 다시 짜기」는 위치 화면을 거치지 않고 진행 화면으로 바로 간다.
- [실화면] 2026-10-31 — 기간 밖 여행(서울 11/25)으로 열면 「선택한 위치」가 일정 전체 첫 슬롯(`#힘이나는 커피생활 무교점 인근(추정)`)이고, 확정하면 「여행 기간에만 AI에게 맡길 수 있어요」 후 화면에 머문다. 진행 중 여행은 오늘 첫 슬롯(방문 완료여도) `흑돼지거리 인근(추정)`.
- [실화면] 2026-10-31 — 확정 → 진행 화면 → 결과(약 5초 만에 재계획안) → 재계획안에서 「나가기」하면 위치 화면이 아니라 허브로 돌아간다(replace).
- [실화면] 2026-10-31 — 이 dev build 는 자동 기록이 무장된 상태였다(허브 진행 중 카드에 [방문 완료] 상시 — `visit-check`). '항상' 설명 시트는 뜨지 않았다(이미 '항상'으로 보임).
- [실화면] 2026-10-31 도달 불가 — `loc-replan-gps`(출발지 값이 화면에 안 드러나고 서버 로그 접근 없음), `loc-auto-explainer`(권한을 '사용하는 동안'으로 바꾸려면 위치 권한 조작 필요 — 동의 토글 반복 금지 원칙상 미시도), `loc-auto-arrive`(dev-api 좌표·4분 정지 재생 미시도, 오늘 슬롯을 수동으로 다 기록함), `loc-auto-notice`·`loc-actual-route`(강등·경로 데이터 없음).
