# Unit of Work — TripPilot

> **정의**: 유닛 = 개발용 스토리·컴포넌트의 논리적 묶음(빌드 단위). 배포는 **단일 모듈러 모놀리스**(+ 별도 솔버 서비스·RN 클라이언트)이므로 유닛은 **독립 배포 서비스가 아니라 빌드/개발 순서 단위**다.
> **분해 방침(Q1~5=A)**: 능력+여정 단계 그룹핑 · 워킹 스켈레톤 우선 → 수직 슬라이스 · 일정 지능(솔버) 독립 유닛 · 후속 게이트 3 각각 별도 유닛(인터페이스만) · 부모 모노레포 정합.
> **범위**: 유닛 정의·빌드 순서·코드 조직 전략(문서화). **코드 생성은 이번 범위 밖**(SCOPE.md).

---

## 1. 유닛 목록 (U0~U9)

| 유닛 | 이름 | 포함 컴포넌트 | 에픽 | 상태 |
|---|---|---|---|---|
| **U0** | Foundation & Walking Skeleton | Auth(C1)·User Profile(C2)·앱셸/내비(client)·**크로스커팅 스캐폴딩** | A·B | 1차 |
| **U1** | Accommodation & Trip Setup (앵커) | Accommodation Search(C3)·Saved Accommodation(C4)·Affiliate Link(C5)·Trip Creation(C6)·**Place Data/RAG(C7)** | **A(탐색)**·C·D | 1차 |
| **U2** | Itinerary Intelligence / Solver ★ | SolverPort+어댑터·FeasibilityValidator·PreferenceScoring/LlmGateway·TravelEstimate (+별도 솔버 서비스) | E·F | 1차 |
| **U3** | AI Itinerary Generation | Itinerary Generation(C8) — Place Data는 U1의 `CandidatePoolPort` 소비 | E | 1차 |
| **U4** | In-trip & Plan-B | Plan-B Detection(C9)·Itinerary Recalculation(C10)·Weather&Context(C11)·여행 중 현장(G) | F·G | 1차 |
| **U5** | Records & Reflection | Travel Archive(C12)·AI Reflection(C13) | G·H | 1차 |
| **U6** | Notification & Settings | Notification(C14)·설정/마이페이지 리드 | I | 1차 |
| **U7** | Community | Community(C15) | K | **후속 게이트** |
| **U8** | Conversational Assistant | Conversational Assistant(C16) | J | **후속 게이트** |
| **U9** | Collaborative Editing | Collaborative Editing(C17) | L | **후속 게이트** |

> **[개정 · 2026-10-12] 유닛 추가·제거** (사용자 결정, `workflow-changes.md` §8 — audit 2026-10-11T16:20Z 항목):
> - **U7 Community(C15)·U9 Collaborative Editing(C17) = 폐기.** 제품에서 뺀다. 1차 유닛과 인터페이스만 있었으므로 기능 재분배 없음. 위 표 행은 이력으로 남긴다.
> - **U8 Conversational Assistant(C16) = 개발 범위 편입**(후속 게이트 → 진행). 설계는 `construction/plans/u8-conversational-assistant-functional-design-plan.md`부터 — 현행 `ai/` 구현(IntentRouter·워커·`/ai/v1/*`) 기준.
> - **U10 GPS·위치 자동화 = 신설.** 아직 구현되지 않은 위치 기반 기능을 묶는다 — 지오펜스 자동 도착·이탈(US-ONTRIP-01 자동 부분), 백그라운드 '항상 허용' 위치, 실제 경로 기록·계획 대비 토글(US-PLANB-13), GPS 방문 기록(US-REC-03), 요약의 GPS 경로(US-REC-08 일부), 위치 법정 로그. 컴포넌트는 신설 없이 C9·C12·C1(위치 동의는 auth 모듈 소유) + 클라이언트 위치 계층을 확장한다(확정은 U10 FD Q20). 현 구현 기준선: 포그라운드 위치·수동 체크인만(`frontend/src/shared/location/geofence.ts` degrade 스텁, `frontend/app.config.ts` `locationAlwaysPermission: false` — TRIP-936). 설계는 `construction/plans/u10-gps-location-automation-functional-design-plan.md`부터.
>
> | 유닛 | 이름 | 포함 컴포넌트 | 에픽 | 상태 |
> |---|---|---|---|---|
> | **U8** | Conversational Assistant | C16 | J | **진행(설계)** |
> | **U10** | GPS·위치 자동화 | C9·C12·C1 확장 + 클라이언트 위치 계층 | F·G·H 일부 | **신설(설계)** |
> | ~~U7~~ · ~~U9~~ | Community · Collab | C15 · C17 | K · L | **폐기** |

> **U2가 독립 유닛인 이유(FR-SOLVER·Q3)**: 솔버·포트·검증기를 격리해 (a) **Bedrock 어댑터 교체를 U2 안에서만** 처리, (b) **PBT 게이트**(FeasibilityValidator 불변식·직렬화 왕복)를 이 유닛에 집중, (c) Python 솔버 서비스 경계를 명확히. U3·U4·U8이 U2의 포트를 소비.

---

## 2. 빌드 순서 (트레이서 불릿 · Q2=A)

```
Phase 0  U0 Foundation & Walking Skeleton
         → 인증·프로필·앱셸 + 보안(SECURITY-*)·복원력(단일리전·다중AZ·아웃박스)·PBT·관측성 스캐폴딩을 "처음부터"
Phase 1  U1 Accommodation & Trip Setup      (앵커 = 등록 숙소 확보 + 탐색·장소 데이터[C7])
Phase 2  U2 Itinerary Intelligence/Solver   (결정론적 솔버 + 포트 · 차별점 엔진)
Phase 3  U3 AI Itinerary Generation         (U2 소비 · 일정 생성 = 첫 핵심 가치)
Phase 4  U4 In-trip & Plan-B                (여행 중 차별점 조기 검증)
Phase 5  U5 Records & Reflection
Phase 6  U6 Notification & Settings
──────── 여기까지 = 핵심 여정 MVP ────────
Phase 7+ U7 Community · U8 Assistant · U9 Collab   (분리 출시 게이트 · 1차와 인터페이스만, 병렬 가능)
```

- **워킹 스켈레톤(U0)**: "침묵 실패 금지"·보안·복원력·PBT를 나중이 아니라 Phase 0에 심는다(요구 NFR 정합).
- **차별점 조기 검증**: U2→U3(AI 일정), U4(Plan-B)를 앞쪽에 배치.
- **후속 게이트**: 핵심 여정 완성 후 별도 게이트. 1차와는 계약(인터페이스)만 유지해 리스크 격리(ADR-0016).

---

## 3. 코드 조직 전략 (그린필드 · 문서화만)

> **가정(NFR Requirements/Infra Design 확정)** · 부모 모노레포(backend·frontend·ai) 정합. **이번 실행은 코드 미생성** — 아래는 전략 문서.

```
trippilot/ (monorepo)
├── backend/                 # 단일 배포 모듈러 모놀리스 (Kotlin/Spring · Gradle 멀티모듈)
│   ├── app/                 # 배포 조립 (유일)
│   └── modules/             # 모듈 = 컴포넌트, 내부 계층 api/application/domain/infra
│       ├── auth/ profile/ accommodation-search/ saved-accommodation/ affiliate-link/
│       ├── trip/ place-data/ itinerary-generation/ planb-detection/ recalculation/
│       ├── weather-context/ archive/ reflection/ notification/
│       └── (후속) community/ assistant/ collab/
│   └── shared/              # 이벤트·아웃박스·보안·관측성 크로스커팅
├── solver/                  # U2 결정론적 솔버 서비스 (Python · OPTW/TOPTW) — SolverPort 구현
├── frontend/                # RN/Expo (TS strict) — 서버 REST만 소비, 규칙 권위는 서버
└── infra/                   # IaC (단일 리전·다중 AZ·S3·Bedrock) — Infrastructure Design(범위 밖)
```

- **의존 규칙**: 모듈 간 다른 모듈의 `api`만 의존, 순환 동기 금지(Konsist/ArchUnit로 강제 — CONSTRUCTION).
- **U2 경계**: `SolverPort` 계약은 backend에, 구현은 `solver/`(Python). 향후 `BedrockAgentSolverAdapter`도 이 경계 내 교체.
- **마이그레이션**: Flyway SQL-first forward-only(스키마 canon) — 상세 CONSTRUCTION.

> **[개정 · 2026-10-12] 실제 코드 조직** — 위 트리는 인셉션 시점 전략이고 지금은 코드가 실재한다. 차이: ① 모듈 목록 정본 = `backend/settings.gradle.kts`(`change-log`·`moderation`이 추가, `recalculation/` → `itinerary-recalculation/`, `community/`·`collab/`은 U7·U9 폐기로 만들지 않음) ② 모듈 내부 계층은 `api/application/domain/adapter`(`infra/` 아님) ③ `shared/` → `backend/common/{core,security,test-support}` ④ 별도 `solver/` 서비스 없음 — 조립 엔진·LLM 게이트웨이·후보풀·에이전트가 모두 `ai/`(FastAPI) 한 서비스(`ai/src/trippilot/assembly_engine/facade.py` `HybridAssemblyFacade`, OR-Tools → 규칙 폴백). backend 포트는 `SolverPort`가 아니라 `ScheduleAgentPort`(호출 경로 정본 `HttpScheduleAgentAdapter.CALLED_PATHS`) ⑤ `BedrockAgentSolverAdapter`는 없고 AgentCore 교체 계획도 코드에 흔적이 없다 — LLM은 `claude-fable-5-1` 통일(커밋 fb0d51e2) ⑥ `infra/`는 **구축 완료**(`infra/terraform/stack/` EKS·RDS·ElastiCache·ECR·Secrets Manager, `deploy/eks/chart`, `.github/workflows/aws-deploy.yml`) — as-built 정본 `construction/shared-infrastructure.md`.

---

## 4. 검증
- **모든 스토리 배정**: 99 핵심 + 25 후속 = 124 → `unit-of-work-story-map.md`에서 유닛 매핑(누락 없음). *(2026-07-23: US-EXPL-01~04 신설로 94→98 · 2026-09-28: US-TRIP-10 신설로 98→99, US-TRIP-05 폐기 — 유효 123)*
- **순환 없음**: 빌드 순서 U0→U6는 단방향 의존, 후속 U7~U9는 1차에 인터페이스 의존만(역방향 없음) → `unit-of-work-dependency.md`.
- **일정 지능 격리**: U2가 U3·U4·U8에 포트로만 노출, Bedrock 교체·PBT가 U2에 국한.

> **[개정 · 2026-10-12]** 스토리 배정: U7(9)·U9(8) 폐기로 후속 25 중 17이 빠지고 U8(8)만 남는다 → 유효 = 핵심 98(US-TRIP-05 폐기 반영) + U8 8 = **106**. U10은 신규 스토리를 만들지 않고 기존 스토리의 위치 자동화 부분을 이관받는다(스토리 수는 원 유닛에 유지, 상세 `unit-of-work-story-map.md` 개정 블록). 빌드 순서: U0~U6 이후 **U8·U10 병렬**(서로 의존 없음 — U8은 U2 포트, U10은 U4·U5·U0 확장).
