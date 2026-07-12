# Application Design — Services (Orchestration)

> 서비스 = 여러 컴포넌트 facade·포트를 조율하는 오케스트레이션 계층. 도메인 규칙은 각 컴포넌트가 소유, 서비스는 **흐름·트랜잭션 경계·이벤트 발행**만 담당. 통신 = 동기 facade + 비동기 이벤트(아웃박스).

---

## S1. Traveler Spine Orchestration (여행자 척추)
**흐름**: 온보딩 → 숙소 탐색/등록 → 여행 생성 → **AI 일정 생성** → (여행 중) Plan-B → 기록/회고.
- **조율**: Auth(C1)·UserProfile(C2) → AccommodationSearch(C3)·Affiliate(C5) → SavedAccommodation(C4)·TripCreation(C6) → ItineraryGeneration(C8) → PlanB(C9·C10) → TravelArchive(C12)·Reflection(C13).
- **핵심 규칙**: 각 단계 출력이 다음 입력으로 전달됨(등록 숙소=앵커 → 솔버 입력). 단계 전이는 이벤트로 느슨하게(`StayRegistered`→일정 생성 유도, `TripEnded`→회고).
- **테스트(통합)**: 척추 end-to-end — 저장→등록→AI 일정→재계획→기록 연결(FR 14 테스트 기준).

## S2. Itinerary Intelligence Orchestration (솔버 파이프라인) ★
**책임**: AI 일정 생성/재계산의 포트 조립. **판단(LLM)과 진실(솔버) 분리 강제.**
```
① getTripContext(C6) + getAnchors(C4)                     ← 앵커·취향·필수방문지
② CandidatePoolPort.resolve(C7)                           ← RAG closed-set(INV-1)
③ PreferenceScoringPort.interpret+scoreCandidates         ← LLM 판단
④ TravelEstimatePort.matrix                               ← 거리(INV-3)
⑤ SolverPort.generate/recalculate                         ← 검증 시각·순서·score(INV-2)
⑥ PreferenceScoringPort.explainPlacements                 ← 설명(표시용, 시각 불변)
⑦ 조기 노출(첫 1일) → 백그라운드 잔여 → 확정
```
- **폴백 오케스트레이션**(INV-4·components §3.6): 각 단계 실패 시 `FallbackMode` 태깅 후 다음 단계 축소 실행. 절대 빈 결과 반환 금지.
- **어시스턴트·회고 재사용**: C16·C13이 ③⑥ 계층을 재호출(신규 생성 아님).
- **교체 지점**: ⑤의 `SolverPort` 어댑터만 Bedrock으로 교체(FR-SOLVER). ①②④⑥ 흐름 불변.

## S3. Plan-B Pipeline (3단: 감지→판정→재계획)
```
신호 수집(C11 Weather·위치·C12 VisitChecked) → PlanBDetection.evaluate(C9, 임계·노이즈)
  → PlanBTriggered → 비차단 알림(C14) → 사용자 "대안 보기"
  → Recalculation.proposeAlternatives(C10 = SolverPort.recalculate) → 비교 → apply → change log(C12)
```
- **비가시 판정**(C9)은 사용자에게 노출 안 함(ADR-0006). 자동 트리거는 제안일 뿐 자동 변경 없음.
- **외부 API 실패**: 허위 알림 금지(무발화) + 수동 경로 유지(US-PLANB-11).

## S4. Notification Fan-out
- 도메인 이벤트(`StayRegistered`·`PlanBTriggered`·`ReflectionReady`·`CommunityReaction`) 구독 → 종류별·채널별 토글 적용 → 이중 경로(인앱 WS/SSE + 푸시 FCM/APNs) → **catch-up**(재접속 시 누락 0).
- 묶기·빈도 상한·self-notification 제외(커뮤니티 반응).

## S5. External Registration & Handoff (숙소 등록 핸드오프)
- AccommodationSearch(C3) → Affiliate 딥링크(C5) → 외부 OTA 이탈 → 복귀 핸드오프 → SavedAccommodation 1탭 등록(C4) → `StayRegistered` → 일정 생성 유도.

## S6. Community & Collaboration Orchestration (후속 게이트)
- **Community(C15)**: 확정 일정(C8) → 공개(마스킹·공개 사진 S3 업로드 via C12) → 둘러보기·복제(plan 스냅샷 → C6·C8 재검증) → 좋아요·댓글 → `CommunityReaction`→알림(C14). 모더레이션(신고 큐·검토 보류·금칙어·차단)은 출시 선결.
- **Collaborative Editing(C17)**: 초대·권한 → 항목 잠금 교대 편집 → `SolverPort.validate` 재검증(C8) → 충돌 해소 → change log(C12).
- **상세 오케스트레이션은 후속 인셉션.**

---

## 서비스 ↔ 컴포넌트 요약
| 서비스 | 주 조율 컴포넌트 | 주요 이벤트 |
|---|---|---|
| S1 Spine | C1·C2·C3·C4·C5·C6·C8·C9·C10·C12·C13 | StayRegistered·TripCreated·TripEnded |
| S2 Solver | C6·C4·C7·C8·C10 + 포트(Solver·Scoring·CandidatePool·TravelEstimate) | (동기 위주) |
| S3 Plan-B | C11·C9·C10·C12·C14 | PlanBTriggered |
| S4 Notify | C14 ← 전 컴포넌트 이벤트 | (구독) |
| S5 Handoff | C3·C5·C4 | StayRegistered |
| S6 Community/Collab (후속) | C15·C16·C17·C8·C12 | CommunityReaction |
