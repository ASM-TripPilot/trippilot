---
id: onboarding
band: c
status: live-unreachable
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/(onboarding)/_layout.tsx
  - app/(onboarding)/index.tsx
  - app/(onboarding)/terms.tsx
  - app/(onboarding)/nickname.tsx
  - app/(onboarding)/location.tsx
  - app/(onboarding)/push.tsx
  - app/(onboarding)/push.web.tsx
  - app/(onboarding)/pref1.tsx
  - app/(onboarding)/pref2.tsx
---

# 온보딩

신규 가입자가 로그인 직후 거치는 한 줄 흐름이다: 약관 동의(필수 3종) → 닉네임 → 위치 권한 안내 카드 → 알림 권한 안내 카드 → 취향 1/2(스타일·페이스) → 취향 2/2(동행·활동·음식·이동). 취향 단계의 `완료` 또는 `나중에 설정하고 시작` 이 서버에 온보딩 완료를 알리고, 게이트가 홈을 연 뒤 기능 안내 6장(`feature-tour`)으로 간다. 중간에 앱을 끄고 다시 켜면 서버에 저장된 진행 상태(약관 동의·닉네임·취향)로 남은 첫 단계부터 다시 시작한다.

## Sub-features

- `onb-entry-resume` 진입 시 서버 3개 조회(동의·프로필·취향)로 첫 미완 단계를 고른다: 약관 미완 → `terms`, 닉네임 없음 → `nickname`, 취향 미저장 → `location`, 셋 다 끝 → `pref2`. 판정 전엔 빈 화면.
- `onb-terms-list` 필수 3종(`서비스 이용약관`·`개인정보 수집·이용`·`위치기반서비스`) 체크 행 + `약관 전체 동의`.
- `onb-terms-missing` 필수 미체크로 `다음` 을 누르면 `아직 동의하지 않은 필수 항목이에요` + 빠진 항목 이름(첫 진입엔 숨김).
- `onb-terms-view` 행의 `보기` → 약관 열람 화면.
- `onb-terms-save-error` 동의 저장 실패 → `동의 저장에 실패했어요. 다시 시도해 주세요.` + `다시 시도`, 화면에 머문다.
- `onb-nickname-prefill` 서버 추천 닉네임 1개로 입력칸이 미리 채워진다. 새로고침 아이콘으로 다른 추천을 받는다.
- `onb-nickname-format` 2자 미만 `닉네임은 2자 이상이어야 해요`, 20자 초과 `닉네임은 20자까지 쓸 수 있어요`, 형식 미달이면 `다음` 비활성.
- `onb-nickname-rejected` 서버가 중복/금칙어로 거절 → `이미 사용 중인 닉네임이에요` / `사용할 수 없는 닉네임이에요` + 대체 후보 칩.
- `onb-nickname-save-error` 검사·저장 실패 → `저장에 실패했어요. 다시 시도해 주세요`.
- `onb-location-allow` 위치 카드 `계속` → OS 위치 권한 창 1회 → 허용이면 알림 카드로.
- `onb-location-denied` 거부(또는 이미 "다시 묻지 않음" 거부 상태로 진입) → `위치 권한이 꺼져 있어요` 프레임(`계속`·`위치 설정 열기`). 거부해도 온보딩은 계속된다.
- `onb-location-settings-return` 거부 프레임에서 설정 앱으로 가서 위치를 켜고 돌아오면 다시 조회해 자동으로 알림 카드로 간다.
- `onb-push-card` 알림 카드 `계속` → OS 알림 권한 루틴을 띄우고 기다리지 않고 취향 1/2 로 간다(건너뛰기 버튼 없음). 웹은 이 카드를 건너뛴다.
- `onb-pref1` 여행 스타일 7종 다중 선택 + 페이스 3종 단일 선택, `다음` → 2/2(push 라 뒤로 오면 1/2).
- `onb-pref2` 동행 6·활동 8·음식 5·이동 5종 선택, `완료` → 취향 저장(고른 게 있을 때만) + 온보딩 완료 → 기능 안내.
- `onb-pref-skip` 1/2·2/2 상단 `나중에 설정하고 시작` → 취향 저장 없이 온보딩 완료 → 기능 안내.
- `onb-pref-complete-error` 온보딩 완료 호출 실패 → `시작하지 못했어요. 다시 시도해 주세요`, 다시 탭하면 재시도.
- `onb-press-guard` 카드끼리 같은 자리 버튼의 연타 두 번째 탭이 다음 화면 버튼을 대신 누르지 않는다(400ms 창).

## How to get to it (user POV)

- 신규 계정 로그인 성공 → 게이트가 온보딩 묶음을 열고 첫 미완 단계로 간다(`login` 기능 파일).
- 온보딩 도중 앱 재시작 → 스플래시 뒤 남은 첫 단계로 재진입.
- 단계 간 이동: 약관 `다음` → 닉네임 → `다음` → 위치 → `계속` → 알림 → `계속` → 취향 1/2 → `다음` → 2/2. 취향 2/2 에서 iOS 엣지 스와이프 뒤로 → 1/2.
- 온보딩을 마친 계정에겐 이 묶음이 잠긴다 — 딥링크 `com.trippilot.travel://nickname`·`terms`·`pref1` 은 아무 일도 없이 지금 화면에 머문다(2026-10-31 실측). 같은 위치·알림 카드는 기존 계정용 `permissions` 기능 파일에서 재사용된다.
- 개발 프리뷰(정적, 실제 저장 없음): `trippilot://_dev/preview?state=` + `onboarding-terms-default`·`onboarding-nickname-default`·`onboarding-location-default`·`onboarding-location-denied`·`onboarding-push-default`·`pref1`·`pref2`·`pref1-complete-error`·`pref2-complete-error`.

## Driving it with agent-device

Preconditions:

- **온보딩을 마치지 않은 신규 계정**으로 로그인돼 있다. 신규 계정은 사람의 소셜 로그인으로만 만들 수 있다(`login`). 계정 삭제로 되돌리는 것은 비가역이라 실행 금지.
- 위치 카드의 OS 창은 그 앱 설치에서 위치 권한이 미결정일 때만 뜬다(`xcrun simctl privacy booted reset location com.trippilot.travel` — 앱이 죽으니 다시 띄운다). 알림 권한은 시뮬에서 초기화가 막힌 기록이 있다.
- 서버가 동의·닉네임·취향을 저장하므로 한 계정으로 각 단계는 사실상 한 번씩만 지날 수 있다. 실패 분기(저장 실패)는 네트워크를 끊어 유도한다.

- **진입 판정.** 신규 계정 로그인 직후 testID: `onboarding-terms-root` 가 뜬다. 약관까지 마친 계정을 재시작하면 testID: `onboarding-nickname-root`, 닉네임까지 마쳤으면 testID: `onboarding-location-root` 로 바로 간다
- **약관 — 목록.** 헤더 `약관 동의`, 제목 `서비스 이용을 위해` / `약관에 동의해 주세요`, testID: `onboarding-terms-agreeall`(`약관 전체 동의`)과 행 testID: `onboarding-terms-TERMS_OF_SERVICE`·`onboarding-terms-PRIVACY_POLICY`·`onboarding-terms-LOCATION_TERMS`(각 `필수` 배지)가 보인다. 진입 직후 미동의 안내는 없다
- **약관 — 미체크 다음.** 아무것도 체크하지 않고 testID: `onboarding-terms-next`(`다음`, 흐림)를 누른다. `아직 동의하지 않은 필수 항목이에요` 와 testID: `onboarding-terms-missing` 에 `서비스 이용약관, 개인정보 수집·이용, 위치기반서비스` 가 보이고 화면에 머문다
- **약관 — 보기.** testID: `onboarding-terms-view-PRIVACY_POLICY`(라벨 `개인정보 수집·이용 보기`)를 누른다. 약관 열람 화면이 push 로 열린다. 뒤로 오면 체크 상태가 남아 있다
- **약관 — 전체 동의.** testID: `onboarding-terms-agreeall` 을 누른다. 세 행이 모두 체크(접근성 checked)되고 `다음` 이 활성된다. 다시 누르면 전부 풀린다
- **약관 — 저장.** 전부 체크하고 `다음` 을 누른다. testID: `onboarding-nickname-root` 로 교체된다. 저장 실패 시 testID: `onboarding-terms-error`(`동의 저장에 실패했어요. 다시 시도해 주세요.`)와 testID: `onboarding-terms-retry`(`다시 시도`)가 뜬다
- **닉네임 — 프리필.** 헤더 `닉네임 설정`, 제목 `닉네임을 정해 주세요`, `2~20자로 입력할 수 있어요`. testID: `onboarding-nickname-input` 에 서버 추천 값이 들어 있고 testID: `onboarding-nickname-helper`(`나중에 설정에서 바꿀 수 있어요`)가 보인다
- **닉네임 — 새로고침.** testID: `onboarding-nickname-regenerate` 를 누른다. 입력값이 다른 추천으로 바뀐다
- **닉네임 — 형식.** 입력칸을 비우고 한 글자를 `fill` 한다. testID: `onboarding-nickname-error` 에 `닉네임은 2자 이상이어야 해요` 가 뜨고 testID: `onboarding-nickname-next` 가 비활성이다. 21자를 넣으면 `닉네임은 20자까지 쓸 수 있어요`
- **닉네임 — 서버 거절.** 이미 쓰이는 닉네임을 넣고 `다음` 을 누른다. testID: `onboarding-nickname-error` 에 `이미 사용 중인 닉네임이에요`(금칙어면 `사용할 수 없는 닉네임이에요`)와 testID: `onboarding-nickname-suggestions` 안 칩 testID: `onboarding-nickname-suggest-0` … 이 뜬다. 칩을 누르면 그 값이 입력된다
- **닉네임 — 저장.** 유효한 값으로 testID: `onboarding-nickname-next`(`다음`) 또는 키보드 return 을 누른다. testID: `onboarding-location-root` 로 교체된다. 다른 화면 확인: 온보딩 뒤 마이·설정의 닉네임이 이 값이다
- **위치 — 기본 카드.** 제목 `현재 위치를 켜면` / `여행이 더 똑똑해져요`, testID: `onboarding-location-purpose`(`내 주변을 알면 더 잘 맞는 곳을 추천하고` / `길 안내도 막힘없이 이어져요`), 버튼 testID: `onboarding-location-allow`(`계속`) 하나뿐이다
- **위치 — 허용.** `계속` 을 누르고 OS 창에서 허용한다. testID: `onboarding-push-root` 로 교체된다
- **위치 — 거부.** OS 창에서 `허용 안 함` 을 고른다. `위치 권한이 꺼져 있어요`, testID: `onboarding-location-denied-body`, testID: `onboarding-location-continue`(`계속`), testID: `onboarding-location-settings`(`위치 설정 열기`)가 보인다. `계속` → testID: `onboarding-push-root`
- **위치 — 설정 복귀.** 거부 프레임에서 `위치 설정 열기` → 설정 앱에서 TripPilot 위치를 허용 → 앱으로 돌아온다. 탭 없이 testID: `onboarding-push-root` 로 넘어간다
- **알림 카드.** 제목 `알림을 켜면 여행 중 변화를` / `바로 알 수 있어요`, testID: `onboarding-push-purpose`, `알림은 언제든 설정에서 끌 수 있어요`, 버튼 testID: `onboarding-push-allow`(`계속`) 하나뿐이다. 누르면 testID: `onboarding-pref1-root` 로 가고, 알림 권한이 미결정이면 OS 알림 창이 취향 1/2 위에 뜬다
- **취향 1/2.** `1 / 2`, 제목 `어떤 여행을 좋아하세요?`. 스타일 testID: `onboarding-pref1-style-rest`(`휴양`)·testID: `onboarding-pref1-style-gourmet`(`미식`)·testID: `onboarding-pref1-style-nature`(`자연`)·testID: `onboarding-pref1-style-art`(`문화예술`)·testID: `onboarding-pref1-style-activity`(`액티비티`)·testID: `onboarding-pref1-style-sightseeing`(`관광`)·testID: `onboarding-pref1-style-shopping`(`쇼핑`), 페이스 testID: `onboarding-pref1-pace-relaxed`(`느긋`)·testID: `onboarding-pref1-pace-balanced`(`균형`)·testID: `onboarding-pref1-pace-packed`(`빡빡`). 누르면 접근성 selected 가 바뀐다. testID: `onboarding-pref1-next`(`다음`) → testID: `onboarding-pref2-root`
- **취향 2/2.** `2 / 2`, 제목 `조금만 더 알려주세요`. 동행 testID: `onboarding-pref2-companion-solo`(`혼자`)·testID: `onboarding-pref2-companion-couple`(`커플`)·testID: `onboarding-pref2-companion-friends`(`친구`)·testID: `onboarding-pref2-companion-family`(`가족`)·testID: `onboarding-pref2-companion-parents`(`부모님`)·testID: `onboarding-pref2-companion-pet`(`반려동물`), 활동 testID: `onboarding-pref2-activity-nature`(`자연`)·testID: `onboarding-pref2-activity-history`(`역사문화`)·testID: `onboarding-pref2-activity-themepark`(`테마파크`)·testID: `onboarding-pref2-activity-foodtour`(`맛집투어`)·testID: `onboarding-pref2-activity-cafe`(`카페`)·testID: `onboarding-pref2-activity-exhibition`(`전시`)·testID: `onboarding-pref2-activity-nightview`(`야경`)·testID: `onboarding-pref2-activity-shopping`(`쇼핑`), 음식 testID: `onboarding-pref2-food-korean`(`한식`)·testID: `onboarding-pref2-food-western`(`양식`)·testID: `onboarding-pref2-food-japanese`(`일식`)·testID: `onboarding-pref2-food-chinese`(`중식`)·testID: `onboarding-pref2-food-asian`(`아시안`), 이동 testID: `onboarding-pref2-transport-walk`(`도보`)·testID: `onboarding-pref2-transport-transit`(`대중교통`)·testID: `onboarding-pref2-transport-rental`(`렌터카`)·testID: `onboarding-pref2-transport-taxi`(`택시`)·testID: `onboarding-pref2-transport-bike`(`자전거`). 누르면 접근성 selected 가 바뀐다
- **완료.** 몇 개 고르고 testID: `onboarding-pref2-done`(`완료`)을 누른다. testID: `onboarding-tour-page-1` 이 뜬다(`feature-tour`). 다른 화면 확인: 기능 안내를 마친 뒤 설정의 여행 취향에 고른 값이 보인다
- **나중에 설정하고 시작.** 1/2 의 testID: `onboarding-pref1-skip-top` 또는 2/2 의 testID: `onboarding-pref2-skip-top`(`나중에 설정하고 시작`)을 누른다. 취향 저장 없이 기능 안내로 간다
- **완료 실패.** 네트워크를 끊고 `완료` 를 누른다. testID: `onboarding-pref2-complete-error`(1/2 는 testID: `onboarding-pref1-complete-error`)에 `시작하지 못했어요. 다시 시도해 주세요` 가 보이고 머문다. 네트워크를 되살려 다시 누르면 진행된다
- **연타.** 1/2 `다음` 을 빠르게 두 번 누른다. 2/2 가 실제로 보여야 한다(두 번째 탭이 `완료` 를 누르면 결함). 위치 `계속` 연타도 알림 카드를 보여야 한다

## Gotchas

- 이 흐름은 신규 계정 1개당 사실상 한 번이다 — 화면을 놓치면 같은 계정으로 다시 못 본다. 각 단계 첫 화면을 바로 `snapshot -i` + 스크린샷으로 남긴다.
- **[실화면 전용]** OS 위치·알림 권한 창, 설정 앱 왕복, 알림 창이 취향 1/2 위에 뜨는 모양, 닉네임 화면에서 키보드가 `다음` 버튼을 밀어 올리는지, 위치 레이더·알림 벨 그림은 실화면으로만 확인된다.
- 닉네임 화면의 `사용 가능한 닉네임이에요`(testID: `onboarding-nickname-available`)는 실제 앱에서 뜨지 않는다 — 컨테이너가 그 상태를 넘기지 않는다. 안 보인다고 결함으로 보고하지 않는다.
- 금칙어 판정은 서버 몫이다. 욕설 닉네임이 그대로 통과한 기록이 여러 번 있다(2026-10-16 Q-014, 2026-10-21 N-084).
- 약관 목록 라벨(`개인정보 수집·이용`·`위치기반서비스`)과 열람 화면 제목(`개인정보 처리방침`·`위치정보 이용약관`)이 다르다 — 의도된 두 체계다.
- 약관 목록 조회(`/terms`)가 실패하면 행이 0개인 채 오류·재시도 없이 멈춘다. 행이 안 보이면 네트워크부터 본다.
- 위치 카드의 버튼 문구는 Figma `위치 사용 허용` 이 아니라 `계속` 이다(미결 드리프트). 알림 카드에는 건너뛰기가 없다(심사 지침).
- 위치 카드에 진입했을 때 "다시 묻지 않음"으로 거부된 상태면 곧장 거부 프레임이 뜬다 — 기본 카드를 보려면 위치 권한을 초기화한다.
- 이미 위치 권한이 허용된 기기(같은 시뮬 두 번째 계정)는 `계속` 이 OS 창 없이 바로 넘어간다.
- 취향 2/2 에는 뒤로 버튼이 없다(엣지 스와이프만). 약관 화면에도 뒤로 버튼이 없어 로그인으로 돌아갈 UI 가 없다(2026-09-28 QA 101, 판단 필요로 남아 있다).
- 진입 판정은 세 조회가 모두 끝나야 화면을 그린다 — 오프라인이면 빈 화면이 수 초 이어질 수 있다. 조회 실패 축은 "미완"으로 접혀 한 단계를 다시 본다.
- 온보딩 완료 뒤 기능 안내로 가는 이동은 게이트가 홈을 연 뒤에만 일어난다 — 서버가 완료를 늦게 반영하면 `완료` 뒤 아무 일도 안 일어난 것처럼 보일 수 있다(대기 상한 없음).
- [실화면] 2026-10-31 도달 불가 — 온보딩을 마치지 않은 신규 계정이 없고(소셜 로그인 필요·로그아웃 금지), 온보딩 딥링크는 가드에 막혀 무시된다. 17개 sub-feature 전부 미확인. 같은 위치·알림 카드는 `permissions` 딥링크로 생김새만 봤다.
