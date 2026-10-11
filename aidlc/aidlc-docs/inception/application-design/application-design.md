# Application Design — TripPilot (통합본)

> **위치**: INCEPTION · Application Design. 상세 비즈니스 로직·알고리즘·프롬프트·모델·인프라는 CONSTRUCTION(범위 밖). 이 문서는 `components.md`·`component-methods.md`·`services.md`·`component-dependency.md`의 통합 개요다.
> **입력**: `requirements.md`(FR·솔버·복원력·사진) · `stories.md`(94 상세 + 후속 3게이트) · `PRD-lean.md`(17모듈·ADR).
> **설계 결정(Q1~6=A)**: 모듈러 모놀리스 + 결정론적 솔버 별도 서비스 · PRD 17모듈 1:1 컴포넌트 · 동기 facade+비동기 이벤트 · **SolverPort/Adapter 격리** · 1 API=1 포트/어댑터 · 팀 스택 가정(Kotlin/Spring·Python 솔버·RN/Expo·PostgreSQL·AWS Bedrock/S3).

> **[개정 · 2026-10-12]** 설계 결정 보정 — "결정론적 솔버 별도 서비스 · SolverPort/Adapter 격리 · AWS Bedrock" 가정은 현행이 아니다. 일정 지능은 AI 서비스 `ai/`(FastAPI) 한 곳에 있다(조립 `HybridAssemblyFacade` OR-Tools → 규칙 폴백, LLM 게이트웨이 LlmFeature 18종 전부 Claude `claude-fable-5-1`). 백엔드 경계는 `ScheduleAgentPort`(경로 정본 `HttpScheduleAgentAdapter.CALLED_PATHS`). 인프라는 AWS EKS 배포(`infra/terraform/stack/`, `deploy/eks/chart/`). C15·C17 폐기, C16(U8) 개발 범위, 신규 U10 GPS·위치 자동화(미구현) — 사용자 결정 2026-10-12. 상세 근거는 `components.md` 개정 블록.

---

## 1. 아키텍처 한 장 요약
- **백엔드**: 단일 배포 **모듈러 모놀리스**(Kotlin/Spring, 가정). 모듈 내부 `api/application/domain/infra`, **모듈 간 api만 의존**, 순환 동기 의존 금지.
- **컴포넌트**: PRD 17모듈 1:1(C1~C17). 1차 핵심 9 + 지원 5 + **후속 게이트 3(Community·Assistant·Collab) 인터페이스만**.
- **일정 지능**: `SolverPort` 뒤 **결정론적 솔버 서비스(Python)**. 판단(LLM)·진실(솔버/검증기) 분리.
- **통신**: 조회=동기 facade / 상태 전파=비동기 도메인 이벤트(아웃박스·멱등). C14 Notification은 순수 구독자.
- **외부 연동**: 1 API = 1 소유 모듈 = 1 어댑터 포트(약관·폴백 어댑터 경계 강제).
- **클라이언트**: RN/Expo(가정), 서버 공개 REST만 소비, 비즈니스 규칙 권위는 서버(클라 검증은 UX용).

> **[개정 · 2026-10-12]** §1 보정 — 모듈 계층은 `api/application/domain/adapter`, 모듈 목록 정본은 `backend/settings.gradle.kts`(moderation·change-log·affiliate-link 포함). 컴포넌트 범위는 위 결정(C15·C17 폐기, C16 개발). 일정 지능은 `ScheduleAgentPort` 뒤 AI 서비스이지 별도 솔버 서비스가 아니다.

## 2. AI / 솔버 계약 (핵심) ★
> 상세: `components.md §3`, `component-methods.md §1~3`, `component-dependency.md §3`.

**불변식**: INV-1 closed-set(RAG) · INV-2 검증 시각만 노출 · INV-3 거리만(소요시간 **숫자** 미표시 — 정성 문구는 허용, TRIP-1030 개정 2026-09-27) · INV-4 결정론적 폴백.

**포트 5종**:
1. `SolverPort` — 일정 지능 엔진(generate/recalculate/validate/proposeSlotCandidates). **Phase 1 `DeterministicSolverAdapter` → 향후 `BedrockAgentSolverAdapter`**(어댑터 교체만).
2. `FeasibilityValidator` — 실현가능성 **소유자**(시간창·이동 버퍼·앵커·필수 방문지 포함·시각 충돌). 두 단계 불변. PBT 1순위.
3. `PreferenceScoringPort`/`LlmGatewayPort` — LLM 판단(취향 해석·점수·설명). 어시스턴트·회고 재사용.
4. `CandidatePoolPort` — RAG 후보 풀(Place Data C7). INV-1 소유.
5. `TravelEstimatePort` — 거리 기반 추정(거리만, INV-3).

> **[개정 · 2026-10-12]** 백엔드에 있는 AI 경계는 `ScheduleAgentPort{generate, validate, repair, explanations, proposeSlotCandidates, replan}`·`ReflectionAgentPort`·리마인드 문구 어댑터뿐이다. 2~5번은 AI 서비스 내부 구성요소(검증 `assembly_engine/constraints.py`, LLM `llm_gateway` LlmFeature 18종, 후보 풀은 `/internal/pois` 기반, 거리 `assembly_engine/travel.py`)다. 1번의 Bedrock 교체 경로는 현행이 아니다.

**품질 score & 교체 트리거**: `QualityScore{preferenceFit·constraintSatisfaction·routeEfficiency·composite}`를 솔버 산출물에 부착. composite가 '별로'면 Bedrock 어댑터로 **교체**(프로젝트 결정). **산식·임계·판정 프로세스는 CONSTRUCTION·운영(Open O-SOLVER)** — 이번 단계는 자료구조·부착 지점·의사결정 위치만 확정.

> **[개정 · 2026-10-12]** `QualityScore` 는 AI 내부에만 있고(`ai/src/trippilot/assembly_engine/quality.py`) 경계에 실리지 않는다. Bedrock 교체 트리거는 무효.

**폴백 체인**: LLM 실패→솔버만 / Place 실패→부분 / 라우팅 실패→직선거리 / 솔버 전면 실패→앵커 최소 일정 / Plan-B 외부신호 실패→무발화.

> **[개정 · 2026-10-12]** 실제 강등: 조립 `OR_TOOLS` → `RULE_FALLBACK` → `MINIMAL`, 취향 점수 `LLM` → `MIXED` → `RULE`(`degradations[]`), 백엔드 표기 `SolveMode{FULL_AI, DETERMINISTIC, MINIMAL}`.

## 3. 서비스(오케스트레이션)
S1 Traveler Spine · **S2 Itinerary Intelligence(솔버 파이프라인)** · S3 Plan-B(감지→판정→재계획) · S4 Notification fan-out · S5 등록 핸드오프 · S6 Community/Collab(후속). 상세 `services.md`.

> **[개정 · 2026-10-12]** S6 폐기(C15·C17). S3 재계획은 `ReplanFacade.propose()` 1건(`/ai/v1/planb/replan`)이다 — `services.md` 개정 참조.

## 4. 핵심 데이터 흐름
- **앵커**: 등록 숙소(C4) = 일정 출발점(ADR-0002·0004) → 솔버 입력.
- **plan/actual/change-log**(C12·ADR-0013): 계획·실제·변경 이력 3종 구분. 재계획·공동편집 변경은 change log 통합.
- **사진**: 로컬 참조 + 서버 메타데이터만, **커뮤니티 공개만 S3**(EXIF 제거), 멀티 디바이스 미지원.
- **RAG**: Place Data(C7)가 closed-set 공급 → LLM은 그 안에서만 선택(INV-1).

> **[개정 · 2026-10-12]** change-log 는 별도 모듈 `:modules:change-log` 다. 공동편집 변경 통합·커뮤니티 공개 S3 경로는 C15·C17 폐기로 소멸. RAG 풀은 AI 서비스가 C7 의 `/internal/pois` 를 읽어 만든다.

## 5. Cross-cutting 준수 접점
- **보안(SECURITY-01~15)**: 인증·세션(C1, SEC-AUTH) · 객체 인가·IDOR 방지(전 facade, 특히 C15·C17) · 입력 검증·금칙어(C15, SEC-INPUT) · 로그·PII 비노출 · 어시스턴트 권한 경계(C16, ADR-0015) · 시크릿 매니저 · fail-closed.

> **[개정 · 2026-10-12]** C15·C17 접점은 폐기로 소멸. C16 권한 경계(ADR-0015)는 U8 개발 범위에서 유효.

- **복원력(RESILIENCY)**: 단일 리전·다중 AZ / 외부 호출 타임아웃·서킷·우아한 성능저하(포트 폴백=RESILIENCY-10↔ADR-0011) / 이벤트 아웃박스(at-least-once) / 헬스체크·관측성. **RESILIENCY-04·14는 CONSTRUCTION NFR**.
- **PBT(Partial: 02·03·07·08·09)**: `FeasibilityValidator`(불변식)·오퍼 정규화(C3)·Place 표준화(C7)·직렬화 왕복·회고 기본 카드 불변식. LLM 비결정 추론은 대상 아님(도구 출력 검증으로 대체).
- **법적**: 위치 동의 흐름(C1·C2·C12) · 지도 API 약관(C7 어댑터).

## 6. 가정 · 이연 (Open)
- **가정**: 팀 스택(NFR Requirements 확정) · NFR 정량값(성능·가용성) · Bedrock을 LLM/에이전트 벤더로 가정.

> **[개정 · 2026-10-12]** Bedrock 은 LLM 벤더가 아니다 — 현행은 Claude `claude-fable-5-1`(provider 선택식), Bedrock 은 증류 모델 Custom Model Import·Titan 임베딩 선택 배선뿐(`ai/src/trippilot/llm_gateway/adapters/`). 인프라는 EKS 로 배포(`infra/terraform/stack/eks.tf`, `deploy/eks/chart/`).

- **이연(CONSTRUCTION)**: 솔버 알고리즘·LLM 프롬프트·모델 ID·score 산식/임계(**O-SOLVER**) · 상세 스키마·DB·API 명세 · 인프라(다중 AZ·S3 라이프사이클·공개 사진 삭제 처리) · CI/CD·롤백(RESILIENCY-04)·복원력 테스트(RESILIENCY-14).
- **이연(후속 인셉션)**: Community·Assistant·Collaborative Editing 상세 스토리·설계.

> **[개정 · 2026-10-12]** Community·Collaborative Editing 은 폐기, Assistant 는 개발 범위(U8). 신규 U10 GPS·위치 자동화 추가(미구현).

## 7. 추적성
| 산출물 | 내용 |
|---|---|
| `components.md` | 17 컴포넌트 책임·인터페이스 + AI/솔버 포트 심화(§3) |
| `component-methods.md` | 메서드 시그니처·DTO + SolverPort·검증기·LLM·RAG·거리 포트 |
| `services.md` | S1~S6 오케스트레이션 |
| `component-dependency.md` | 의존성 매트릭스·이벤트 카탈로그·솔버/사진 데이터 흐름·외부 포트 |
| 매핑 | 컴포넌트 ↔ PRD 모듈 1~17 ↔ 에픽 A~L ↔ FR-* |

> **다음 단계(Units Generation)**: 이 설계를 구현 유닛(빌드 순서)으로 분해. 핵심 여정 유닛 우선 + 솔버/포트 유닛 + 후속 게이트 유닛 분리. → 승인 시 **STOP**(인셉션 종료).
