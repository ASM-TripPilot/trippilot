---
paths:
  - "src/features/onboarding/**"
---
# `src/features/onboarding/` — 약관·닉네임·취향 온보딩


계층: `ui`(글리프) → `model`(여러 화면이 함께 쓰는 상태·스토어·순수 함수). 화면 뷰 6개(약관·닉네임·취향 1/2·2/2·재동의·약관 열람)와 약관·닉네임 훅은 TRIP-1146으로 각 `pages/<slice>/{ui,model}/`로 이사했다 — 이 폴더엔 다중 소비 모듈과 `validateNicknameFormat`(소비 1곳이지만 `shared/validation` 재수출 shim이라 잔류)이 남는다.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/model/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **`{false,false}` 하드코딩**. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/model/validateNicknameFormat.ts` | **순수 함수** — 닉네임 길이(코드포인트 2~20)만. 내용 판정은 서버 권한 |
| `src/features/onboarding/model/preferenceSelection.ts` | 재수출만 — 실체는 `shared/pref/preferenceSelection.ts`(설정 l05가 같은 규칙을 쓰려고 승격). `toggleMulti`(복수 축)·`toggleSingle`(단일 축), `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/onboarding/model/preferenceStore.ts` | **Zustand 스토어** — 취향 6축 세션 메모리. 스토어 자체는 persist 없음(서버 영속은 `PrefStep2Page`가 완료 순간 1회 PUT). `create(createPreferenceDraft)` 형태 — 제네릭 직접 호출(`create<`)은 구조 가드를 오탐시킨다 |
| `src/features/onboarding/model/preferenceInput.ts` | 순수 함수 `toPreferenceInput` — 스토어 slug를 서버 `PreferenceInput`의 한국어 enum으로 7축 번역(`budgetRawAmount`는 항상 `null`). 동행 `'pet'`은 `companionTypes`가 아니라 `petFlag` 특례, 미지 slug는 드롭. 호출자는 `PrefStep2Page` 한 곳(fire-and-forget, 실패해도 온보딩 완료를 막지 않음) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프(raw hex 직박). |
