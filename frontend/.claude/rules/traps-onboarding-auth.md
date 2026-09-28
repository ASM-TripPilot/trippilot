---
paths:
  - "src/features/auth/**"
  - "src/features/onboarding/**"
  - "src/pages/onboarding-*/**"
  - "src/app/(onboarding)/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## auth · onboarding

- **온보딩 완료자 라우팅** → `useOnboardingProgress`가 **하드코딩 `false`**(FW1). 실 progress는 `onboardingCompleted`인데 `features/auth`에만 있고 importBoundary가 막는다 — `shared` 승격이 선행돼야 한다.
- **세션 만료·로그아웃 UX** → 토큰 clear가 게이트 목적지를 LOGIN으로 바꾸면 `app-shell/model/useAccountBoundaryReset.ts`가 `dismissAll`→`replace('/login')`→캐시·취향 비우기를 한다(TRIP-1077, 옛 "즉시 리다이렉트 없음(FW2)"은 폐기). 단 세션 만료 실기는 재현 수단이 없어 jest 체인으로만 확인됐고(6-b 미검증), 같은 계정의 HOME→FORCE_UPDATE/RECONSENT 전이는 정리 대상이 아니다.
- **apple 소셜 로그인** → `oauthConfig.ts`의 apple 슬롯은 여전히 빈 값이지만 이제 **안 쓰인다** — `makeAuthorize.ts`(TRIP-932, 2026-09-28 TRIP-1035로 재확인)가 apple을 브라우저 OAuth가 아니라 **네이티브 SDK 어댑터(`appleAuthorize`)로 항상** 라우팅해 `oauthConfig`를 거치지 않는다(env 게이트 없음). "범위 밖" 서술은 낡았다 — 옛 코드 주석·`oauthConfig.ts` 파일 주석에는 아직 남아 있다. kakao·naver는 채워졌고, naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts` 조건부 분기부터 본다.
- **약관 라벨(`TERMS_LABELS`)은 신규 타입에 자동 대응 안 한다** → `useTermsConsent.ts`의 `ONBOARDING_TERMS_TYPES`(순회 대상)와 `TERMS_LABELS`(라벨 맵)는 **두 상수를 손으로 맞추는 관례일 뿐 구조적 강제가 아니다**(옛 커밋 메시지의 "구조적 불가"는 부정확). 폴백 `TERMS_LABELS[type] ?? term.termsType`이 있어 라벨을 안 채우면 원시 코드가 그대로 화면에 노출된다.
- **c08 위치 화면의 마운트 시 기존 denied 감지 전이는 무심판이다** → `pages/onboarding-location/ui/LocationPage.tsx`의 `useEffect`(`getForegroundPermissionsAsync` 조회)를 통째로 지우거나 조건을 뒤집어도 `LocationPage.integration.test.tsx`가 green이다. 조건은 `status==='denied' && !canAskAgain`이다 — 안드로이드 `canAskAgain=true`(재요청 가능)를 설정-강제 화면으로 보내면 오분류다. 이 파일을 다시 만질 때 회귀가 소리 없이 날 수 있다.
- **`SocialLoginScreen.tsx`의 앱아이콘 `LinearGradient`는 반경을 `className`이 아니라 `style borderRadius`로 준다** → `rounded-*` 같은 NativeWind 반경 토큰은 그라디언트를 실제로 클립하지 않아 값이 있어도 각져 보인다. 대조군은 `SplashScreen.tsx`(style borderRadius로 라운드 정상). 이 클립 여부·확대 후 픽셀 크기는 jest 무심판 — `_dev/preview` 로그인 실기 육안이 유일한 그물(지도 `viewOnly`·바텀시트 딤과 동형 층 한계). 반경 재조정 시 반경/박스(0.223)·글리프/박스(0.6) 두 비율을 함께 옮긴다.
