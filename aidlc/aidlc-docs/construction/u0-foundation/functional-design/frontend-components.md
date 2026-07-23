# U0 Foundation — Frontend Components

> 아키텍처 준수: `frontend/README.md`(정본) — `src/app` 얇은 라우트 + `features/` 구현 + `shared/` 횡단, TanStack Query(서버 상태)·Zustand(UI 상태)·RHF+Zod(폼)·NativeWind. testID 규약 `{feature}-{screen}-{role}`. 클라이언트 검증은 전부 UX 사본(판정 정본=서버).

## 1. 라우트 골격 (src/app) — 5탭 확정(Q7)

```text
src/app/
  _layout.tsx                # 루트: 프로바이더(QueryClient·테마) + 부트스트랩 게이트 + 인증 가드
  (auth)/
    login.tsx                # 소셜 로그인 (탭바 없음)
    deletion-pending.tsx     # 삭제 유예 복구 분기 (BR-U0-24)
  (onboarding)/              # 전 화면 탭바 숨김 (BR-U0-29)
    _layout.tsx              # 온보딩 진행 가드(남은 첫 단계로 복귀)
    terms.tsx  age.tsx  nickname.tsx
    preferences/[step].tsx   # 취향 위저드 7단계 (style→budget→companion→activity→transport→food→pace)
  (tabs)/
    _layout.tsx              # 5탭 셸 — 탭별 독립 스택·상태 보존 (BR-U0-28)
    home.tsx                 # 홈 (U0 구현)
    explore.tsx  itinerary.tsx  records.tsx  my.tsx   # U0은 빈 상태 셸만 (후속 유닛이 채움)
  force-update.tsx           # 강제 업데이트 게이트 (풀스크린·서비스 차단)
```

## 2. features/onboarding

| 컴포넌트 | 책임 | props / state | 서버 연동 |
|---|---|---|---|
| `SplashGate` | 부트스트랩 1왕복 → 순수 함수 `resolveEntry(bootstrap\|fallback): Route` 분기(BR-U0-26·27). 스플래시 유지·수동 hide | state: 부트스트랩 질의 상태·3s 타이머 | `GET /bootstrap` |
| `LoginScreen` | 소셜 4종 버튼. 어댑터 인터페이스 `SocialAuthProvider.signIn(provider) → {grantType, credential}` 호출(카카오·네이버=SDK, Google=auth-session, Apple=apple-authentication) | state: 진행 중 provider·취소/오류 배너 | `POST /auth/social/{provider}` (409→기존 수단 안내, 422→연령 화면, 401→실패 배너) |
| `DeletionPendingScreen` | "삭제 예약 중" 안내 + 복구/취소 2액션 (BR-U0-24) | props: purgeAt | 복구 API(백엔드 계약 — G-1과 함께 협의) |
| `TermsScreen` | 필수 3종 체크(서비스·개인정보·위치) + 전체 동의. 전부 체크 전 '다음' 비활성(BR-U0-10 UX 사본). 본문 열람 링크 | state: 체크 상태 3종 | `GET /terms` · `POST /me/consents` |
| `AgeScreen` | 생년월일 입력 또는 만14세 자기 선언 택1 (BR-U0-05) | RHF+Zod: 생년월일 형식·미래 날짜 금지(UX 사본) | 가입 요청에 포함 |
| `NicknameScreen` | 자동 생성값 프리필(BR-U0-16), 인라인 검증(2~20자 — UX 사본), 서버 거부(중복·금칙어) 시 대체 추천 원탭 | RHF+Zod | `GET /nickname/suggestions` · `POST /nickname/check` · `PUT /me/profile/nickname` |
| `PreferenceWizard` + `steps/*` 7종 | 단계 렌더·선택 저장·'건너뛰기'·'나중에 설정하고 시작'(BR-U0-20). 값 도메인은 서버 스키마와 동일 상수(UX 사본) | Zustand: 위저드 진행 단계·선택 임시값 | `PUT /me/preferences` · `POST /onboarding/complete` |
| `LocationPreprompt` | 재사용 프레임(목적 카드+계속/나중에) — **U0에서 발화 지점 없음**(BR-U0-30) | props: `purposeContext`, `onProceed`, `onDefer` | — |

**온보딩 위저드 UX 규칙**: 각 단계 이전/다음 이동 가능(US-ONB-11), 약관·닉네임은 탈출구 미제공, 완료 시 `(tabs)/home` 진입.

## 3. features/home (U0 범위)

| 컴포넌트 | 책임 | 서버 연동 |
|---|---|---|
| `HomeDashboard` | US-SHELL-02 골격: 여행 카드 영역(빈 상태: '예약 없이 AI로 먼저 일정 받아보기'·'가고 싶은 곳 먼저 저장' 진입)·빠른 액션. 인기 장소·추천 카드는 후속 유닛 데이터로 채움 — U0은 스켈레톤/빈 상태 패턴 | (후속 유닛 API — U0은 프로필 요약만) |
| `ProgressivePreferenceCard` | 건너뛴 취향 재권유 카드(BR 근거 US-ONB-11 점진 보완) — 탭하면 해당 취향 단계로 | `GET /me/preferences` |

## 4. shared 연동 계약 (U0에서 확정되는 부분)

- **shared/api**: orval 생성물(현행 openapi 20 경로) + 토큰 회전 single-flight(BR-U0-07~09의 클라 측) + 표준 오류 정규화. `tokenManager` 단일 소유 — axios·스트리밍 클라이언트 공용(frontend/README.md).
- **shared/ui**: 5탭 탭바 단일 컴포넌트(홈·탐색·일정·기록·마이), 빈 상태·스켈레톤·오류 표준 패턴 — U0에서 시드.
- **shared/storage**: 토큰 secure-store 저장·삭제(로그아웃·401 확정 시 즉시), 마지막 로컬 세션 스냅숏(폴백 분기 입력 — BR-U0-27).
- **shared/validation**: U0은 폼 수준 공통 유틸(길이·형식)만 — 제약 검증기 본체는 U2+.

## 5. 폼 검증 (UX 사본 명세)

| 폼 | 클라 검증(Zod) | 서버 정본 |
|---|---|---|
| 연령 | 날짜 형식·미래 금지·만14 계산 미리보기 | BR-U0-05 (422) |
| 닉네임 | 2~20자·공백 트림 | BR-U0-15~17 (중복·금칙어는 서버만) |
| 취향 | 값 도메인 상수 일치·예산 총액 양수 | BR-U0-19·22 |

## 6. testID (규약 `{feature}-{screen}-{role}`)

`onboarding-login-{provider}` · `onboarding-terms-{type}` · `onboarding-terms-next` · `onboarding-age-birthdate` · `onboarding-nickname-input` · `onboarding-nickname-suggest` · `onboarding-pref-{step}-skip` · `onboarding-pref-escape` · `home-dashboard-tripcard` · `home-dashboard-emptycta` · `shell-tabbar-{tab}` (tab ∈ home·explore·itinerary·records·my) · `shell-forceupdate-store`

## 7. PBT 대상 (클라 순수 함수 — fast-check)

- `resolveEntry(bootstrap|fallback)` — 분기 우선순위 전수 속성(BR-U0-26): 임의 조합 입력에서 우선순위 역전 0.
- 버전 비교(semver) — 반대칭·페일오픈 속성(BR-U0-27).
- 온보딩 진행 판정(다음 미완료 단계 계산) — 임의 완료 상태 조합에서 유일 목적지.
