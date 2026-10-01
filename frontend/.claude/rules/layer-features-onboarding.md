---
paths:
  - "src/features/onboarding/**"
---
# `src/features/onboarding/` — 약관·닉네임·취향 온보딩


계층: `ui`(프레젠테이션) → `model`(상태·훅·Zustand 스토어). 배선은 `pages/onboarding-{terms,nickname,pref1,pref2}/ui/`.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/ui/TermsScreen.tsx` | 약관 화면(프레젠테이션 · props만) |
| `src/features/onboarding/ui/NicknameScreen.tsx` | 닉네임 화면(오류·대체칩 표시만). 칩은 값(인덱스 아님)을 올림 |
| `src/features/onboarding/ui/PrefStep1Screen.tsx` | 취향 1/2 화면 — 스타일 그리드(복수)+페이스(단일). props만, 스토어·네트워크 모름 |
| `src/features/onboarding/ui/PrefStep2Screen.tsx` | 취향 2/2 화면 — 예산(단일)+동행·음식·이동(복수) + back chevron(2/2 전용) |
| `src/features/onboarding/model/useTermsConsent.ts` | 약관 3종 로드·토글·`POST /me/consents` **1회** 제출. 실패 시 이동 안 함 |
| `src/features/onboarding/model/useNickname.ts` | 닉네임 프리필 + **순서 저장**(형식→check→PATCH→complete). 각 단계 실패 시 다음 미호출 |
| `src/features/onboarding/model/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **`{false,false}` 하드코딩**. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/model/validateNicknameFormat.ts` | **순수 함수** — 닉네임 길이(코드포인트 2~20)만. 내용 판정은 서버 권한 |
| `src/features/onboarding/model/preferenceSelection.ts` | 재수출만 — 실체는 `shared/pref/preferenceSelection.ts`(설정 l05가 같은 규칙을 쓰려고 승격). `toggleMulti`(복수 축)·`toggleSingle`(단일 축), `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/onboarding/model/preferenceStore.ts` | **Zustand 스토어** — 취향 6축 세션 메모리. 스토어 자체는 persist 없음(서버 영속은 `PrefStep2Page`가 완료 순간 1회 PUT). `create(createPreferenceDraft)` 형태 — 제네릭 직접 호출(`create<`)은 구조 가드를 오탐시킨다 |
| `src/features/onboarding/model/preferenceInput.ts` | 순수 함수 `toPreferenceInput` — 스토어 slug를 서버 `PreferenceInput`의 한국어 enum으로 7축 번역(`budgetRawAmount`는 항상 `null`). 동행 `'pet'`은 `companionTypes`가 아니라 `petFlag` 특례, 미지 slug는 드롭. 호출자는 `PrefStep2Page` 한 곳(fire-and-forget, 실패해도 온보딩 완료를 막지 않음) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프(raw hex 직박). |
