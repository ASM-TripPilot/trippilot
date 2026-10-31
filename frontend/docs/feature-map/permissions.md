---
id: permissions
band: c
status: live-unreachable
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/permission-location.tsx
  - app/permission-push.tsx
  - app/permission-push.web.tsx
---

# 기존 계정 권한 안내

온보딩을 예전에 마친 계정이 앱을 켜서 홈에 들어올 때, 이 기기에서 위치·알림 OS 권한이 아직 한 번도 묻지 않은(미결정) 상태면 홈보다 먼저 온보딩과 같은 안내 카드를 한 번 보여 준다(재설치 뒤 자동 로그인이 대표 경우). 위치가 미결정이면 위치 카드, 이어서 알림도 미결정이면 알림 카드, 끝은 홈이다. 한 번 안내하면 이 설치에서는 다시 띄우지 않는다.

## Sub-features

- `perm-catchup-trigger` 홈 진입 시 위치(포그라운드)·알림 권한과 "봤음" 표식을 조회해, 미결정이 있고 표식이 없을 때만 카드로 교체한다. 조회가 늦으면 스플래시를 최대 1초 더 붙잡고, 그래도 안 오면 안내 없이 홈.
- `perm-location-card` 위치 미결정 → 위치 카드(`계속` → OS 위치 창). 허용·거부·설정 복귀 모두 다음으로 진행.
- `perm-location-denied` OS 창에서 거부 → `위치 권한이 꺼져 있어요` 프레임(`계속`·`위치 설정 열기`).
- `perm-location-next` 위치 카드를 나갈 때 알림이 여전히 미결정이면 알림 카드, 아니면(또는 조회 실패) 홈 탭.
- `perm-push-card` 위치는 결정됐고 알림만 미결정 → 알림 카드(`계속` → OS 알림 루틴, 기다리지 않고 홈).
- `perm-catchup-once` 카드로 보내기로 한 순간 "봤음" 표식을 남긴다 — 같은 설치에서 다시 안 뜬다.
- `perm-catchup-skip` 신규 가입(이 실행에서 온보딩을 거침)·푸시 탭/딥링크로 홈이 아닌 화면이 맨 위인 경우는 띄우지 않는다.
- `perm-no-back` 두 카드는 iOS 스와이프 뒤로가 꺼져 있다.
- `perm-web` 웹은 안내가 없다(`permission-push` 웹 라우트는 곧장 홈으로).

## How to get to it (user POV)

- 온보딩 완료 계정으로 앱 콜드 스타트(또는 세션 안 재로그인으로 홈 진입) — 위치/알림이 미결정이고 이 설치에서 처음일 때만. 사용자가 누를 버튼으로 들어오는 경로는 없다.
- 위치 카드 `계속` 흐름의 끝에서 알림 카드로 이어진다.
- 딥링크 `trippilot:///permission-location`·`trippilot:///permission-push`(시뮬 `com.trippilot.travel://…`)는 홈 계정에서 열린다(2026-10-31 실측). 딥링크로 연 것은 자동 진입 검증으로 치지 않는다.
- 카드 생김새만은 `onboarding` 기능 파일의 위치·알림 카드와 같다(같은 화면 재사용).

## Driving it with agent-device

Preconditions:

- 온보딩을 마친 계정으로 로그인돼 있다(토큰이 키체인에 있어 재설치 뒤에도 유지된다).
- 미결정 권한 + 표식 없음 상태 만들기: 앱을 지우고 다시 설치한다(문서 폴더의 표식 `install-flag-permission-catchup` 이 지워지고 OS 권한도 미결정이 된다). 또는 위치만 `xcrun simctl privacy booted reset location com.trippilot.travel`(앱이 죽는다) + 시뮬 앱 문서 폴더의 `install-flag-permission-catchup` 삭제.
- 알림 권한은 시뮬에서 초기화가 막힌 기록이 있다 — 알림 카드는 재설치로만 만든다.

- **위치 카드 자동 진입.** 위 조건으로 콜드 스타트한다. 스플래시 뒤 홈이 아니라 testID: `onboarding-location-root` 가 뜨고, testID: `onboarding-location-purpose`·버튼 testID: `onboarding-location-allow`(`계속`)가 보인다
- **위치 허용 → 알림 카드.** `계속` → OS 창 허용. 알림이 미결정이면 testID: `onboarding-push-root` 로 교체된다(아니면 홈 탭)
- **위치 거부.** OS 창에서 거부한다. `위치 권한이 꺼져 있어요` 와 testID: `onboarding-location-continue`(`계속`)·testID: `onboarding-location-settings`(`위치 설정 열기`)가 보인다. `계속` → 알림 카드 또는 홈 탭
- **알림 카드 → 홈.** testID: `onboarding-push-allow`(`계속`)를 누른다. 홈 탭으로 교체되고, 알림이 미결정이면 OS 알림 창이 홈 위에 뜬다
- **알림만 미결정.** 위치는 이미 결정된 상태에서 진입 조건을 만든다. 스플래시 뒤 바로 testID: `onboarding-push-root` 가 뜬다
- **한 번만.** 카드를 지나 홈에 온 뒤 앱을 완전히 종료하고 다시 켠다(권한이 여전히 미결정이어도). 카드 없이 홈이 뜬다
- **결정된 권한.** 위치·알림을 모두 결정한 기기에서 콜드 스타트한다. 카드 없이 홈이 뜬다
- **뒤로 막힘.** 카드에서 왼쪽 가장자리 스와이프를 한다. 카드가 그대로다
- **증거.** 카드 화면과 그 다음 홈 화면을 스크린샷으로, 재시작 뒤 홈 직행도 스크린샷으로 남긴다.

## Gotchas

- **[실화면 전용]** OS 위치·알림 창, 설정 앱 왕복, 스플래시가 최대 1초 더 머무는 체감은 실화면으로만 확인된다.
- **"봤음" 표식은 카드를 보내기로 한 순간 써진다.** 카드가 실제로 안 떴는데(예: 낡은 Metro 번들로 라우트를 못 풂) 표식만 남은 사례가 있다 — 재검증 전에는 표식 파일 `install-flag-permission-catchup` 을 지운다. Metro 는 `repo-traps.md` 작업 관례대로 `--clear` 재기동.
- 위치 카드에서 앱을 종료하면 뒤의 알림 카드는 다음 실행에 뜨지 않는다(표식은 이미 써짐).
- 온보딩에서 iOS "한 번만 허용"을 고른 사람은 다음 콜드 스타트에 OS 상태가 다시 미결정이라 위치 카드를 한 번 더 본다.
- 첫 진입이 3초 잠정 홈이었다가 서버가 로그인 등으로 교정하면 표식만 소진되고 안내는 영영 안 뜰 수 있다 — 오프라인 시작으로 이 기능을 검증하지 않는다.
- 푸시 알림 탭·딥링크로 콜드 스타트해 맨 위 화면이 홈 탭이 아니면 이번 실행은 건너뛴다(표식도 남기지 않음). 진입 검증은 아이콘 탭 콜드 스타트로 한다.
- 신규 가입 흐름(같은 실행에서 온보딩을 거침)에서는 뜨지 않는다 — 기능 안내 뒤 홈으로 가는 것이 정상이다.
- 이 기능의 위치/알림 카드 testID 는 온보딩 카드와 같다(`onboarding-location-*`·`onboarding-push-*`). 어느 경로로 왔는지는 testID 가 아니라 직전 화면(스플래시 vs 닉네임)과 다음 목적지(홈 vs 취향 1/2)로 구분한다.
- [실화면] 2026-10-31 주 경로(미결정 권한 + 표식 없음 콜드 스타트) 도달 불가 — 재설치·권한 초기화는 앱을 죽이고 로그인·위치 기록 상태를 흔들어 하지 않았다. 권한이 모두 결정된 기기의 콜드 스타트는 카드 없이 홈(확인). 딥링크로 위치 카드 `계속` → (알림 결정됨) 홈, 알림 카드 `계속` → 홈, 알림 카드 엣지 스와이프 무반응을 확인했다. `perm-location-denied`·`perm-catchup-once`·`perm-catchup-skip`·`perm-web` 미확인.
