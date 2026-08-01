# Unit of Work — TripPilot

> **정의**: 유닛 = 개발용 스토리·컴포넌트의 논리적 묶음(빌드 단위). 배포는 **단일 모듈러 모놀리스**(+ 별도 솔버 서비스·RN 클라이언트)이므로 유닛은 **독립 배포 서비스가 아니라 빌드/개발 순서 단위**다.
> **분해 방침(Q1~5=A)**: 능력+여정 단계 그룹핑 · 워킹 스켈레톤 우선 → 수직 슬라이스 · 일정 지능(솔버) 독립 유닛 · 후속 게이트 3 각각 별도 유닛(인터페이스만) · 부모 모노레포 정합.
> **범위**: 유닛 정의·빌드 순서·코드 조직 전략(문서화). **코드 생성은 이번 범위 밖**(SCOPE.md).

---

## 1. 유닛 목록 (U0~U9)

| 유닛 | 이름 | 포함 컴포넌트 | 에픽 | 상태 |
|---|---|---|---|---|
| **U0** | Foundation & Walking Skeleton | Auth(C1)·User Profile(C2)·앱셸/내비(client)·**크로스커팅 스캐폴딩** | A·B | 1차 |
| **U1** | Accommodation & Trip Setup (앵커) | Accommodation Search(C3)·Saved Accommodation(C4)·Affiliate Link(C5)·Trip Creation(C6) | C·D | 1차 |
| **U2** | Itinerary Intelligence / Solver ★ | SolverPort+어댑터·FeasibilityValidator·PreferenceScoring/LlmGateway·TravelEstimate (+별도 솔버 서비스) | E·F | 1차 |
| **U3** | AI Itinerary Generation | Place Data/RAG(C7)·Itinerary Generation(C8) | E | 1차 |
| **U4** | In-trip & Plan-B | Plan-B Detection(C9)·Itinerary Recalculation(C10)·Weather&Context(C11)·여행 중 현장(G) | F·G | 1차 |
| **U5** | Records & Reflection | Travel Archive(C12)·AI Reflection(C13) | G·H | 1차 |
| **U6** | Notification & Settings | Notification(C14)·설정/마이페이지 리드 | I | 1차 |
| **U7** | Community | Community(C15) | K | **후속 게이트** |
| **U8** | Conversational Assistant | Conversational Assistant(C16) | J | **후속 게이트** |
| **U9** | Collaborative Editing | Collaborative Editing(C17) | L | **후속 게이트** |

> **U2가 독립 유닛인 이유(FR-SOLVER·Q3)**: 솔버·포트·검증기를 격리해 (a) **Bedrock 어댑터 교체를 U2 안에서만** 처리, (b) **PBT 게이트**(FeasibilityValidator 불변식·직렬화 왕복)를 이 유닛에 집중, (c) Python 솔버 서비스 경계를 명확히. U3·U4·U8이 U2의 포트를 소비.

---

## 2. 빌드 순서 (트레이서 불릿 · Q2=A)

```
Phase 0  U0 Foundation & Walking Skeleton
         → 인증·프로필·앱셸 + 보안(SECURITY-*)·복원력(단일리전·다중AZ·아웃박스)·PBT·관측성 스캐폴딩을 "처음부터"
Phase 1  U1 Accommodation & Trip Setup      (앵커 = 등록 숙소 확보)
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

---

## 4. 검증
- **모든 스토리 배정**: 94 핵심 + 25 후속 = 119 → `unit-of-work-story-map.md`에서 유닛 매핑(누락 없음).
- **순환 없음**: 빌드 순서 U0→U6는 단방향 의존, 후속 U7~U9는 1차에 인터페이스 의존만(역방향 없음) → `unit-of-work-dependency.md`.
- **일정 지능 격리**: U2가 U3·U4·U8에 포트로만 노출, Bedrock 교체·PBT가 U2에 국한.
