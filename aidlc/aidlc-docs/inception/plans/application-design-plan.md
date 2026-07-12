# Application Design Plan — TripPilot

> **역할**: Solution Architect. Application Design은 **고수준 컴포넌트 식별 + 서비스 계층 + 의존성**을 정의한다(상세 비즈니스 로직은 CONSTRUCTION의 Functional Design). 입력 = `requirements.md`(FR·솔버·복원력·사진 결정) + `stories.md`(94 상세 + 후속 3게이트) + `PRD-lean.md`(17 모듈·ADR).
>
> **답변 방법**: 각 질문의 `[Answer]:`에 보기 문자(A/B/C…)를 적어 주세요. 대부분 (권장)안이 있어 *"모두 권장"* 으로 답하셔도 됩니다. X)는 직접 서술. 완료되면 "완료"라고 알려 주시면 모호성 점검 후 설계 산출물을 생성합니다.
>
> **참고(팀 컨텍스트)**: 본 저장소 CLAUDE.md에 의도된 스택 — 백엔드 Spring Boot·Kotlin 모듈러 모놀리스 / 솔버 Python / 클라이언트 React Native·Expo / AWS(Bedrock·S3 등)·PostgreSQL. 아래 질문은 이를 이번 설계에 어디까지 채택할지 확정하기 위함이다.

---

## A. 설계 결정 질문

### Question 1 — 아키텍처 스타일 & 배포 모델
전체 시스템을 어떤 구조로 설계할까요?

A) **모듈러 모놀리스 + 분리 서비스 하이브리드 (권장)** — 백엔드 핵심 17모듈은 **단일 배포 모듈러 모놀리스**(모듈 내부 계층 api/application/domain/infra, 모듈 간 **api(facade)만 의존**), 결정론적 **솔버는 별도 서비스**(Python), AI 어시스턴트/에이전트(향후 Bedrock)는 외부 위임 계층. 초기 국내·단일 리전·다중 AZ에 실용적.

B) **완전 모듈러 모놀리스** — 솔버 포함 전부 단일 배포(솔버도 JVM 내). 단순하나 솔버 언어·향후 Bedrock 교체 유연성 낮음.

C) **마이크로서비스** — 모듈별 독립 배포. 초기 규모엔 과함.

X) 기타

[Answer]: A

### Question 2 — 컴포넌트 식별 기준
컴포넌트를 어떻게 도출할까요?

A) **PRD 17모듈을 1:1 컴포넌트로 (권장)** — Auth·User Profile·Accommodation Search·Saved Accommodation·Affiliate Link·Trip Creation·Place Data·Itinerary Generation·Plan-B Detection·Itinerary Recalculation·Weather&Context·Travel Archive·AI Reflection·Notification·Community·Conversational Assistant·Collaborative Editing. 추적성 최상(에픽·FR·모듈 정합). 후속 게이트 3(Community·Assistant·Collab)은 **인터페이스만 1차 정의**.

B) 재그룹핑 — 기능 흐름 기준으로 통합/분할.

X) 기타

[Answer]: A

### Question 3 — 모듈 간 통신 패턴
컴포넌트 간 통신을 어떻게?

A) **동기 facade + 비동기 이벤트 혼합 (권장)** — 조회·질의는 **동기 public facade(api 인터페이스)**, 상태 변화 전파(예: 숙소 등록→일정 생성 유도, 재계획→기록 반영, 좋아요→알림)는 **비동기 도메인 이벤트(트랜잭셔널 아웃박스·at-least-once·멱등 구독)**. 순환 동기 의존 금지.

B) 동기 위주 — 단순하나 결합↑.

C) 이벤트 위주 — 유연하나 초기 복잡도↑.

X) 기타

[Answer]: A

### Question 4 — 솔버 / AI 계층 배치 (FR-SOLVER 반영)
결정론적 솔버와 AI(어시스턴트·향후 Bedrock 에이전트)를 어떻게 배치할까요?

A) **Port/Adapter로 격리 (권장)** — 일정 지능을 `SolverPort` 인터페이스 뒤에 두고 Phase 1은 `DeterministicSolverAdapter`(OPTW/TOPTW), 향후 `BedrockAgentAdapter`로 **어댑터 교체만으로 대체**. 실현가능성 검증(영업시간·이동시간·시각)은 항상 결정론적 검증 도구가 소유. 어시스턴트는 이 Port를 호출·설명만(단독 확정 금지).

B) 솔버를 Itinerary Generation/Recalculation 내부 로직으로 직접 구현(별도 Port 없음) — 교체 유연성 낮음.

X) 기타

[Answer]: A

### Question 5 — 외부 연동 격리
외부 API(카카오/네이버/TMap 지도·날씨·OTA 딥링크·LLM/Bedrock·FCM·S3)를 어떻게 다룰까요?

A) **"1 외부 API = 1 소유 모듈 = 1 어댑터 포트" (권장)** — 각 외부 의존을 `{Capability}Port` 인터페이스 + `{Vendor}Adapter`로 격리해 벤더 종속·교체 리스크를 차단(ADR-0009·0011·0012 정합). 지도 API 약관(캐싱 금지·실시간·출처)·침묵 실패 금지 폴백을 어댑터 경계에서 강제.

B) 공용 통합 계층 하나로 묶기 — 단순하나 벤더 교체·약관 격리 약화.

X) 기타

[Answer]: A

### Question 6 — 기술 스택 베이스라인
이번 설계에 팀 스택을 어디까지 반영할까요? (상세 확정은 CONSTRUCTION의 NFR Requirements)

A) **팀 스택을 설계 가정으로 채택 (권장)** — 백엔드 Kotlin/Spring 모듈러 모놀리스 · 솔버 Python · 클라이언트 React Native/Expo · PostgreSQL · AWS(Bedrock·S3·다중 AZ). 컴포넌트/서비스 설계를 이 전제로 기술하되 "가정(NFR Requirements 확정)"으로 표기.

B) 기술 중립 — 언어·프레임워크 무관하게 논리 컴포넌트만 설계, 스택은 전부 CONSTRUCTION으로 이연.

X) 기타

[Answer]: A

> **추가 메모**(선택):
>
> [추가 메모]: (채팅 지시) AI/솔버 계약을 최대한 구체적으로 — 포트·메서드 시그니처·DTO·불변식·폴백·score까지. 프롬프트·모델 ID·알고리즘 상세는 CONSTRUCTION 이연.

---

## B. 실행 체크리스트 (승인 후 산출물 생성)

- [x] 확정 답변(Q1~Q6=모두 A)에 따라 설계 방침 고정 + AI/솔버 심화 지시 반영
- [x] `application-design/components.md` — 17 컴포넌트 + AI/솔버 포트 심화(§3)
- [x] `application-design/component-methods.md` — 메서드 시그니처·DTO + SolverPort·검증기·LLM·RAG·거리 포트
- [x] `application-design/services.md` — S1~S6 오케스트레이션(솔버 파이프라인 포함)
- [x] `application-design/component-dependency.md` — 의존성 매트릭스·이벤트 카탈로그·솔버/사진 데이터 흐름·외부 포트
- [x] `application-design/application-design.md` — 통합본
- [x] 솔버 Port/Adapter 계약·실현가능성 소유 경계 명시(FR-SOLVER·INV-1~4)
- [x] 외부 연동 Port/Adapter 목록·약관·폴백(ADR-0009·0011·0012)
- [x] 보안·복원력·PBT 접점 표기(SECURITY-*·RESILIENCY-*·PBT-*)
- [x] content-validation(Mermaid·표·특수문자) 후 저장 + 완료 메시지·승인 게이트

---

## C. 필수 산출물 (Mandatory)
- `components.md` · `component-methods.md` · `services.md` · `component-dependency.md` · `application-design.md`(통합본)
