---
id: app-launch
band: c
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/_layout.tsx
  - app/force-update.tsx
  - app/reconsent.tsx
  - app/+not-found.tsx
---

# 앱 시작 · 게이트

앱을 켜면 스플래시가 최소 1.3초 보이는 동안 서버 `/bootstrap` 을 한 번 묻고, 그 답으로 다섯 목적지(강제 업데이트 > 재동의 > 로그인 > 온보딩 > 홈) 중 하나의 화면 묶음만 연다. 서버가 3초 안에 답하지 않으면 저장된 토큰 유무로 잠정 분기(토큰 있음 → 홈, 없음 → 로그인)했다가 네트워크가 돌아오면 서버 판정으로 고친다. 로그아웃·세션 만료로 목적지가 로그인으로 바뀌면 쌓인 화면을 걷고 로그인 화면으로 바꾼다. 없는 주소로 들어오면 한국어 "페이지를 찾을 수 없어요" 화면이 뜨고 `홈으로` 가 게이트가 지금 연 묶음으로 데려간다.

## Sub-features

- `launch-splash` 스플래시(로고·`TripPilot`·슬로건·진행 점)가 최소 1.3초 보이고, 판정 전·권한 조회 대기(최대 1초 추가) 중에는 계속 보인다.
- `launch-route-home` 온보딩을 마친 인증 사용자 → 홈 탭 묶음(`(tabs)`).
- `launch-route-login` 게스트(토큰 없음) 또는 저장 토큰이 401 로 거절됨 → 로그인 화면.
- `launch-route-onboarding` 인증됐지만 `onboardingCompleted:false` → 온보딩 진입(남은 첫 단계는 `onboarding` 기능 파일 소관).
- `launch-timeout-fallback` `/bootstrap` 무응답 3초 → 토큰 유무로 잠정 홈/로그인, 네트워크 재연결 시 재조회로 교정.
- `launch-force-update` 서버 `appUpdate.status === 'FORCED'` → 강제 업데이트 안내(버튼 없음).
- `launch-reconsent` 서버 `reconsent.required` → 약관 재동의 화면(대상 약관 체크 → `동의하고 계속하기`).
- `launch-reconsent-load-error` 재동의 대상 조회 실패 또는 대상이 비어 있음 → 오류 문구 + `다시 시도`.
- `launch-reconsent-save-error` 동의 저장(PATCH) 일부라도 실패 → 오류 문구 + `다시 시도`(성공한 약관은 다시 보내지 않음).
- `launch-reconsent-view` 재동의 행의 `보기` → 약관 열람 화면(`/terms/<termsType>`).
- `launch-account-boundary` 그려진 뒤 목적지가 로그인으로 바뀌면(로그아웃·세션 만료) 루트 스택을 걷고 `/login` 으로 교체, 이전 계정 캐시·취향 세션을 비운다.
- `launch-not-found` 없는 경로 → "페이지를 찾을 수 없어요" + `홈으로`(게이트 목적지 묶음으로 `dismissTo`).
- `launch-push-reregister` 홈 진입 2.5초 뒤 알림 권한이 허용돼 있으면 푸시 토큰을 조용히 재등록한다(묻지 않음, 화면 변화 없음).
- `launch-safe-area` 상태바·홈 인디케이터 안전영역이 회색으로 비치지 않고 화면과 같은 흰 배경이다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `launch-gesture-root` 앱 어느 화면에서든 바텀시트를 손가락으로 끌어 올리고 내릴 수 있고, 엣지 스와이프 뒤로가 먹는다(앱 전체가 제스처 루트로 감싸져 있다 — 이게 빠지면 시트·스와이프가 전부 조용히 안 움직인다). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `launch-guide-no-swipe` 첫 실행 안내 화면(기능 안내·권한 안내)은 가장자리 스와이프로 뒤로 갈 수 없다. 전환 애니메이션은 기본값이라 들어올 때 오른쪽에서 슬라이드한다(라우트 옵션은 `gestureEnabled:false` 뿐). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 — 지도 정정)*

## How to get to it (user POV)

- 앱 콜드 스타트(홈 화면 아이콘 탭 또는 `xcrun simctl launch`). 모든 목적지는 이 한 경로로만 열린다 — 강제 업데이트·재동의 화면으로 가는 버튼·딥링크는 없다. 홈 계정이 `com.trippilot.travel://force-update`·`reconsent`·`login`·`nickname`·`terms`·`pref1` 을 열면 not-found 도 아니고 **아무 일도 없다**(지금 화면 유지, 2026-10-31 실측).
- 앱 안 로그아웃(설정 `로그아웃` 확정) 또는 세션 만료(401) → 게이트가 로그인으로 전환(설정 화면 흐름은 설정 레인 소관).
- 로그인 성공·재동의 완료·온보딩 완료 → 게이트 재판정으로 다음 묶음이 열린다.
- 딥링크 `trippilot:///<존재하지 않는 경로>`(예: `trippilot:///no-such-page`) → not-found 화면.
- 앱 안에서 존재하지 않는 경로로 push 되는 경우도 같은 not-found 화면이다.

## Driving it with agent-device

Preconditions:

- dev build 가 `dev-api` 를 바라본다. 목적지는 서버 응답이 정한다 — 홈 경로는 온보딩을 마친 로그인 계정, 로그인 경로는 토큰 없는 상태가 필요하다.
- 강제 업데이트·재동의는 서버가 `appUpdate.status=FORCED` / `reconsent.required=true` 를 줄 때만 열린다(앱 쪽 토글·목 시나리오는 jest 전용이다).
- 로그인 상태는 iOS 키체인에 남아 **앱을 지웠다 다시 깔아도 유지된다**. 로그인 화면을 보려면 키체인까지 비워야 한다(아래 Gotchas).

- **스플래시.** 앱을 콜드 스타트한다. 첫 화면에 testID: `shell-splash-root` 와 문구 `TripPilot`(testID: `shell-splash-wordmark`)·`여행의 처음부터 끝까지, 한 곳에서`(testID: `shell-splash-slogan`)·진행 점(testID: `shell-splash-progress`)이 보인다. 최소 1.3초 뒤 사라진다
- **홈으로 분기.** 온보딩 완료 계정으로 콜드 스타트한다. 스플래시 뒤 홈 탭 묶음이 뜬다(홈 화면 확인은 홈 레인 기능 파일). 위치·알림 권한이 미결정이면 홈 대신 권한 안내 카드가 먼저 뜬다 — `permissions` 기능 파일
- **로그인으로 분기.** 토큰이 없는 상태로 콜드 스타트한다. 스플래시 뒤 testID: `auth-login-root` 가 뜬다
- **잠정 분기.** 네트워크를 끊은 채(맥 Wi-Fi 끔 등) 토큰 있는 계정으로 콜드 스타트한다. 약 3초 뒤 스플래시가 풀리고 홈이 뜬다(서버 판정 없이 잠정). 네트워크를 되살리면 서버가 다른 목적지를 주는 경우에만 화면이 바뀐다
- **강제 업데이트.** 서버가 FORCED 를 줄 때 콜드 스타트한다. 문구 `업데이트가 필요해요` 와 `계속하려면 최신 버전으로 업데이트해 주세요` 만 보인다. 누를 것이 없다
- **재동의 — 목록.** 서버가 재동의를 요구할 때 콜드 스타트한다. 헤더 `약관 재동의`, 제목 `약관이 변경되었어요` / `다시 동의해 주세요`, 대상 약관마다 체크 행 testID: `reconsent-item-<termsType>`(접근성 역할 checkbox)과 `보기` 버튼 testID: `reconsent-view-<termsType>`(라벨 `<약관 이름> 보기`)이 보인다. 약관 이름은 `서비스 이용약관`·`개인정보 처리방침`·`위치정보 이용약관`, 그 밖 타입은 서버 코드 원문이다
- **재동의 — 버튼 잠금.** 체크하지 않은 행이 하나라도 있으면 testID: `reconsent-agree`(`동의하고 계속하기`)가 흐리게 비활성이다. 전부 체크하면 활성된다
- **재동의 — 보기.** testID: `reconsent-view-TERMS_OF_SERVICE` 를 누른다. 약관 열람 화면이 push 로 열린다. 뒤로 오면 체크 상태가 유지된다
- **재동의 — 완료.** 전부 체크하고 testID: `reconsent-agree` 를 누른다. 게이트가 재판정해 홈(또는 온보딩)이 뜬다. 앱을 다시 켜도 재동의 화면이 다시 뜨지 않으면 저장 확인이다(다른 화면에서 한 번 더 읽기)
- **재동의 — 조회 실패.** 재동의 화면에서 대상 조회가 실패하면 testID: `reconsent-error` 에 `재동의할 약관을 불러오지 못했어요. 다시 시도해 주세요.` 와 testID: `reconsent-retry`(`다시 시도`)가 보인다. 누르면 다시 조회한다
- **재동의 — 저장 실패.** 저장이 실패하면 testID: `reconsent-error` 에 `동의를 저장하지 못했어요. 다시 시도해 주세요.` 가 보이고 화면에 머문다. testID: `reconsent-retry` 는 대상을 다시 읽은 뒤 아직 성공 안 한 약관만 보낸다
- **없는 경로.** `xcrun simctl openurl booted "trippilot:///no-such-page"` 를 연다. 문구 `페이지를 찾을 수 없어요`·`주소가 바뀌었거나 없는 화면이에요` 와 testID: `not-found-home`(`홈으로`)이 보인다. 누르면 게이트가 연 묶음(홈 계정이면 홈 탭)으로 돌아가고 not-found 가 스택에 남지 않는다
- **계정 경계.** 실행 금지, 취소까지만 — 로그아웃 확정은 재로그인에 사람 손이 필요하다. 사람과 함께 할 때만: 여행 상세 등 탭 밖 화면을 몇 장 쌓은 뒤 로그아웃 → testID: `auth-login-root` 가 뜨고, 다른 계정으로 로그인했을 때 이전 계정 화면·데이터가 보이지 않아야 한다
- **증거.** 각 분기 첫 화면에서 `snapshot -i` 와 스크린샷을 남긴다(스플래시는 1.3초라 콜드 스타트 직후 바로 찍는다).

## Gotchas

- **[실화면 전용] 네이티브 스플래시 → JS 스플래시 → 첫 화면 전환의 깜빡임**은 실화면으로만 확인된다. 스플래시 최소 노출 1.3초는 JS 모듈 로드 시각 기준이라 번들 평가가 길면 화면에서 더 짧게 보인다.
- **강제 업데이트는 현재 도달 불가로 보인다(확인 필요).** 앱은 `/bootstrap` 에 버전 헤더를 싣지 않는데, 서버는 `X-App-Version` 헤더가 없으면 업데이트 상태를 NONE 으로 낸다(백엔드 `BootstrapController.kt`·`AppVersionTest`). 재현이 안 되면 `live-unreachable` 로 적는다. 화면에는 스토어 링크·버튼·testID 가 하나도 없다.
- 재동의도 서버 데이터(새 약관 버전 + 재동의 요구)가 있어야만 열린다. 실서버에서 만들 수 없으면 `live-unreachable`. 재동의 화면에는 뒤로가기·거절 경로가 없다(나갈 곳 없는 게이트 화면).
- **로그인 화면을 보려고 앱을 지우는 것은 효과가 없다** — 토큰이 키체인에 있어 재설치 뒤 자동 로그인된다. 시뮬 키체인 초기화(`xcrun simctl keychain booted reset`, 확인 필요)나 로그아웃이 필요한데, 로그아웃 뒤 재로그인은 사람의 소셜 계정이 필요하다(과거 QA 다수가 이 이유로 로그인·온보딩을 건너뛰었다).
- 홈 진입 화면이 홈이 아니라 위치/알림 권한 카드일 수 있다(재설치 직후 OS 권한이 미결정이면). 홈 분기를 증명할 때는 권한을 미리 결정해 둔다 — `permissions` 기능 파일.
- not-found 의 `홈으로` 가 무반응일 수 있다(로그인 계정에서 '홈' 목적지가 조용히 무시되는 경우). 무반응이면 앱을 재기동해 빠져나온다.
- 잠정 분기(오프라인)로 연 홈은 서버 판정이 아니다 — 재연결 뒤 서버가 로그인/온보딩을 주면 화면이 갑자기 바뀐다. 오프라인으로 시작한 증거를 "홈 분기 검증"으로 쓰지 않는다.
- 세션 만료(401) 경로는 실기 재현 수단이 없어 jest 로만 확인됐다.
- 계정 경계 걷기 직후 개발 콘솔에 `POP_TO_TOP was not handled` 경고가 찍힌 적이 있다(2026-10-16 QA Q-001, 이후 수정). 다시 보이면 기록만 한다.
- Metro 8081 을 다른 워크트리가 쥐고 있으면 다른 브랜치 게이트가 찍힌다 — `repo-traps.md` 작업 관례.
- [실화면] 2026-10-31 강제 업데이트 화면 도달 불가 — 딥링크 `force-update` 는 게이트 가드에 막혀 무시됐고 서버 FORCED 를 만들 수단이 없다. 버튼이 없는지는 실화면으로 확인 못 함.
- [실화면] 2026-10-31 도달 불가 — `launch-route-login`·`launch-account-boundary`(로그아웃 금지), `launch-route-onboarding`(신규 계정 없음), `launch-timeout-fallback`(네트워크 차단 미실시), `launch-reconsent*`(서버 재동의 요구 없음, 딥링크 무시), `launch-push-reregister`(화면 변화 없음). 스플래시·홈 분기·not-found(`홈으로` 뒤 엣지 스와이프로 not-found 가 안 돌아옴)는 확인.
- [실화면] 2026-11-02 기능 안내는 홈 계정에서 `nav.mjs '/onboarding-tour'`(push)로 열었다 — 들어올 때 슬라이드, 가장자리 스와이프 뒤로 꺼짐. 실제 첫 진입(취향 완료 → replace)과 권한 안내(`permission-location`·`permission-push`)는 신규·권한 미결정 계정이 없어 안 봤다.
