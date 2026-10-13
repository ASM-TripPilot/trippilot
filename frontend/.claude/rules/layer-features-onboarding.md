---
paths:
  - "src/features/onboarding/**"
---
# `src/features/onboarding/` — 약관·닉네임·취향 온보딩


계층: `ui`(글리프) → `model`(여러 화면이 함께 쓰는 상태·스토어·순수 함수). 화면 뷰 6개(약관·닉네임·취향 1/2·2/2·재동의·약관 열람)와 약관·닉네임 훅은 TRIP-1146으로 각 `pages/<slice>/{ui,model}/`로 이사했다 — 이 폴더엔 다중 소비 모듈과 `validateNicknameFormat`(소비 1곳이지만 `shared/lib/nicknameFormat` 재수출 shim이라 잔류)이 남는다. TRIP-1155로 취향 모델 3개(`preferenceStore`·`preferenceSelection`·`preferenceInput`)는 `features/edit-preferences`, `validateNicknameFormat`은 `pages/onboarding/onboarding-nickname/model/`로 이사했다.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/model/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **`{false,false}` 하드코딩**. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프(raw hex 직박). |
