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
| `src/features/onboarding/model/preferenceStore.ts` | **Zustand 스토어**(구 `store/preferenceStore.ts`, TRIP-173에서 `model/`로 합류) — 취향 6축(styles·pace·budget·companions·foods·transports) 세션 메모리 상태. **persist 없음**(인터뷰3), 토글 판단은 `model/preferenceSelection`에 위임. `create(createPreferenceDraft)` 형태(구조 가드 6-2 정합 — 제네릭 직접 호출 시 `create<` 리터럴이 가드를 오탐시킴, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프. 기존 5종(체크·재생성 등)+**신규 19종**(스타일7·페이스3·동행4·이동3·info·skip chevron 등, TRIP-163). raw hex 색 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일들과 **같은 폴더가 됐다.** F2 raw-hex 가드(`onboardingStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`SCREEN_SOURCE_FILES` 상수로 6개 고정, code-critic W-2·W-3 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
