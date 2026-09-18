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
- **세션 만료 UX** → 토큰만 clear하고 **즉시 리다이렉트는 없다**(FW2, 다음 부트스트랩이 자가치유).
- **apple 소셜 로그인** → `oauthConfig`에 **빈 슬롯**(백엔드 fail-closed, 범위 밖). kakao·naver는 채워졌고, naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts` 조건부 분기부터 본다.
- **약관 라벨(`TERMS_LABELS`)은 신규 타입에 자동 대응 안 한다** → `useTermsConsent.ts`의 `ONBOARDING_TERMS_TYPES`(순회 대상)와 `TERMS_LABELS`(라벨 맵)는 **두 상수를 손으로 맞추는 관례일 뿐 구조적 강제가 아니다**(TRIP-366 커밋 a064e97 메시지의 "구조적 불가"는 부정확 — TRIP-375에서 정정). 폴백 `TERMS_LABELS[type] ?? term.termsType`이 있어 라벨을 안 채우면 원시 코드가 그대로 화면에 노출된다.
- **c08 위치 라우트는 이제 `(onboarding)`에 존재한다(D7 반전, TRIP-459)** — 예전엔 `onboardingStructure.test.ts`가 "위치 라우트 0건"을 강제(D2·D7, BR-U0-30 스코프 축소 반영)했으나, 이 사이클로 `nickname→location→pref1` 체인이 실배선됐다. **마운트 시 기존 denied 감지 전이는 무심판** — `LocationPage.tsx`의 `useEffect`(`getForegroundPermissionsAsync` 조회)를 통째로 지우거나 조건을 뒤집어도 승인 테스트 7/7이 green이다(Q2-② 경로, AC 번호 없어 심판 미생성). 이 파일을 다시 만질 때 회귀가 소리 없이 날 수 있다. 조건 자체도 code-critic 경고-1로 안드로이드 `canAskAgain=true`(재요청 가능) 상태를 설정-강제 화면으로 오분류할 수 있음이 지적됨(5-c로 조건은 `status==='denied' && !canAskAgain`으로 정정됐으나 그 전이를 지키는 심판은 여전히 없다).
- **`SocialLoginScreen.tsx`의 앱아이콘 `LinearGradient`는 반경을 `className`이 아니라 `style borderRadius`로 준다** → `rounded-*` 같은 NativeWind 반경 토큰은 그라디언트를 실제로 클립하지 않아 값이 있어도 각져 보인다(TRIP-598 실측). 대조군은 `SplashScreen.tsx`(style borderRadius로 라운드 정상). 이 클립 여부·확대 후 픽셀 크기는 jest 무심판 — `_dev/preview` 로그인 실기 육안이 유일한 그물(지도 `viewOnly`·바텀시트 딤과 동형 층 한계). 반경 재조정 시 반경/박스(0.223)·글리프/박스(0.6) 두 비율을 함께 옮겨야 한다.
