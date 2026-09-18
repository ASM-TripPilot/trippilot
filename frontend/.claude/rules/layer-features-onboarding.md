---
paths:
  - "src/features/onboarding/**"
---
# `src/features/onboarding/` — 실구현 ②


**계층 개명(TRIP-173)**: auth와 동형으로 축소 — `ui`(프레젠테이션, 구 `screens`+`components`) → `model`(상태·훅·스토어, 구 `hooks`+`store`+기존 `model`이 합류). 배선(구 `containers`)은 `pages/onboarding-{terms,nickname,pref1,pref2}/ui/`로 이동(위 `src/pages/` 절 참조). **`store/` 디렉토리는 폐지** — Zustand 스토어가 `model/`로 합류했다.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/ui/TermsScreen.tsx` | 약관 화면(프레젠테이션 · props만) |
| `src/features/onboarding/ui/NicknameScreen.tsx` | 닉네임 화면(오류·대체칩 표시만). 칩은 값(인덱스 아님)을 올림 |
| `src/features/onboarding/ui/PrefStep1Screen.tsx` | 취향 1/2 화면(프레젠테이션 · Figma c09/1643:1183 정합) — 스타일 그리드(복수)+페이스(단일). props만, 스토어·네트워크 모름 |
| `src/features/onboarding/ui/PrefStep2Screen.tsx` | 취향 2/2 화면(프레젠테이션 · Figma c09b/1774:2258 정합) — 예산(단일)+동행·음식·이동(복수) + back chevron(Q4 결정, 2/2 전용) |
| `src/features/onboarding/model/useTermsConsent.ts` | 약관 3종 로드·토글·`POST /me/consents` **1회** 제출. 실패 시 이동 안 함 |
| `src/features/onboarding/model/useNickname.ts` | 닉네임 프리필 + **순서 저장**(형식→check→PATCH→complete). 각 단계 실패 시 다음 미호출 |
| `src/features/onboarding/model/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **현재 `{false,false}` 하드코딩**(FW1) — 아래 경고. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름 — 02a §7-11) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/model/validateNicknameFormat.ts` | **순수 함수** — 닉네임 길이(코드포인트 2~20)만. 내용 판정은 서버 권한 |
| `src/features/onboarding/model/preferenceSelection.ts` | **순수 함수** — `toggleMulti`(복수 축)·`toggleSingle`(단일 축). `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/onboarding/model/preferenceStore.ts` | **Zustand 스토어**(구 `store/preferenceStore.ts`, TRIP-173에서 `model/`로 합류) — 취향 6축(styles·pace·budget·companions·foods·transports) 세션 메모리 상태. **스토어 자체는 persist 없음**(인터뷰3 결정 유지), 토글 판단은 `model/preferenceSelection`에 위임. `create(createPreferenceDraft)` 형태(구조 가드 6-2 정합 — 제네릭 직접 호출 시 `create<` 리터럴이 가드를 오탐시킴, 개념 [[구조 가드와 긍정 앵커]]). **TRIP-471부터 완료 시점 서버 영속이 생겼다** — 스토어가 직접 persist하는 게 아니라 `pages/onboarding-pref2/ui/PrefStep2Page.tsx`가 완료 순간 `toPreferenceInput`(아래)으로 변환해 1회 PUT한다. "세션 전용"은 스토어 자체 성질로는 여전히 맞지만 "서버에 전혀 안 보낸다"로 읽으면 스테일 — 아래 `preferenceInput.ts` 행 참고 |
| `src/features/onboarding/model/preferenceInput.ts` | **신규(TRIP-471)** — 순수 함수 `toPreferenceInput(draft: PreferenceDraftValues): PreferenceInput`. 스토어 slug(`'low'`·`'relaxed'`…)를 서버 `PreferenceInput`의 한국어 enum(`'저가'`·`'느긋하게'`…)으로 7축 번역(styles·activities·transportModes·foodTastes·companionTypes·pace·budgetTier, `budgetRawAmount`는 항상 `null`). **동행 `'pet'` slug는 `companionTypes` 항목이 아니라 별도 `petFlag: boolean` 특례**(서버 companionTypes enum에 반려동물이 없음). 미선택 축(`null`)은 `null` 유지, 알 수 없는 slug는 매핑 테이블에 없으면 드롭. 호출자는 `PrefStep2Page.tsx`(완료 시 `usePutMePreferences` fire-and-forget, 실패해도 온보딩 완료를 막지 않음 — INV-4 성격) 한 곳뿐(`onboardingPrefStructure.test.ts`가 "완료 배선은 페이지 한 곳" 계약으로 잠금) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프. 기존 5종(체크·재생성 등)+**신규 19종**(스타일7·페이스3·동행4·이동3·info·skip chevron 등, TRIP-163). raw hex 색 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일들과 **같은 폴더가 됐다.** F2 raw-hex 가드(`onboardingStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`SCREEN_SOURCE_FILES` 상수로 6개 고정, code-critic W-2·W-3 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
