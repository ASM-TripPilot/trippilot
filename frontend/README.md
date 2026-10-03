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

frontend/ 루트가 곧 Expo 프로젝트이며(모노레포 구조는 inception unit-of-work 정합), 라우팅은 루트 `app/`(Expo Router), 앱 소스(FSD 층)는 전부 `src/` 아래에 둔다. 루트에는 그 밖에 설정 파일과 인프라 스텁·문서만 남긴다.

구조의 정본은 **공식 Feature-Sliced Design v2.1**(fsd.how)이다. 아래 규칙은 그 공식 규칙을 이 리포에 적용한 결정이며, 공식과 다르게 가는 곳은 이유와 함께 명시한다(TRIP-1138 · 결정 원문 TRIP-1139).

```text
frontend/
  app/            # Expo Router 라우트 전용 (FSD 층 아님) — 라우트 파일은 pages를 꽂는 얇은 래퍼
  src/            # FSD 층만
    app/          # FSD app 층 — 전역 프로바이더·루트 셸(스플래시 게이트)·전역 폰트/스타일. 슬라이스 없이 세그먼트로만
    pages/        # 화면 — 라우트 하나가 꽂는 슬라이스. 그 화면만 쓰는 UI·상태·요청 조합을 전부 소유한다
                  # 슬라이스는 여정 단계 그룹 폴더 아래 `pages/<그룹>/<slice>`(home·magazine은 그룹 없음, §층 규칙 「슬라이스 그룹」)
    widgets/      # 공식 비권장 — 새로 만드는 건 조건부(§층 규칙)
    features/     # 여러 화면이 공유하는 사용자 행동 (목록·수 정본: src/features 디렉토리 · docs/structure.generated.md)
    entities/     # 여러 화면이 공유하는 도메인 모델 (목록·수 정본: src/entities 디렉토리 · docs/structure.generated.md)
    shared/       # 업무 규칙 없는 인프라 (세그먼트 정본: docs/structure.generated.md)
      api/        # 서버 클라이언트 단일 계층 — orval 생성물 + axios 인스턴스(토큰 회전)
                  # + 부트스트랩 + 모든 API 실패를 표준 오류 타입으로 정규화
      ui/         # 디자인 시스템·공용 탭바(5탭)·빈 상태/로딩/오류 표준 패턴·접근성 기준
      map/        # 네이버 지도 SDK(네이티브·config plugin)·지도 렌더·경로 레이어·외부 지도앱 연동
      location/   # 위치 권한·수집 단일 소유(동의 상태 관리·프리프롬프트·포그라운드 수집)
      lib/        # 업무 규칙 없는 유틸 — 경량 제약 검증기(닉네임 형식)도 여기, 위반은 경고 배지(차단 아님)
      storage/    # 로컬 영속 단일 소유 — 오프라인 입력 큐·사진 업로드 대기 큐
  package.json / app.json / eas.json / tailwind.config.js / tsconfig.json
  Dockerfile / nginx.conf / web/   # 통합 테스트 스텁 (앱 코드 아님)
  docs/                            # 개발로그·구조 지도
```

> **지금 코드와 다른 곳 (이주 중)**: 위 트리는 목표다. `shared`는 15개 폴더로 트리보다 많고 일부는 `lib`로 모을 유틸이다 — TRIP-1162. features에 화면이 들어 있는 곳은 화면 묶음 단위로 pages로 옮긴다 — TRIP-1146~1154.

### 층 규칙

- **pages first**: 새 코드는 먼저 그 코드를 쓰는 `pages/<slice>`(그룹이 있으면 `pages/<그룹>/<slice>`)에 둔다. 페이지 사이의 중복은 그 자체로 추출 사유가 아니다. 아래 **세 조건을 모두** 만족할 때만 더 아래 층으로 뺀다.
  1. **지금** 여러 곳이 쓴다(가정이 아니라 실제로).
  2. 특정 소비처와 **독립된 변경 이유**가 있다.
  3. 경계의 책임이 **좁다**.
  
  애매하면 pages에 둔다. 한 곳만 쓰는 feature·entity·widget은 그 소비처로 되돌린다.
- **어느 층으로 빼는가**: 여러 화면이 공유하는 사용자 행동(행동 + 그 UI)은 `features`, 도메인 모델은 `entities`, 업무 규칙이 없는 부품·유틸·API 클라이언트는 `shared`, 앱 전역 설정·레이아웃은 `app`. 업무 규칙(제품이 자기 데이터에 거는 규칙)은 `shared`에 두지 않는다.
- **widgets**: 공식이 비권장하는 층이다(적극 도입하지 말 것을 권하되, 기존 슬라이스는 유효). 새 widget은 기본적으로 만들지 않고, 먼저 pages·app에서 조립(Strategy C)하거나 features·shared로 보낸다. 그래도 아래를 **모두** 만족하면 만든다 — ① 추출 규칙 세 조건 ② 여러 feature를 엮는 UI 덩어리라 features·shared 어디에도 맞지 않는다 ③ page에서 조립하면 여러 화면에 같은 조립 코드가 반복된다. 만들 때는 그 이유를 슬라이스 안 주석으로 남긴다. 여러 화면이 쓰는 기존 두 슬라이스(`map-sheet-shell` · `time-sheet`)는 유지하고, 한 화면만 쓰는 슬라이스는 그 page로 되돌린다(TRIP-1143).
- **entities**: 조심해서 쓴다 — 거의 모든 층이 보는 층이라 변경이 넓게 퍼진다. 순수 CRUD·전송 타입(DTO)은 entity가 아니라 `shared/api` 소관이다(점검은 TRIP-1155).
- **슬라이스 그룹**: pages는 여정 단계로 묶는다 — `auth · onboarding · explore · stay · trip · itinerary · live · record · settings`(TRIP-1156). 그룹 폴더는 탐색용일 뿐이라 그 자체에 세그먼트·`index.ts`를 두지 않는다.
- **라우팅 폴더 ≠ FSD app 층**: Expo Router의 라우트 폴더(루트 `app/`)는 프레임워크 영역이고 FSD 층이 아니다. 라우트 파일에는 로직을 두지 않고 `src/pages`의 화면을 꽂기만 한다. FSD app 층(`src/app/`)과 `shared`는 슬라이스 없이 세그먼트로만 구성하며, 세그먼트 이름은 주제가 아니라 목적(`ui`·`api`·`lib`·`config`, 인프라 세그먼트 `map`·`location`·`push` 등)으로 짓는다 — 날짜·버전 비교 같은 유틸은 `shared/lib`.
- **자산**: 이미지·아이콘은 쓰는 코드 옆에 둔다(여러 곳이 쓰면 `shared`). 전역 폰트·스타일은 `app`. 최상위 `assets/` 세그먼트는 만들지 않는다. 예외: `app.json`/`app.config.ts`가 참조하는 앱 아이콘·스플래시.
- **세그먼트**: 슬라이스 내부는 `ui`(화면·컴포넌트) / `model`(상태·도메인 타입·업무 규칙) / `api`(요청) / `lib`(슬라이스 내부 헬퍼) / `config`(상수·라벨·환경값). 필요할 때만 만든다. 파일 이름은 역할(`types.ts`·`utils.ts`)이 아니라 도메인으로 짓는다.
- **`api` 세그먼트와 orval**: orval 생성물은 `shared/api` 한 곳에만 둔다(스펙 드리프트 차단). 한 페이지만 쓰는 요청 조합·응답 변환·쿼리 키 래퍼는 그 페이지의 `api/`에 둔다. 여러 슬라이스가 쓰게 되면 `shared/api`로 내린다.

### import 경계 규칙 (ESLint로 강제)

- **층 방향**: `app → pages → widgets → features → entities → shared`. 각 층은 자기보다 **아래 층만** import한다. `eslint.config.js`의 `import/no-restricted-paths` 층 zone이 강제하고, 슬라이스별 zone은 `src/<층>` 디렉토리를 읽어 생성한다(새 슬라이스 자동 편입). 세그먼트 폴더나 `index.ts`가 없는 폴더는 슬라이스 그룹으로 보고 그 아래 슬라이스를 읽는다 — 같은 그룹 형제끼리도 격리된다.
- **같은 층 형제 슬라이스는 서로 모른다(엄격)**: 형제 직접 import는 lint error다. 공유가 필요하면 순서대로 푼다 — ① 늘 같이 바뀌면 두 슬라이스를 합친다 ② 공유 도메인 책임은 entity로 내린다 ③ 위 층(pages·app)이 두 슬라이스를 받아 조립한다(props·slot) ④ 그래도 불가피하면 상대 슬라이스의 **공개 API(`index.ts`)로만** 받고, 왜 ①~③이 안 되는지 코드 주석으로 남긴다.
- **entities 교차는 `@x`로만**: 도메인끼리 꼭 참조해야 하면 제공자가 소비자에게만 내주는 `entities/<제공자>/@x/<소비자>/**` 창구를 쓴다(형식 예: `entities/place/@x/itinerary-slot/` — 지금 리포에 `@x` 폴더는 0개, entity 간 import도 0건). 먼저 두 entity를 합칠 수 없는지부터 본다 — `@x`는 마지막 수단이고 features·widgets에는 쓰지 않는다.
- **공개 API(`index.ts`)**: 슬라이스 밖에서는 그 슬라이스의 `index.ts`로만 import한다. `shared`는 슬라이스가 없으므로 세그먼트(또는 컴포넌트 폴더)마다 `index.ts`를 둔다.
  - **딥 임포트 금지(TRIP-1157)**: 슬라이스 밖에서 `@/features/home/ui/HomeGlyphs`처럼 내부 파일을 직접 물면 lint error다. 진입점은 슬라이스(또는 shared 세그먼트) 루트의 `index.ts`와 `index.<이름>.ts`(`index.view`·`index.schemas`·`index.hooks`)뿐이다. shared/ui·shared/lib 루트 직속 파일은 세그먼트 index 없이 직접 import한다.
  - **두 번째 진입점 `index.view.ts`**: 네트워크·컨테이너를 싣는 슬라이스는 순수 뷰·글리프·config·순수 model만 모은 `index.view.ts`를 따로 둔다. 개발 프리뷰처럼 네트워크 없이 그려야 하는 소비자는 이것을 문다 — `index.ts`를 물면 슬라이스 전체가 평가돼 프리뷰 지뢰(`devPreviewReleaseGate`)가 터진다. 새 공개 심볼을 view에도 넣을지는 "그 정의 모듈이 네트워크·컨테이너에 닿는가"로만 정한다. 타입은 `export type { … }`으로 낸다 — `export { T } from`은 타입이어도 런타임 `require`로 남는다.
  - **shared/api는 세 진입점**: 본체 `@/shared/api`(클라이언트·토큰·에러 헬퍼) · `@/shared/api/index.schemas`(생성 타입) · `@/shared/api/index.hooks`(생성 react-query 훅 — 물면 네트워크 계층이 실린다). 본체 index로 되돌아오는 헬퍼는 순환을 피해 hooks 진입점으로 낸다.
  - **테스트**: `jest.mock`·`jest.requireActual` 등 jest 계열 지정자, 목 타이핑(`typeof import`)·`spyOn` 대상 네임스페이스, 공개 API에 없는 테스트 전용 심볼은 정의 모듈(딥 경로)을 겨눈다 — 테스트 때문에 index를 넓히지 않는다. 배럴을 통째로 목으로 바꾸는 테스트는 팩토리 맨 앞에서 `jest.requireActual`로 실물을 펼친 뒤 덮는다(재수출이 늘 때 형제 export가 `undefined`가 되지 않게).
  - 현재: pages 53 · features 25 · widgets 2 · entities 5 슬라이스 전부가 루트 `index.ts`를 가진다. shared는 세그먼트(또는 `ui/pref` 같은 컴포넌트 폴더)마다 `index.ts`를 두고, `index.view.ts`는 15개(features 13 · `shared/location` · `shared/push`)다.
- **이주 방식**: 화면 묶음 단위로 옮긴다(TRIP-1138 · 서브 1146~1154) — 테스트 정상화를 먼저 하고 그 화면의 이동을 뒤 커밋으로.
- **린터**: 경계는 두 도구가 나눠 지킨다 — ESLint zone은 import 줄(층 방향·형제 격리·딥 임포트 금지), 공식 FSD 린터 Steiger(`pnpm fsd`, `steiger.config.ts`)는 폴더·슬라이스 배치(권장 설정 `fsd.configs.recommended` 전 규칙)를 본다. 둘 다 CI 머지 게이트다(TRIP-1158) — 구조 소스 스캔은 TRIP-1145에서 지웠다. Steiger 예외는 셋뿐이고 설정 파일 주석과 같다: ① 테스트는 검사 대상에서 뺀다(아래 「테스트」대로 딥 경로가 설계, ESLint 면제 범위와 같음 — 다시 켤 조건 없음. 개발 프리뷰 `app/_dev/**`는 라우트 폴더라 애초에 `steiger ./src` 밖) ② `src/features`의 `excessive-slicing`을 끈다(25개 > 20, 다시 켤 조건 features ≤ 20 — TRIP-1159 껍데기 정리) ③ `pages/itinerary`·`pages/onboarding` 그룹의 `repetitive-naming`을 끈다(접두를 떼면 16개 개명 + shared 세그먼트와 이름 충돌 — 다시 켤 조건 두 그룹 접두 제거, 별 티켓). 딥 임포트 금지 zone(TRIP-1157)은 프로덕션 파일(라우트 `app/**` 포함)에만 걸고 테스트·`app/_dev/**`는 면제한다. 같은 룰 ID라 층 zone과 한 블록에 함께 펼친다(flat config는 같은 규칙을 거는 뒤 블록이 앞을 덮어쓴다). `import/no-cycle`은 상시 lint에 없다 — 자기 슬라이스 index를 물어 순환을 만들어도 `pnpm lint`는 침묵한다.
- **`app → features` 제한은 두지 않는다** — 공식 FSD는 app 층이 아래 층 전부를 import하는 것을 허용한다. 라우트 파일은 page를 꽂는 얇은 래퍼로 두는 것을 권장한다(lint 강제 없음, TRIP-1142).
- 절대 경로 별칭 `@/` = `src/` (tsconfig paths — `@/features/...`, `@/shared/...`).

### 상태 관리 규칙

- 서버 데이터의 단일 소유자는 TanStack Query 캐시다. **서버 응답을 Zustand 스토어에 복사하지 않는다** — 상태 원본이 둘이 되는 순간 동기화 버그가 시작된다.
- Zustand에는 서버가 모르는 UI 상태만 둔다(위저드 진행 단계, 선택·토글, 바텀시트 열림 등).
- 탭 상태 보존은 세션 내 메모리로만 — 앱 재시작 시 초기화, 영속 저장하지 않는다.

## API 계층

- `shared/api`가 서버 통신의 단일 계층. orval이 `backend/docs/design/openapi.yaml`에서 axios 클라이언트·TanStack Query 훅·Zod 스키마를 생성한다.
  - ⚠️ **Zod 스키마 생성은 아직 배선되지 않았다**(TRIP-179 기준 — `orval.config.ts`는 axios 클라이언트 + TanStack Query 훅까지만 생성한다). 아래 Zod 런타임 검증(바로 아래 "Zod 응답 검증 적용 지점" 항목)은 그 배선이 붙는 후속 티켓 범위다.
- **생성물은 커밋한다** (`shared/api/generated/`). 재생성은 `pnpm codegen` — 스펙 변경 PR과 생성물 갱신을 같은 커밋으로.
- **코드젠이 보장하는 건 "클라이언트 ↔ 스펙 문서" 정합까지다.** 스펙 ↔ 실제 서버 구현의 정합은 서버 쪽 책임(계약 테스트 등)이며, 클라이언트는 이를 신뢰하되 Zod 런타임 검증으로 안전망을 둔다.
- Zod 응답 검증 적용 지점: **개발 모드에서는 전 응답, 프로덕션에서는 핵심 API(부트스트랩·일정·인증)만** — 성능과 안전의 절충.
- 모든 API 실패는 `shared/api`에서 표준 오류 타입으로 정규화한다. 화면은 오류 코드 분기만 하고, 원시 axios 에러를 직접 다루지 않는다.
- **AI 실시간 스트리밍 경로**: 일정 생성 진행 표시 등 스트리밍 응답은 orval 밖의 수기 클라이언트(`expo/fetch` — SSE/청크 파싱)로 처리한다. 토큰 첨부·표준 오류 정규화는 REST 경로와 같은 계층을 공유하며, 서버 API가 폴링으로 확정되면 이 경로는 제거한다.

## 아키텍처 규칙 (클라이언트 불변식)

- **서버 권위**: 판정의 정본은 항상 서버. `shared/lib`의 경량 검증(닉네임 형식)은 경고 배지이며 저장을 차단하지 않는다. 규칙 명세 버전이 서버와 불일치하면 로컬 검사는 보수적으로 비활성화.
- **AI 계층 계약** (`ai/README.md`): 이동 구간에 소요 시간(duration)을 표시하지 않는다 — 거리만. 사용자에게 보이는 시각·순서는 서버(솔버)가 검증한 값만 렌더링한다.
- **토큰**: OS 보안 저장소에만 저장, 로그아웃·401 확정 시 즉시 삭제, 로그·크래시 리포트에 미포함(Sentry `beforeSend` 스크러빙으로 집행).
- **스플래시 게이트**: 부트스트랩 1왕복 후 목적지 분기(강제 업데이트 → 세션 → 온보딩 잔여 → 홈)는 부수효과 없는 순수 함수로 구현(PBT 대상). 타임아웃 시 로컬 폴백 — 무한 스플래시 금지.
- **딥링크 인증 가드**: 비로그인 딥링크 진입은 초대·공유 화면에 한정. 그 외는 레이아웃 레벨 인증 가드가 로그인 리다이렉트 후 원 목적지로 복귀. 클라이언트 가드는 1차일 뿐, 리소스 접근 권한 검증은 서버가 한다.
- **오프라인**: 일정 조회 오프라인 캐시는 제공하지 않는다. 기록 입력(방문 체크·사진·메모)만 로컬 큐에 쌓고 복구 시 배치 동기화, 충돌은 사용자 선택.

## 환경 구성

- 환경 3종: `development` / `preview` / `production` — `eas.json` 프로파일과 1:1.
- API base URL 등 환경값은 `app.config.ts` + EAS 환경변수로 주입. 코드에 하드코딩 금지, `.env`는 로컬 개발 편의용(미커밋).
- 앱에는 시크릿을 두지 않는다(소셜 로그인은 PKCE, 교환은 서버). 지도 앱 키 등은 EAS 시크릿으로 빌드 시 주입.
- **구글 로그인(TRIP-1057)**: Google Cloud 콘솔의 **iOS 유형 OAuth 클라이언트**(번들 ID `com.trippilot.travel`)를 쓴다 — 시크릿 없는 공개 클라이언트라 앱은 PKCE 로 인가 코드만 받고 교환은 서버가 한다. **앱과 백엔드가 같은 클라이언트 ID** 를 쓰고(`EXPO_PUBLIC_GOOGLE_CLIENT_ID` ↔ 루트 `.env` `GOOGLE_CLIENT_ID`), 백엔드 `GOOGLE_CLIENT_SECRET` 은 **비운다**(보내면 `invalid_client` — 루트 `.env.example` 주석). redirect 는 iOS 클라이언트의 역방향 스킴 `com.googleusercontent.apps.{ID 앞부분}:/oauthredirect`. 변수 이름·형식은 `frontend/.env.example`. env 를 바꾸면 Metro `--clear` 로 다시 띄운다(인라인 치환).
- **예외(D5 · TRIP-210)**: 네이버 네이티브 SDK(`@react-native-seoul/naver-login`)의 `initialize()`는 `consumerSecret`을 **필수 파라미터**로 요구한다 — 서버 교환 없이 SDK 초기화 시점에 바로 필요하므로 PKCE로 피할 수 없는 SDK 자체의 제약이다. 값은 하드코딩하지 않고 `EXPO_PUBLIC_NAVER_CLIENT_SECRET`(env)으로만 전달한다(`.env`에만 실값, `.env.example`은 이름만). 서버 쪽 access token 검증(BR-U0-02 fail-closed)은 이 값과 무관하게 그대로 유지되므로 보안 경계는 서버가 여전히 지킨다. 카카오 어댑터는 이 예외가 없다(시크릿 0).

## 테스트 전략

모든 층에서 실제 외부 API 호출 0 — 서버 API는 목/fake(MSW)만 사용한다. 이 절은 **어떤 테스트를 어디에 두고, 기존 테스트를 남길지·합칠지·지울지**를 가르는 기준이다(TRIP-1140 · 정리 작업은 TRIP-1138).

### 무엇을 어디에

| 대상 | 층 | 파일 | 도구 |
|---|---|---|---|
| 화면 — 렌더·탭·결과 | `pages/<slice>` (이주 중에는 화면이 있는 곳) | **단위 1** + **통합 1** `XxxPage.integration.test.tsx`. 단위는 화면을 실제로 그리는 컴포넌트에 붙인다 — page가 직접 그리면 `XxxPage.test.tsx`, props만 받는 뷰에 맡기면 **뷰마다** `XxxScreen.test.tsx`(뷰가 하나여도 같다 — 이때 `XxxPage.test.tsx`는 두지 않는다). 뷰 테스트를 page 이름으로 바꿔 합치지 않는다 | React Native Testing Library · 통합은 MSW |
| 판정 로직(순수 함수) | 로직이 있는 슬라이스의 `model/`·`lib/` | 옆에 `foo.test.ts` | Jest |
| 판정 로직의 속성 | 위와 같음 | 함수(또는 함수 묶음)당 PBT 1파일 | fast-check |
| 출시·보안 계약(ESLint로 표현 못 하는 것) | `src/__tests__` | 아래 판정 3의 남은 목록 | 소스 스캔 |
| 출시·보안 금지(ESLint로 표현되는 것) | `eslint.config.js` | 규칙 발동 탐침은 `importBoundaryLayers.test.ts` | ESLint `lintText` |
| 개발 도구(`_dev` 프리뷰) | `src/__tests__`(라우트 폴더 `app/` 안은 라우트로 등록돼 못 둔다) | 스모크 1파일 `devPreviewReleaseGate.test.tsx` | RNTL |
| UI E2E | 핵심 해피패스 **1~2개만** | `.maestro/flows/M-*.yaml` | Maestro(로컬 전용·CI 미편입, 아래 불릿). 시나리오 검증 본체는 백엔드 API E2E |

- 테스트 파일은 소스 옆에 둔다(`foo.ts` ↔ `foo.test.ts`). jest 설정이 둘이라(`jest.config.js` node · `jest.integration.config.js` MSW) 통합 테스트는 `.integration.test`로 파일이 갈린다. 둘 다 돌리려면 `pnpm test`(한쪽만 부르면 다른 쪽이 0건인 채 green으로 보인다).
- **버킷 예외 — node 버킷이어야 하는 page 배선 테스트는 `XxxPage.test.tsx`**(TRIP-1146): `await import`로만 닿는 모듈(integration 버킷에선 그 자리에서 동기 throw)이나 생성 훅·스토어 목으로 page 배선을 보는 테스트는 integration 버킷으로 못 가므로 `.integration` 없이 둔다(예: `PrefStep1Page.test.tsx`·`ReconsentPage.test.tsx`). 같은 page에 통합 파일이 따로 있으면 버킷 사유를 접미사로 남긴다(`LoginPage.apple.test.tsx` — 애플 SDK lazy import).
- testID 규약 `{feature}-{screen}-{role}`(예: `execution-hub-timeline`) — testID 부여는 스펙의 일부다.
- **UI E2E(Maestro, TRIP-1168)**: `frontend/.maestro/`, 실행은 `.maestro/run-each.sh [플로우 파일…]`로 **한 플로우씩**(폴더째 실행 금지 — iOS 드라이버가 두 번째 플로우부터 죽는다, Maestro #3318). 선택자는 `id:`(testID) 우선, `launchApp`에 `clearState` 금지(시뮬레이터 로그인 세션이 지워진다). 로그인 세션·실 백엔드가 필요해 **로컬 전용·CI 미편입**. 준비·`known-bug/`·`opt-in/` 은 `.maestro/README.md`.
- CI(`.github/workflows/frontend-ci.yml`, 경로 필터 `frontend/**`): ESLint · `tsc` · Steiger(`pnpm fsd`) · 구조 지도 드리프트(`structure-index.cjs --write`·`--check`) · Jest(두 버킷)+fast-check — 머지 게이트.

### 남김·합침·지움 판정

테스트 파일 하나를 들고 오면 위에서부터 첫 번째로 맞는 줄을 따른다.

1. **PBT** → property(`fc.assert`)는 **하나도 지우지 않는다**(루트 CLAUDE.md — PBT는 차단 게이트). 같은 함수를 보는 PBT가 여러 파일이면 한 파일로 **합친다**.
2. **개발 도구(`_dev` 프리뷰) 테스트** → **스모크 1파일만 남기고 지운다** — 프리뷰 화면이 뜨고, 키 장부에 중복이 없고, 없는 키는 splash로 떨어지는지만 본다(키별 렌더 없음). 운영 빌드에서 프리뷰를 막는 출시 계약도 같은 파일에 있다. 프리뷰는 사람이 눈으로 보는 도구라 세부 동작 검사는 실제 화면 테스트의 몫이다.
3. **소스 스캔**(파일을 텍스트로 읽고 렌더하지 않는 테스트) — 기능이 구현·QA된 뒤의 회귀 감시는 스캔이 아니라 QA가 맡는다(TRIP-1145).
   - **출시·보안 계약**(키·시크릿이 git에 안 들어감, 출시 빌드 설정, API 명세, 운영 빌드의 프리뷰 차단, 법정 동의·고지, 사진·공유 카드 서버 업로드 금지) → ESLint로 표현되면 **ESLint 규칙으로 옮기고** 규칙 발동을 `importBoundaryLayers.test.ts`의 `lintText` 탐침으로 지킨다. 표현 못 하면 **남긴다**. 지금 남은 스캔: `socialSdkSecrets`·`mapBridgeStructure`·`releaseBuildConfig`·`openapiContract`·`devPreviewReleaseGate`·`recordPhotoBinaryGuard`·`shareCardStructure`·`locationConsentPutBodyOwnership`·`deletionScopeStructure`·`importBoundaryLayers`(모두 `src/__tests__`).
   - **구조 규칙**(층·슬라이스·세그먼트·props-only 시트 등) → 스캔을 두지 않는다. 층 방향은 ESLint zone, 나머지는 Steiger(TRIP-1158).
   - **기능 회귀**(이미 지운 것의 재등장, 화면 금칙어·소요시간 글자, 바텀시트 prop 결합 등) → 스캔을 두지 않는다. QA가 보고, 자동화는 후속 Maestro 티켓.
   - 새 스캔을 더하기 전에 같은 금지를 ESLint `no-restricted-imports`·`no-restricted-syntax`로 표현할 수 있는지 먼저 본다.
4. **같은 화면을 여러 파일이 테스트**(`.select.`·`.errors.`·`.apple.` 같은 티켓·관점 접미사) → 화면 단위 1 + 통합 1로 **합친다**. 관점은 `describe` 블록으로 보존하고, 티켓 번호(`TRIP-####`)는 테스트 이름이 아니라 주석으로 옮긴다(합치며 새로 붙이는 바깥 `describe` 기준 — 옮겨 온 안쪽 `describe`·`it` 이름의 번호까지 고쳐 쓰지는 않는다). 같은 동작을 보는 `it`은 하나만 남긴다.
   - **"같은 동작"은 겉보기 포함이 아니라 뮤테이션으로 판정한다** — 지울 `it`이 잡는 뮤테이션을 남는 `it`에 심어 red일 때만 지운다. 입력·단언이 포함돼 보여도 실제로 잡는 결함이 다를 수 있다.
   - **같은 파일 안에서만** 지운다. 단위↔통합 사이 겹침은 둘 다 남긴다 — 단위는 행 수·문구·토큰 같은 세부를, 통합은 배선을 본다.
   - 옛 파일은 `git rm`으로 지운다(추적 파일 전수를 여는 스캔이 있어 작업트리에서만 지우면 ENOENT).
   - **소요시간 비표시(INV-3) 렌더 테스트는 시간·거리 데이터를 그리는 화면(일정·경로)에만 둔다.** 받는 데이터에 시간·거리 재료가 없는 화면(담은 장소·고르기·확인 대화상자 등)의 "분·시간·소요 글자 0건" 테스트는 지운다 — 일어날 수 없는 일을 지키는 테스트이고, 코드 쪽 `duration` 금지는 서버 DTO(INV-3)와 QA 몫이다.
5. 그 밖(순수 함수 단위 테스트 등) → **남긴다**.

### 합격선 — 정리해도 덜 잡지 않았는가

줄 수 목표는 두지 않는다(필요한 테스트까지 지우는 압력이 된다). 대신 두 가지를 모두 지킨다.

- **착수 전 잡히던 뮤테이션을 전부 유지** — 정리하는 칸마다 착수 전에 심판이 잡는 뮤테이션을 심어 두고, 정리 뒤에도 전부 red인지 확인한다. **칸 단위의 주 심판은 이것이다.**
- **합산 근사 줄 커버리지 하락 2%p 이내** — 기준선 91.64%(2026-09-30 develop `5feef8b0`) → 89.64% 이상. 화면 한 칸의 대상 소스는 전체의 몇 %라 칸 하나로는 이 수치가 거의 움직이지 않는다(합산 근사 줄 커버리지 = 파일마다 두 버킷 중 더 많이 덮은 쪽을 골라 합친 전역 비율). 그래서 전역 수치는 배치 누적 감시용이고, 칸마다 **대상 소스 파일별 covered 전후**를 함께 적는다.

측정은 누구나 같은 명령으로 한다(결과는 gitignore된 `_workspace/test-measure/`).

```bash
scripts/test-measure.sh <라벨>      # 두 버킷 + 커버리지 → 합산 근사 줄 커버리지·시간·케이스 수
python3 scripts/test-classify.py    # 테스트 파일 칸 분류(행동·소스 스캔·PBT·단위·개발 도구) → classification.csv
```

### PBT 작성 규칙

- **"생성기 적중" 단언(특정 사례가 최소 1회 나왔는가)을 확률에 맡기지 않는다** — 그 사례를 fast-check `examples` 파라미터로 반드시 박는다. 무작위에만 맡기면 코드가 맞아도 시드 운에 따라 CI가 떨어진다(실측: `recordsCalendarOngoing.test.ts` 동점 사례, CI 1회당 약 3~4% — 수정은 TRIP-1163).
- 판정 로직은 순수 함수로 분리해 PBT 대상으로 둔다 — 시드 로깅·shrinking으로 재현 가능하게.

## 린트·포맷

프론트 전용 설정 — `frontend/` 안에 두고 그 안에서만 적용한다. 백엔드(Kotlin, ktlint/detekt 계열)와 도구·설정 완전 분리.

- **ESLint** (`eslint.config.js`): `eslint-config-expo` 베이스 + import 경계 규칙(§import 경계) + NativeWind 클래스 정렬 플러그인
- **Prettier** (`.prettierrc`): 포맷 전담
- Biome 등 통합 도구 미채택 — Expo 공식 프리셋·NativeWind·경계 강제 플러그인이 전부 ESLint 생태계
- 스크립트: `pnpm lint` / `pnpm format` / `pnpm fsd`(Steiger 구조 린트 — `frontend/`에서 실행)

## 빌드·실행 (스캐폴드 후)

```bash
pnpm install
pnpm codegen              # openapi.yaml → shared/api/generated (스펙 변경 시)
pnpm expo prebuild        # config plugin (네이버 지도 SDK 등) 반영
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
