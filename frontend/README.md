# TripPilot Frontend

React Native + Expo (TypeScript strict) 클라이언트.

서버 공개 REST API만 소비하며, 비즈니스 규칙 권위는 항상 서버에 있다 — 클라이언트 검증은 UX용 사본이며 저장을 차단하지 않는다(`aidlc/aidlc-docs/inception/application-design/application-design.md`).

> **기획 참조 기준**: `aidlc/aidlc-docs/inception/` (requirements·user-stories·application-design). 화면 명세는 Figma(라이브 정본 — 밴드 맵은 `.claude/skills/spec-perception/reference/figma-structure.md`), API 스키마는 `backend/docs/design/openapi.yaml`, AI 계층 계약은 `ai/README.md`. 그 외 라이브러리·구조 결정은 이 문서가 정본이다.

## 기술 스택 (프론트 결정)

| 영역 | 결정 | 근거 |
|---|---|---|
| 프레임워크 | Expo SDK 54 (RN 0.81, development build + prebuild) · TypeScript strict · New Architecture | 국내 지도 SDK 등 네이티브 모듈을 config plugin으로 수용하면서 관리형 워크플로 유지 |
| 내비게이션 | Expo Router (파일 기반) — 탭별 독립 스택, 딥링크 `trippilot://` + universal/app links | 라우트 = 파일 경로 = 딥링크 URL이 한 번에 정리됨. React Navigation을 래핑하므로 저수준 API도 접근 가능 |
| 상태 관리 | TanStack Query v5(서버 상태) + Zustand(클라이언트 상태) | 서버 데이터의 캐싱·재검증·낙관적 업데이트는 Query가 전담, UI 상태만 경량 스토어로 |
| 폼·스키마 | React Hook Form + Zod | 다단계 폼 리렌더 최소화, Zod 스키마는 API 응답 런타임 검증에 재사용 |
| HTTP | axios(REST 전반) + 토큰 회전 인터셉터(401 시 리프레시 갱신 single-flight 직렬화) · **AI 실시간 응답은 `expo/fetch` 스트리밍 경로** | 동시 401에서 회전이 1회만 일어나야 재사용 오탐이 없음. axios는 XHR 기반이라 SSE/청크 스트리밍 불가 — 일정 생성 진행 표시 등은 expo/fetch(ReadableStream 지원)로. 두 경로가 토큰 첨부·오류 정규화 계층을 공유 |
| 토큰 저장 | expo-secure-store (iOS Keychain / Android Keystore) | AsyncStorage·MMKV는 평문이라 토큰 저장 부적합 |
| 소셜 로그인 | 어댑터 인터페이스 1개 뒤 프로바이더별 구현 — **카카오·네이버는 네이티브 SDK**(@react-native-seoul/kakao-login·naver-login — 카카오톡·네이버앱 간편 로그인, 미설치 시 웹 폴백) · Apple은 expo-apple-authentication · Google은 expo-auth-session | 검증·세션 발급은 전부 서버, 앱에 클라이언트 시크릿은 **원칙적으로** 없음(예외는 아래 참고). 어댑터가 서버 전달 자격 증명(인가 코드 또는 SDK 발급 토큰)을 표준화 — 백엔드 `/auth/social/{provider}` code 경로와 `/auth/social/{provider}/token` 토큰 경로(TRIP-210)를 provider 별로 나눠 탄다 |
| 애니메이션·제스처 | react-native-reanimated + react-native-gesture-handler + @gorhom/bottom-sheet | 바텀시트(제휴 고지·외부 지도 선택·필터)가 전역 UI 패턴. 네이티브 모듈이라 최초 스캐폴드에 포함 — 나중에 추가하면 EAS 재빌드 유발 |
| 크래시 리포팅 | Sentry (@sentry/react-native + Expo config plugin) | 크래시·JS 오류·성능 수집. `beforeSend` 스크러빙으로 토큰·PII 차단 — "크래시 리포트에 토큰 미포함" 불변식의 집행 지점 |
| 기기 능력 | expo-notifications(푸시, FCM/APNs) · expo-location(위치, 포그라운드 한정) · @react-native-community/netinfo(네트워크 상태) | `features/notification`·`shared/location`의 구현 스택. netinfo는 오프라인 큐 복구 감지 트리거 |
| 스타일링 | NativeWind 4 — **tailwindcss는 3.4.x 고정(4.x 비호환)** | 디자인 토큰을 tailwind.config로 일원화, 화면 양산 속도. 공용 컴포넌트는 `shared/ui` 경유 |
| API 클라이언트 | orval 코드젠 — `backend/docs/design/openapi.yaml` → axios 클라이언트 + TanStack Query 훅 + Zod 스키마 | 클라이언트 타입 ↔ 스펙 문서의 drift 차단. §API 계층 참고 |
| 패키지 매니저 | pnpm | 속도·엄격한 의존성 해석 |
| 테스트 | Jest(jest-expo) + fast-check(PBT) + React Native Testing Library | §테스트 전략 참고 |
| 품질 | ESLint + Prettier + TypeScript strict + import 경계 린트 | §린트·포맷 참고 |

## 디렉토리 구조

frontend/ 루트가 곧 Expo 프로젝트이며(모노레포 구조는 inception unit-of-work 정합), 앱 소스는 전부 `src/` 아래에 둔다(Expo Router가 `src/app`을 자동 인식). 루트에는 설정 파일과 인프라 스텁·문서만 남긴다.

```text
frontend/
  src/
    app/          # Expo Router 라우트 — 얇은 래퍼만. 화면 구현은 features/에서 import
    features/     # 기능 10개 (에픽·서버 모듈 경계에 대응)
      onboarding/ home/ stay/ trip/ itinerary/
      execution/ planb/ archive/ notification/ settings/
    shared/       # 횡단 6개
      api/        # 서버 클라이언트 단일 계층 — orval 생성물 + axios 인스턴스(토큰 회전)
                  # + 부트스트랩 + 모든 API 실패를 표준 오류 타입으로 정규화
      ui/         # 디자인 시스템·공용 탭바(5탭)·빈 상태/로딩/오류 표준 패턴·접근성 기준
      map/        # 카카오 지도 SDK 브리지(config plugin)·지도 렌더·경로 레이어·외부 지도앱 연동
      location/   # 위치 권한·수집 단일 소유(동의 상태 관리·프리프롬프트·포그라운드 수집)
      validation/ # 경량 제약 검증기 — 서버 발행 규칙 명세 소비, 위반은 경고 배지(차단 아님)
      storage/    # 로컬 영속 단일 소유 — 오프라인 입력 큐·사진 업로드 대기 큐
    assets/       # 아이콘·스플래시 등 (app.json에서 상대 경로 참조)
  package.json / app.json / eas.json / tailwind.config.js / tsconfig.json
  Dockerfile / nginx.conf / web/   # 통합 테스트 스텁 (앱 코드 아님)
  docs/                            # 화면 IO 카탈로그
```

feature 내부 관례: `screens/ components/ containers/ hooks/ store/ model/ lib/` — 화면·상태·도메인 로직을 feature 안에 응집. (`containers/`=훅↔화면을 잇는 접착 컨테이너 — `screens/`는 props만 받는 프레젠테이션으로 유지. `lib/`=순수함수가 아닌 팩토리·유틸(예: env 토글로 fake/real을 고르는 `makeAuthorize`). 모든 폴더가 필수는 아니며 넣을 것이 생길 때 만든다.)

### import 경계 규칙 (ESLint로 강제)

- 의존 방향: `app/` → `features/` / `shared/`, `features/` → `shared/`. (`app/`은 레이아웃·프로바이더 구성을 위해 shared를 직접 import할 수 있다)
- **features 간 직접 import 금지.** 기능 간 화면 이동은 라우팅으로, 데이터 공유는 `shared/api` 훅으로 해결된다.
- **승격 규칙**: 두 개 이상의 feature가 쓰게 된 컴포넌트·로직은 `shared/`로 승격한다. 예: 일정 지도 뷰(순서 핀·동선)는 itinerary와 execution이 함께 쓰므로 처음부터 `shared/map` 소유.
- `shared/`는 `features/`를 모른다.
- 절대 경로 별칭 `@/` = `src/` (tsconfig paths — `@/features/...`, `@/shared/...`).

### 상태 관리 규칙

- 서버 데이터의 단일 소유자는 TanStack Query 캐시다. **서버 응답을 Zustand 스토어에 복사하지 않는다** — 상태 원본이 둘이 되는 순간 동기화 버그가 시작된다.
- Zustand에는 서버가 모르는 UI 상태만 둔다(위저드 진행 단계, 선택·토글, 바텀시트 열림 등).
- 탭 상태 보존은 세션 내 메모리로만 — 앱 재시작 시 초기화, 영속 저장하지 않는다.

## API 계층

- `shared/api`가 서버 통신의 단일 계층. orval이 `backend/docs/design/openapi.yaml`에서 axios 클라이언트·TanStack Query 훅·Zod 스키마를 생성한다.
  - ⚠️ **Zod 스키마 생성은 아직 배선되지 않았다**(TRIP-179 기준 — `orval.config.ts`는 axios 클라이언트 + TanStack Query 훅까지만 생성한다). 아래 Zod 런타임 검증(§74~75)은 그 배선이 붙는 후속 티켓 범위다.
- **생성물은 커밋한다** (`shared/api/generated/`). 재생성은 `pnpm codegen` — 스펙 변경 PR과 생성물 갱신을 같은 커밋으로.
- **코드젠이 보장하는 건 "클라이언트 ↔ 스펙 문서" 정합까지다.** 스펙 ↔ 실제 서버 구현의 정합은 서버 쪽 책임(계약 테스트 등)이며, 클라이언트는 이를 신뢰하되 Zod 런타임 검증으로 안전망을 둔다.
- Zod 응답 검증 적용 지점: **개발 모드에서는 전 응답, 프로덕션에서는 핵심 API(부트스트랩·일정·인증)만** — 성능과 안전의 절충.
- 모든 API 실패는 `shared/api`에서 표준 오류 타입으로 정규화한다. 화면은 오류 코드 분기만 하고, 원시 axios 에러를 직접 다루지 않는다.
- **AI 실시간 스트리밍 경로**: 일정 생성 진행 표시 등 스트리밍 응답은 orval 밖의 수기 클라이언트(`expo/fetch` — SSE/청크 파싱)로 처리한다. 토큰 첨부·표준 오류 정규화는 REST 경로와 같은 계층을 공유하며, 서버 API가 폴링으로 확정되면 이 경로는 제거한다.

## 아키텍처 규칙 (클라이언트 불변식)

- **서버 권위**: 판정의 정본은 항상 서버. `shared/validation`의 경량 검증은 경고 배지이며 저장을 차단하지 않는다. 규칙 명세 버전이 서버와 불일치하면 로컬 검사는 보수적으로 비활성화.
- **AI 계층 계약** (`ai/README.md`): 이동 구간에 소요 시간(duration)을 표시하지 않는다 — 거리만. 사용자에게 보이는 시각·순서는 서버(솔버)가 검증한 값만 렌더링한다.
- **토큰**: OS 보안 저장소에만 저장, 로그아웃·401 확정 시 즉시 삭제, 로그·크래시 리포트에 미포함(Sentry `beforeSend` 스크러빙으로 집행).
- **스플래시 게이트**: 부트스트랩 1왕복 후 목적지 분기(강제 업데이트 → 세션 → 온보딩 잔여 → 홈)는 부수효과 없는 순수 함수로 구현(PBT 대상). 타임아웃 시 로컬 폴백 — 무한 스플래시 금지.
- **딥링크 인증 가드**: 비로그인 딥링크 진입은 초대·공유 화면에 한정. 그 외는 레이아웃 레벨 인증 가드가 로그인 리다이렉트 후 원 목적지로 복귀. 클라이언트 가드는 1차일 뿐, 리소스 접근 권한 검증은 서버가 한다.
- **오프라인**: 일정 조회 오프라인 캐시는 제공하지 않는다. 기록 입력(방문 체크·사진·메모)만 로컬 큐에 쌓고 복구 시 배치 동기화, 충돌은 사용자 선택.

## 환경 구성

- 환경 3종: `development` / `preview` / `production` — `eas.json` 프로파일과 1:1.
- API base URL 등 환경값은 `app.config.ts` + EAS 환경변수로 주입. 코드에 하드코딩 금지, `.env`는 로컬 개발 편의용(미커밋).
- 앱에는 시크릿을 두지 않는다(소셜 로그인은 PKCE, 교환은 서버). 지도 앱 키 등은 EAS 시크릿으로 빌드 시 주입.
- **예외(D5 · TRIP-210)**: 네이버 네이티브 SDK(`@react-native-seoul/naver-login`)의 `initialize()`는 `consumerSecret`을 **필수 파라미터**로 요구한다 — 서버 교환 없이 SDK 초기화 시점에 바로 필요하므로 PKCE로 피할 수 없는 SDK 자체의 제약이다. 값은 하드코딩하지 않고 `EXPO_PUBLIC_NAVER_CLIENT_SECRET`(env)으로만 전달한다(`.env`에만 실값, `.env.example`은 이름만). 서버 쪽 access token 검증(BR-U0-02 fail-closed)은 이 값과 무관하게 그대로 유지되므로 보안 경계는 서버가 여전히 지킨다. 카카오 어댑터는 이 예외가 없다(시크릿 0).

## 테스트 전략

4층 피라미드. 모든 층에서 실제 외부 API 호출 0 — 서버 API는 목/fake만 사용.

| 층 | 대상 | 도구 | 비고 |
|---|---|---|---|
| 순수 함수 + PBT | `model/`·판정 함수(스플래시 분기·버전 비교·날짜 겹침 등) | Jest + fast-check | 판정 로직은 순수 함수로 분리해 PBT 대상으로 — 시드 로깅·shrinking으로 재현 가능 |
| 훅 | `hooks/` TanStack Query 훅 | Jest `renderHook` + API 목 | QueryClient 래퍼로 격리 |
| 컴포넌트/화면 | `screens/`·`components/` | React Native Testing Library | testID 규약 `{feature}-{screen}-{role}`(예: `execution-hub-timeline`) — testID 부여는 스펙의 일부 |
| UI E2E | 핵심 해피패스 **1~2개만** | 미정 (Maestro/Detox — 여행 중 실행 기능 개발 시점에 결정) | 시나리오 검증 본체는 백엔드 API 레벨 E2E가 담당 |

- 테스트 파일은 소스 옆에 배치 (`foo.ts` ↔ `foo.test.ts`).
- CI(`.github/workflows/frontend-ci.yml`, 경로 필터 `frontend/**`): `tsc` · ESLint · Jest+fast-check — 머지 게이트.

## 린트·포맷

프론트 전용 설정 — `frontend/` 안에 두고 그 안에서만 적용한다. 백엔드(Kotlin, ktlint/detekt 계열)와 도구·설정 완전 분리.

- **ESLint** (`eslint.config.js`): `eslint-config-expo` 베이스 + import 경계 규칙(§import 경계) + NativeWind 클래스 정렬 플러그인
- **Prettier** (`.prettierrc`): 포맷 전담
- Biome 등 통합 도구 미채택 — Expo 공식 프리셋·NativeWind·경계 강제 플러그인이 전부 ESLint 생태계
- 스크립트: `pnpm lint` / `pnpm format`

## 빌드·실행 (스캐폴드 후)

```bash
pnpm install
pnpm codegen              # openapi.yaml → shared/api/generated (스펙 변경 시)
pnpm expo prebuild        # config plugin (카카오 지도 SDK 등) 반영
pnpm expo run:ios         # 또는 run:android — development build
pnpm test                 # Jest + fast-check
pnpm lint && pnpm tsc --noEmit
```

- **`ios/`·`android/` 네이티브 프로젝트는 커밋하지 않는다** — prebuild 산출물이며 EAS 원격 빌드에서 재현된다(CNG). `.gitignore`에 포함.
- EAS Build 프로파일 3종: development / preview / production (`eas.json`). CI 성공 후 수동 트리거.
- 네이티브 모듈 추가(지도 SDK·expo-location·expo-notifications 등)는 EAS 재빌드 필요, 순수 JS/TS 변경은 OTA 대상.

## 문서

- 화면 명세: **Figma가 유일한 정본** (리포에 사본 없음). 밴드 맵·파일 키: `.claude/skills/spec-perception/reference/figma-structure.md`
- 기획 참조: 리포 루트 `aidlc/aidlc-docs/inception/` — requirements(요구사항)·user-stories(스토리 119개)·application-design(컴포넌트·유닛 설계)
- API 스키마: `backend/docs/design/openapi.yaml` (orval 입력)
- AI 계층 계약: `ai/README.md`

## 통합 테스트 스텁

`Dockerfile`·`nginx.conf`·`web/`은 로컬 통합 스택(docker-compose)용 최소 스텁이다(nginx 정적 + `/api` 프록시). 실제 Expo Web export로 후속 교체 예정이며, 네이티브 앱 개발은 호스트(시뮬레이터)에서 한다.
