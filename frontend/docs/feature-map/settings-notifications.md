---
id: settings-notifications
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/settings/notifications.tsx
---

# 알림 설정

알림 설정(l02)은 알림 종류 6개(숙소 등록·저장 완료 / 여행 시작 전 / 당일 일정 / 일정 시작 전 / 일정 재계획 / 회고 완료) × 채널 2개(푸시·인앱) 토글 표다. 인앱 열은 언제나 켜고 끌 수 있고, 푸시 열은 기기 알림 권한이 허용일 때만 켜진다. 권한이 없으면 상단에 "기기 설정에서 알림 권한을 허용하세요" 배너가 뜨고, 누르면 OS 권한 창(한 번도 안 물은 경우) 또는 iOS 설정 앱으로 간다.

## Sub-features

- `notif-granted` 권한 허용: 상단 "변경한 알림 설정은 다음 알림부터 바로 반영돼요", 열 머리 "푸시"·"인앱", 하단 "모든 알림을 꺼도 보안·계정 관련 알림은 알림함에 보여요".
- `notif-denied` 권한 거부·미결정: 상단 점선 배너 "기기 설정에서 알림 권한을 허용하세요" + "설정 이동", 푸시 머리 자리에 "권한 필요" 칩, 푸시 토글 전부 꺼짐·비활성, 하단 "푸시를 꺼도 인앱 알림은 알림함에 계속 쌓여요".
- `notif-checking` 권한을 읽는 중: 푸시는 잠기되 거부 배너·칩은 안 보인다(정보 배너 얼굴).
- `notif-toggle` 토글을 누르면 즉시 반대로 바뀌고(낙관), 그 칸 하나만 서버에 보낸다.
- `notif-toggle-fail` 저장 실패면 그 칸만 원래 값으로 돌아간다(안내 문구 없음).
- `notif-open-settings` 배너 → 미결정이면 OS 권한 창, 이미 거부면 iOS 설정 앱.
- `notif-return` 설정 앱에서 돌아오면 권한을 다시 읽어 얼굴을 바꾸고, 처음 허용을 읽으면 기기 토큰을 등록한다.
- `notif-hidden-kinds` 커뮤니티·시스템 종류는 서버가 줘도 표에 없다.

## How to get to it (user POV)

- 설정 → 알림 그룹 testID `settings-nav-notifications`("알림 설정").
- 딥링크 `trippilot:///settings/notifications`.
- 웹에서는 설정에 "알림" 그룹이 없다(푸시 미지원 플랫폼) — 웹은 이 화면에 UI로 못 온다.

## Driving it with agent-device

Preconditions:

- 로그인된 계정, iOS 시뮬레이터. 토글은 되돌릴 수 있는 PATCH다 — 바꾼 칸을 적어 두고 끝에 원래 값으로 되돌린다.
- 허용 얼굴은 앱 알림 권한이 허용, 거부 얼굴은 거부(또는 미결정) 상태가 필요하다. 시뮬 알림 권한 상태를 먼저 확인한다(확인 필요: `xcrun simctl privacy` 가 알림 권한을 다루는지 — sim-qa 스킬은 위치 권한만 적었다).
- 토글을 켜도 실제 푸시 수신은 iOS 푸시 자격·서버 `PUSH_MODE`에 달렸다 — 이 화면 검증은 수신을 증명하지 않는다.

- **진입.** 설정 → testID: `settings-nav-notifications`. 헤더 "알림 설정", testID: `notification-settings-back`.
- **행 6개.** 라벨 "숙소 등록·저장 완료"·"여행 시작 전"·"당일 일정"·"일정 시작 전"·"일정 재계획"·"회고 완료"가 이 순서로. 각 행에 testID: `notification-settings-toggle-push-<kind>`·`notification-settings-toggle-inapp-<kind>`(kind = `STAY`·`TRIP_PRE`·`TRIP_DAY`·`SLOT_PRE`·`PLAN_B`·`REFLECTION`). 접근성 라벨은 "<라벨> 푸시"·"<라벨> 인앱".
- **허용 얼굴.** 권한 허용 상태 → 상단 "변경한 알림 설정은 다음 알림부터 바로 반영돼요", 열 머리 "푸시", 푸시 토글이 활성.
- **거부 얼굴.** 권한 거부 상태 → testID: `notification-settings-permission-banner`("기기 설정에서 알림 권한을 허용하세요"·"설정 이동"), 머리 "권한 필요", 모든 `notification-settings-toggle-push-*` 가 꺼짐·비활성, 하단 "푸시를 꺼도 인앱 알림은 알림함에 계속 쌓여요". 인앱 토글은 여전히 눌린다.
- **인앱 토글.** testID: `notification-settings-toggle-inapp-REFLECTION` 을 누른다 → 즉시 반대 상태. 화면을 나갔다 다시 들어와 같은 상태인지 한 번 더 읽는다. 원래대로 되돌린다.
- **푸시 토글(허용 상태).** testID: `notification-settings-toggle-push-TRIP_DAY` 를 누른다 → 반대 상태, 재진입 후 유지. 되돌린다.
- **배너 → 설정 앱.** 거부 상태에서 testID: `notification-settings-permission-banner` 를 누른다 → 이미 거부면 iOS 설정 앱이 열린다. 거기서 허용하고 앱으로 돌아오면 거부 배너가 정보 배너로, "권한 필요"가 "푸시"로 바뀐다. 미결정 상태면 설정 앱 대신 OS 권한 창이 먼저 뜬다.
- **뒤로.** testID: `notification-settings-back` → 설정.

## Gotchas

- 토글 testID는 `notification-settings-toggle-push-${kind}`·`notification-settings-toggle-inapp-${kind}` 꼴이다.
- 서버 토글 목록을 받기 전·실패면 모든 토글이 **꺼짐으로 그려지고 눌린다** — 오류 표면이 없다. 이때 누르면 실제 값과 무관하게 "켜기" 요청이 나간다(결함 후보). 진입 직후 전부 꺼짐이면 바로 누르지 말고 잠깐 기다려 다시 읽는다.
- 토글 저장 실패는 칸이 조용히 원래 값으로 돌아갈 뿐 문구가 없다 — "눌렀는데 안 바뀐다"는 실패 신호일 수 있다. 다시 읽기로 확인한다.
- 푸시 열은 OS 권한이 허용일 때만 켜진 것으로 **보인다** — 서버의 `pushEnabled`가 참이어도 권한 거부면 꺼져 보인다. 거부 얼굴에서 푸시 값을 서버 값으로 읽지 않는다.
- 권한 창·설정 앱 왕복·복귀 시 재조회(앱 포그라운드 복귀)는 실화면으로만 확인된다. iOS는 권한 창이 닫힐 때도 포그라운드 이벤트가 온다. [실화면 전용]
- 열이 보인다고 푸시가 도는 것이 아니다 — iOS 푸시 자격·`PUSH_MODE`가 꺼져 있으면 실수신은 없다(traps-notification).
- 토글 픽셀(회색·thumb 위치)은 생김새라 실화면 몫이다. [실화면 전용]
- [실화면] 2026-10-31 "조회 전·실패면 전부 꺼짐"(위 결함 후보)은 관찰 불가 — 웜 진입은 캐시로, 콜드 딥링크는 스플래시가 걷히는 첫 관찰부터 이미 서버 값(푸시 `SLOT_PRE`만 꺼짐, 나머지 켜짐)이었다. 실패는 네트워크 차단 없이 만들 수 없었다. 증거 `settings-notifications/02-granted-all.png`.
- [실화면] 2026-10-31 도달 불가 — `notif-denied`·`notif-checking`·`notif-open-settings`·`notif-return`(시뮬 알림 권한이 허용 상태라 거부 얼굴을 못 만든다), `notif-toggle-fail`(실패 유도 수단 없음).
- [실화면] 2026-10-31 [결함 의심 FM-L6-01] 콜드 딥링크로 이 화면을 바로 열면(`simctl terminate` → `simctl openurl com.trippilot.travel://…`) 헤더 뒤로가 무반응이고 엣지 스와이프도 안 먹어 화면에 갇힌다 — 개발 콘솔에 `The action 'GO_BACK' was not handled by any navigator`. 뒤로가 `router.back()` 뿐이라 쌓인 화면이 없으면 갈 곳이 없다. 실측: `settings`·`settings/personalization`·`settings/notifications`·`notifications`. 앱이 떠 있을 때(웜) 딥링크는 정상. 증거 `settings/07-cold-deeplink-back.png`, `settings-preferences/08-pers-cold-back.png`.
