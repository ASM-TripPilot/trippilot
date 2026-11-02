---
id: login
band: c
status: live-unreachable
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/(auth)/_layout.tsx
  - app/(auth)/login.tsx
  - app/oauth/[provider].tsx
---

# 소셜 로그인

게스트가 구글·Apple·카카오·네이버 중 하나로 로그인한다(이메일 가입 없음). 버튼을 누르면 제공자 인가 창(브라우저 또는 네이티브 SDK)이 뜨고, 돌아오면 서버와 토큰을 교환해 저장한 뒤 게이트가 다음 목적지(신규 → 온보딩, 기존 → 홈)를 다시 정한다. 만 14세 확인 시트, 다른 제공자로 이미 가입된 이메일의 충돌 시트, 14세 미만 제한 시트, 취소 안내, 실패 배너가 상태에 따라 뜬다.

## Sub-features

- `login-buttons` 제공자 버튼 목록: `구글로 계속하기` → (iOS 에서 가능하면) `Apple로 계속하기` → `카카오로 계속하기` → `네이버로 계속하기`.
- `login-apple-hidden` Apple 로그인을 쓸 수 없는 기기(판정 전·Android·판정 실패)는 Apple 버튼 자리가 없다.
- `login-naver-hidden` 네이버 SDK 키가 없는 빌드는 네이버 버튼이 없다(개발용 가짜 인가 모드에선 항상 보임).
- `login-age-sheet-pre` 구글(브라우저 OAuth 갈래)과 가짜 인가 모드는 인가 **전에** 항상 `만 14세 이상이 맞나요?` 시트를 띄운다.
- `login-age-sheet-post` Apple·카카오·네이버(SDK 토큰 갈래)는 서버가 연령확인 누락으로 거절할 때만(신규 가입) 같은 시트를 띄우고, 확인하면 같은 토큰으로 재전송한다.
- `login-age-cancel` 연령 시트 `취소` → 시트가 닫히고 버튼 화면으로 돌아간다.
- `login-age-restricted` 서버가 `AGE_NOT_MET` 을 주면 `만 14세 미만은 가입할 수 없어요` 시트 + `확인`.
- `login-conflict` 서버가 `SOCIAL_EMAIL_CONFLICT` 를 주면 `이미 가입된 계정이에요` 시트 — 기존 제공자로 계속 / 취소.
- `login-cancelled` 인가 창에서 사용자가 취소 → `로그인이 취소됐어요` 안내.
- `login-error` 그 밖의 모든 실패(인가 자체 예외·client ID 미설정·서버 오류·알 수 없는 코드) → `로그인에 실패했어요. 잠시 후 다시 시도해 주세요` 배너.
- `login-success` 교환 성공 → 토큰 저장 → 게이트 재판정(신규는 온보딩, 기존은 홈).
- `login-in-flight-lock` 인가·교환 진행 중 다른 버튼 탭은 무시된다.
- `login-oauth-relay` `oauth/<provider>` 는 웹 팝업 복귀 중계 화면(`로그인 확인 중…`)이다. iOS 에선 쓰이지 않는다.

## How to get to it (user POV)

- 토큰 없이 앱을 콜드 스타트 → 게이트가 로그인 묶음을 연다(`app-launch` 기능 파일).
- 설정에서 로그아웃 확정 → 로그인 화면으로 교체(설정 레인 소관, 여기선 실행 금지).
- 세션 만료(401)·계정 삭제 등으로 게이트 목적지가 로그인으로 바뀔 때 → 쌓인 화면을 걷고 `/login` 으로 교체.
- not-found 화면의 `홈으로` 는 게이트가 로그인이면 `/login` 으로 간다.
- 딥링크로 직접 여는 경로는 없다 — `(auth)` 묶음은 게이트가 로그인일 때만 열린다(딥링크 `trippilot:///login` 을 다른 목적지에서 열었을 때 동작은 확인 필요).
- 개발 프리뷰 `trippilot://_dev/preview?state=<키>` 로 정적 상태만 볼 수 있다: `login-idle`·`login-cancelled`·`login-error-banner`·`login-conflict-sheet`·`login-age-sheet`·`login-age-restriction`(실제 로그인 아님).

## Driving it with agent-device

Preconditions:

- 로그인 화면이 떠 있다(토큰 없는 상태 — `app-launch` Gotchas 의 키체인 주의).
- 실제 제공자 로그인은 **사람의 소셜 계정 입력이 필요하다**. 에이전트 단독으로는 화면 구성·연령 시트·취소까지만 증명할 수 있다.
- 어떤 버튼이 보일지는 빌드 env 가 정한다: 구글은 `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, 카카오 SDK 는 `EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`, 네이버는 `EXPO_PUBLIC_NAVER_URL_SCHEME`, 가짜 인가는 `EXPO_PUBLIC_AUTH_FAKE=1`(+ `EXPO_PUBLIC_AUTH_FAKE_OUTCOME=cancel|dismiss`).
- 신규/기존 계정 여부, 연령 거절, 이메일 충돌은 서버 응답이 정한다.

- **화면 구성.** 로그인 화면에서 testID: `auth-login-root`·`auth-login-brand`·`auth-login-logo-box` 와 문구 `여행의 모든 순간을, TripPilot` 이 보인다
- **버튼 순서.** testID: `auth-login-google`(`구글로 계속하기`) 다음에 iOS 에선 testID: `auth-login-apple`(안쪽 문구 `Apple로 계속하기`, testID: `auth-login-apple-label`), 이어서 testID: `auth-login-kakao`(`카카오로 계속하기`), testID: `auth-login-naver`(`네이버로 계속하기`)가 있다. 네이버 버튼이 없으면 빌드에 네이버 키가 없는 것이다
- **구글 — 사전 연령 시트.** testID: `auth-login-google` 을 누른다. 인가 창보다 먼저 testID: `auth-age-sheet` 에 `만 14세 이상이 맞나요?`·`관련 법령에 따라 만 14세 이상만 가입할 수 있어요.` 가 뜬다(기존 회원도 매번 뜬다)
- **연령 시트 취소.** testID: `auth-age-sheet-cancel`(`취소`)을 누른다. 시트가 닫히고 버튼 화면이 남는다. 인가 창은 뜨지 않는다
- **연령 시트 확인 → 인가.** 다시 구글을 누르고 testID: `auth-age-sheet-confirm`(`네, 확인했어요`)을 누른다. 구글 인가 창(브라우저)이 뜬다. 여기서부터 계정 입력은 사람 몫이다
- **인가 취소.** 인가 창을 닫는다(취소). 로그인 화면에 testID: `auth-login-cancel-notice` 의 `로그인이 취소됐어요` 가 보이고, 버튼 위치는 밀리지 않는다(안내가 버튼 아래에 있다)
- **카카오·Apple·네이버(SDK).** 버튼을 누르면 연령 시트 없이 곧장 제공자 SDK 창이 뜬다. 신규 계정이면 서버 거절 뒤에 testID: `auth-age-sheet` 가 뜨고, `auth-age-sheet-confirm` 을 누르면 같은 토큰으로 재전송한다
- **실패 배너.** 인가가 예외로 끝나거나(예: 구글 client ID 미설정) 서버가 오류를 주면 testID: `auth-login-error-banner` 에 `로그인에 실패했어요. 잠시 후 다시 시도해 주세요` 가 보인다. 아무 버튼을 다시 누르면 배너가 사라지고 재시도한다
- **이메일 충돌.** 서버가 충돌을 주면 testID: `auth-login-conflict-sheet` 에 testID: `auth-login-conflict-title`(`이미 가입된 계정이에요`)과 testID: `auth-login-conflict-message`(`이 이메일은 이미 <제공자> 로그인으로 가입되어 있어요. <제공자> 로그인으로 계속하시겠어요?`, 제공자 모르면 `다른 방법으로 가입된 계정이에요`)가 뜬다. testID: `auth-login-conflict-continue`(`<제공자> 로그인으로 계속` / `기존 로그인으로 계속`)는 기존 제공자로 다시 로그인을 시작하고, testID: `auth-login-conflict-cancel`(`취소`)은 시트를 닫는다
- **연령 제한.** 서버가 `AGE_NOT_MET` 을 주면 testID: `auth-age-restriction` 에 `만 14세 미만은 가입할 수 없어요` 와 testID: `auth-age-restriction-confirm`(`확인`)이 뜬다. `확인` 은 시트를 닫기만 한다
- **성공.** 사람 계정으로 인가를 마친다. 신규 계정이면 약관 동의 화면 testID: `onboarding-terms-root`, 기존 계정이면 홈(또는 권한 안내 카드)이 뜬다. 다른 화면 확인: 앱을 재시작해도 로그인 화면이 다시 뜨지 않아야 한다
- **연타 잠금.** 구글이 아닌 버튼을 빠르게 두 번 누른다. 제공자 창이 한 번만 뜬다(진행 중 탭 무시)
- **증거.** 버튼 화면·연령 시트·취소 안내를 각각 `snapshot -i` + 스크린샷.

## Gotchas

- **[실화면 전용] 세 시트(`auth-age-sheet`·`auth-login-conflict-sheet`·`auth-age-restriction`)의 실제 열림·딤(testID: `auth-sheet-backdrop`) 전면 덮임·grabber 이중 표시 여부**는 바텀시트 통과형 목 때문에 실화면으로만 확인된다. 시트가 열렸다고 판단하려면 화면 하단에 시트가 실제로 올라와 있는지 스크린샷으로 본다.
- **[실화면 전용] 애플 버튼 짧은 탭 반응**·큰 글꼴에서 52px 버튼 안 글자 잘림은 실화면만 본다.
- 로고 박스 라운드·크기(72px)는 style 로만 먹는다 — 각져 보이거나 작으면 회귀다(jest 무심판).
- 구글은 기존 회원도 매번 연령 시트를 거친다(인가 코드가 1회용이라 사전 확인 방식). "기존 회원에게 연령 시트가 뜬다"를 결함으로 보고하지 않는다.
- 카카오 키가 없는 빌드는 카카오가 브라우저 OAuth 로 가서 구글처럼 사전 연령 시트가 뜬다. 어떤 갈래인지는 시트가 인가 전/후 언제 뜨는지로 구분된다.
- 네이버는 SDK 키가 없으면 버튼이 숨는다. 과거 키 없는 빌드에서 브라우저 OAuth 로 가 네이버 오류 페이지가 뜬 기록이 있다(2026-09-28 QA, 이후 숨김 처리).
- 가짜 인가(`EXPO_PUBLIC_AUTH_FAKE=1`)는 `fake-code` 를 서버로 보낸다 — 실서버(`dev-api`)는 이를 받아 주지 않을 것으로 보여 실패 배너로 끝날 수 있다(확인 필요). 가짜 인가로 성공 경로를 "검증됨"이라 하지 않는다.
- 로그인 화면의 연령 시트 `취소`·충돌 `취소`·제한 `확인`은 화면만 되돌린다. 화면 안 상태는 다음 버튼 탭에서 초기화된다.
- 로그인 성공 후 이동은 `'/'` 로 보내 게이트 전환에 맡긴다 — 진짜 라우터로 고정된 jest 케이스가 아직 없다. 성공 후 로그인 화면에 머물면 이 경로부터 의심한다.
- `oauth/<provider>` 중계 화면(testID: `oauth-redirect-page`, `로그인 확인 중…`)은 웹 전용이다. iOS 에서 이 경로가 열리면 `'/'` 로 보내는데, 홈 계정에겐 `'/'` 가 무시돼 그 화면에 머물 수 있다(확인 필요, 정상 흐름에선 열리지 않음).
- 계정 경계: 로그아웃 → 다른 계정 로그인 시 이전 계정 화면이 남던 결함(2026-09-28 QA 048)이 있었다 — 사람과 계정 전환을 할 기회가 있으면 이전 계정 여행 화면이 안 보이는지 함께 본다.
- 로그아웃 실행 금지, 취소까지만 — 재로그인에 사람 손이 필요하다.
- [실화면] 2026-10-31 도달 불가 — 로그인된 계정이고 로그아웃이 금지라 로그인 화면을 띄울 수 없다. 홈 계정에서 딥링크 `com.trippilot.travel://login` 은 무시됐다(홈 유지). 13개 sub-feature 전부 미확인. 프리뷰(`_dev/preview`)는 실화면 검증이 아니라 쓰지 않았다.
