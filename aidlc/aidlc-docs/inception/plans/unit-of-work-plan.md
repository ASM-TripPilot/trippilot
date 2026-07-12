# Unit of Work Plan — TripPilot (Units Generation · Part 1)

> **목적**: Application Design(17 컴포넌트·솔버 포트·서비스)을 **개발 단위(Unit of Work)** 로 분해하고 **빌드 순서**를 정한다. 유닛 = 개발용 스토리·컴포넌트의 논리적 묶음.
> **컨텍스트**: 모듈러 모놀리스(단일 배포) + 결정론적 솔버 별도 서비스(Python) + RN/Expo 클라이언트. 그린필드 → 코드 조직 전략 문서화(코드 생성은 이번 범위 밖).
> **답변 방법**: `[Answer]:`에 보기 문자. 대부분 (권장)안 있음 — *"모두 권장"* 가능. 완료 시 알려 주시면 모호성 점검 후 유닛 산출물 생성.

---

## A. 분해 결정 질문

### Question 1 — 유닛 그룹핑 전략
17 컴포넌트·94 스토리를 어떤 기준으로 유닛으로 묶을까요?

A) **능력(capability) + 여정 단계 기반 (권장)** — 공통 기반(Foundation) → 여행자 척추 단계별(탐색/등록·여행생성·**일정 지능**·Plan-B·기록/회고·알림) → 후속 게이트(Community·Assistant·Collab) 별도. 스토리 친화도·빌드 순서 정합.

B) 모듈 1:1 — 17 유닛(과분할, 조율 부담↑).

C) 단일 유닛 — 순수 모놀리스 1덩어리(빌드 순서 표현 불가).

X) 기타

[Answer]:

### Question 2 — 빌드 순서 (트레이서 불릿)
어떤 순서로 만들까요?

A) **워킹 스켈레톤 우선 → 수직 슬라이스 (권장)** — Phase 0(공통 기반: 인증·프로필·앱셸 + **보안·복원력·PBT·아웃박스 스캐폴딩**을 처음부터) → 핵심 여정 수직 슬라이스(숙소 탐색/등록 → AI 일정 지능 → Plan-B → 기록/회고 → 알림) → 후속 게이트. 차별점(일정·Plan-B)을 조기 검증.

B) 데이터 계층부터 상향식 — 통합 검증 늦음.

X) 기타

[Answer]:

### Question 3 — 솔버 / 일정 지능 유닛 분리 (FR-SOLVER)
결정론적 솔버·포트를 어떻게 유닛화할까요?

A) **독립 '일정 지능' 유닛 (권장)** — `SolverPort`·어댑터·`FeasibilityValidator`·`PreferenceScoring`·`CandidatePool`·`TravelEstimate`를 한 유닛(별도 솔버 서비스 포함)으로. **Bedrock 교체·PBT 게이트를 격리**하기 쉬움. Itinerary Generation/Recalculation은 이 유닛의 포트를 소비.

B) 일정 생성 모듈에 흡수 — 교체·테스트 격리 약화.

X) 기타

[Answer]:

### Question 4 — 후속 게이트(Community·Assistant·Collab) 유닛
후속 3모듈을 어떻게?

A) **각각 별도 유닛 + 1차와 인터페이스만 (권장)** — 3개 독립 출시 게이트 유닛으로 두고, 1차 유닛과는 계약(인터페이스)만 확정. 상세 설계·스토리는 후속 인셉션. 리스크 격리(ADR-0016).

B) 한 유닛으로 통합 — 게이트 분리 이점 상실.

X) 기타

[Answer]:

### Question 5 — 코드 조직 전략 (그린필드·문서화만)
배포 모델·디렉터리 구조를 어떻게 문서화할까요? (코드 생성은 이번 범위 밖)

A) **부모 모노레포 정합 (권장)** — 단일 배포 백엔드 `backend/`(Gradle 멀티모듈, 모듈=컴포넌트) · 솔버 `solver/`(Python 서비스) · 클라이언트 `frontend/`(RN/Expo) · 인프라(IaC) 별도. 팀 모노레포(backend·frontend·ai) 구조와 정합.

B) 폴리레포 — 초기 규모엔 과함.

X) 기타

[Answer]:

> **추가 메모**(선택):
>
> [추가 메모]:

[Answer 1]: A  [Answer 2]: A  [Answer 3]: A  [Answer 4]: A  [Answer 5]: A

---

## A2. 확정 답변 (Resolved — 2026-07-12)

사용자 지시("나머지도 이어서ㄱㄱ")로 **Q1~Q5 모두 권장(A) 채택**:
- **Q1 = A** 능력 + 여정 단계 기반 그룹핑
- **Q2 = A** 워킹 스켈레톤 우선 → 수직 슬라이스 (Phase 0에 보안·복원력·PBT·아웃박스 스캐폴딩)
- **Q3 = A** 독립 '일정 지능' 유닛 (솔버·포트·검증기 격리, Bedrock 교체·PBT 게이트)
- **Q4 = A** 후속 게이트 3 각각 별도 유닛 + 1차와 인터페이스만
- **Q5 = A** 부모 모노레포 정합(backend Gradle 멀티모듈 · solver Python · frontend RN/Expo · IaC)
- 모호·모순 없음 → Part 2 생성 진행. (코드 생성은 이번 범위 밖 — 조직 전략 문서화만)

---

## B. 실행 체크리스트 (승인 후 Part 2에서 수행)

- [x] 확정 답변(Q1~Q5=모두 A)에 따라 분해 방침 고정
- [x] `application-design/unit-of-work.md` — 유닛 U0~U9 정의·빌드 순서·코드 조직 전략
- [x] `application-design/unit-of-work-dependency.md` — 유닛 의존성 매트릭스·빌드 순서 근거·순환 검증
- [x] `application-design/unit-of-work-story-map.md` — 119 스토리 → 유닛 매핑(전 스토리 배정)
- [x] 유닛 경계·의존성 검증 (순환 없음·119 스토리 배정 완료)
- [x] 솔버/일정 지능 유닛(U2) PBT·Bedrock 교체 격리 명시
- [x] content-validation 후 저장 + 완료 메시지 → **STOP(인셉션 종료)**

---

## C. 필수 산출물 (Mandatory)
- `unit-of-work.md` · `unit-of-work-dependency.md` · `unit-of-work-story-map.md`
