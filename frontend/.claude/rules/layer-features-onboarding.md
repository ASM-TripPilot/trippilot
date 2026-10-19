---
paths:
  - "src/features/onboarding/**"
---
# `src/features/onboarding/` — 약관·닉네임·취향 온보딩


계층: `ui`(글리프) → `model`(여러 화면이 함께 쓰는 상태·스토어·순수 함수). 화면 뷰 6개(약관·닉네임·취향 1/2·2/2·재동의·약관 열람)와 약관·닉네임 훅은 TRIP-1146으로 각 `pages/<slice>/{ui,model}/`로 이사했다 — 이 폴더엔 다중 소비 모듈과 `validateNicknameFormat`(소비 1곳이지만 `shared/lib/nicknameFormat` 재수출 shim이라 잔류)이 남는다. TRIP-1155로 취향 모델 3개(`preferenceStore`·`preferenceSelection`·`preferenceInput`)는 `features/edit-preferences`, `validateNicknameFormat`은 `pages/onboarding/onboarding-nickname/model/`로 이사했다.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 `{termsCompleted,nicknameCompleted,preferencesSaved}` → 잔여 단계 4개(`terms`/`nickname`/`location`/`pref2`). **결과에 홈(`'/'`)이 없다** — `(onboarding)` 그룹과 홈 탭 그룹이 둘 다 URL `'/'`라, 이 그룹이 열려 있다는 것 자체가 서버 기준 미완이다. 다 됐으면 완료를 다시 시도하는 `pref2`로 보낸다(TRIP-1421) |
| `src/features/onboarding/model/onboardingTermsTypes.ts` | `ONBOARDING_TERMS_TYPES` 필수 약관 3종 상수(terms 페이지 노출·제출 + onboarding-entry 판정이 공유, TRIP-1421이 terms 페이지 안 비공개 const에서 이사). 진행 상태 훅은 소비처가 페이지 1곳이라 `pages/onboarding/onboarding-entry/model/`로 갔고 이 폴더엔 없다 |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프(raw hex 직박). 활동 칩용 `LandmarkGlyph`·`FerrisWheelGlyph`·`CoffeeCupGlyph` 포함(g01 시트 소비). |
