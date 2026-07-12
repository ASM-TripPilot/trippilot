# Application Design — Components

> **범위**: 고수준 컴포넌트 식별 · 책임 · 인터페이스. 상세 비즈니스 로직은 CONSTRUCTION(Functional Design). **가정(NFR Requirements 확정)**: 백엔드 Kotlin/Spring **모듈러 모놀리스**, 모듈 내부 계층 `api / application / domain / infra`, **모듈 간 다른 모듈의 `api`(facade·DTO·event)만 의존**, 순환 동기 의존 금지. **결정론적 솔버는 별도 서비스(Python)**, LLM/에이전트는 외부 위임. 외부 API = **1 API = 1 소유 모듈 = 1 어댑터 포트**.
> **컴포넌트 = PRD 17모듈 1:1**. 후속 게이트 3(Community·Assistant·Collaborative Editing)은 **인터페이스만 1차 정의**.
> **추적성**: 각 컴포넌트에 PRD 모듈 번호·에픽·FR 표기. 시그니처는 `component-methods.md`, 의존/이벤트는 `component-dependency.md`.

---

## 1. 컴포넌트 개요 (17)

| # | 컴포넌트 | 계층 성격 | 에픽 | 상태 |
|---|---|---|---|---|
| 1 | **Auth** | 어댑터/CRUD | B | 1차 |
| 2 | **User Profile** | CRUD | B | 1차 |
| 3 | **Accommodation Search** | 오케스트레이션(외부 조회) | C | 1차 |
| 4 | **Saved Accommodation** | 도메인(앵커 소유) | C·D | 1차 |
| 5 | **Affiliate Link** | 딥러닝 아님·딥 모듈(상태머신) | C·I | 1차 |
| 6 | **Trip Creation** | 도메인 | D | 1차 |
| 7 | **Place Data** | 딥 모듈(표준화·RAG 게이트) | E·F | 1차 |
| 8 | **Itinerary Generation** | 딥 모듈(솔버 오케스트레이션) | E | 1차 |
| 9 | **Plan-B Detection** | 딥 모듈(트리거) | F | 1차 |
| 10 | **Itinerary Recalculation** | 딥 모듈(재최적화) | F | 1차 |
| 11 | **Weather & Context** | 어댑터(외부 맥락) | F | 1차 |
| 12 | **Travel Archive** | 도메인(plan/actual/changelog) | G·H | 1차 |
| 13 | **AI Reflection/Summary** | 딥 모듈(생성) | H | 1차 |
| 14 | **Notification** | 딥-ish(이중 경로·catch-up) | I | 1차 |
| 15 | **Community** | 도메인+모더레이션 | K | **후속·인터페이스만** |
| 16 | **Conversational Assistant** | 오케스트레이션(대화) | J | **후속·인터페이스만** |
| 17 | **Collaborative Editing** | 도메인(잠금·동기화) | L | **후속·인터페이스만** |

> **AI/솔버 계약 컴포넌트(포트)** — §3에서 심화: `SolverPort`·`FeasibilityValidator`·`PreferenceScoringPort`(LLM Gateway)·`CandidatePoolPort`(RAG)·`TravelEstimatePort`. 이들은 특정 모듈이 소유하되 여러 모듈이 `api`로 소비하는 **1급 계약**이다.

---

## 2. 컴포넌트 상세 (1차 핵심 9 + 지원)

### C1. Auth (모듈 1) · 에픽 B · FR-ONBOARD·SEC-AUTH
- **목적**: 여행자 단일 유형 가입/로그인/세션/삭제.
- **책임**: 소셜(카카오·네이버·Google·Apple) OAuth + 이메일 인증, 토큰 발급·갱신·무효화, 계정 충돌 병합(sub/이메일), 계정 삭제 캐스케이드 개시.
- **api(facade)**: `AuthFacade` — 인증·세션 검증·계정 식별.
- **외부 포트**: `SocialOAuthPort`(제공자별 어댑터), `MailPort`(이메일 인증).
- **이벤트**: `AccountCreated`, `AccountDeletionRequested`.
- **보안**: 적응형 해싱·세션 Secure/HttpOnly/SameSite·브루트포스 방지·시크릿 매니저(SEC-AUTH), IDOR 방지 기반 principal 제공.

### C2. User Profile (모듈 2) · 에픽 B · FR-ONBOARD
- **목적**: 취향 7종(스타일·페이스·예산·동행·활동·이동·음식)·닉네임·기본정보 저장, 개인화 입력 제공.
- **책임**: 취향 CRUD·미설정 중립 기본값 규칙 노출, 직접 설정값 우선(자동 분석과 충돌 시), 개인화 활용 동의 상태.
- **api**: `UserProfileFacade` — `getPreferenceVector(userId)` 등 개인화 입력.
- **이벤트**: `PreferencesUpdated`(→ 추천/일정 재개인화).

### C3. Accommodation Search (모듈 3) · 에픽 C · FR-STAY
- **목적**: 외부 OTA 숙소 탐색·저장(링크 노출 UI 책임).
- **책임**: 여행지 기반 검색(날짜·인원 없이), 유형/편의시설/가격대 필터, 정적 콘텐츠 vs 라이브 가격 분리, 위시리스트 저장, 딥링크 UI 노출(생성·추적은 C5 위임).
- **api**: `AccommodationSearchFacade`.
- **외부 포트**: `AccommodationContentPort`(글로벌 OTA Content API·TourAPI — 정적 콘텐츠·캐싱 허용), `LivePricePort`(정확 가격 — 캐싱 금지·표시 시점 호출).
- **PBT**: 오퍼 정규화·최저가 산출(오라클/불변식 후보).

### C4. Saved Accommodation (모듈 4) · 에픽 C·D · FR-STAY·FR-CORE
- **목적**: 등록 숙소(위치+체크인/아웃) 보관 = **일정 앵커 소유자**(ADR-0002·0004).
- **책임**: 등록 2경로(제휴 확인 1탭 / 수동), 다중·다박 거점, 날짜 구간 검증(겹침·공백 스마트 기본), 거점 사용 토글.
- **api**: `RegisteredStayFacade` — `getAnchors(tripId): RegisteredStay[]`(솔버 입력).
- **이벤트**: `StayRegistered`(→ 일정 생성 유도·알림), `StayUpdated`(→ 재생성 여부 질의).

### C5. Affiliate Link (모듈 5) · 에픽 C·I · FR-STAY·ADR-0003·0012
- **목적**: OTA 딥링크 생성·아웃바운드 추적·전환 집계(내부 지표).
- **책임**: 딥링크 파라미터(숙소·날짜) 정확 구성, 클릭 추적, 제휴 고지, 복귀 핸드오프 트리거. **전환·수수료는 내부 운영 지표로만**(사용자 비노출).
- **api**: `AffiliateLinkFacade`.
- **외부 포트**: `OtaDeeplinkPort`(OTA별 어댑터·포스트백).
- **딥 모듈**: 링크 파라미터 정확성·전환 상태(포스트백 멱등) — 격리 테스트 1순위.

### C6. Trip Creation (모듈 6) · 에픽 D · FR-TRIP
- **목적**: 여행 단위(목적지·기간·인원·예산) 생성·편집, 숙소·필수 방문지 연결.
- **책임**: 숙소 미등록 시작 허용, 예산 분배(가격 필터·비용 가중치), 필수 방문지(포함/시각 고정형) 관리, 커뮤니티 복제본의 재정렬 진입점.
- **api**: `TripFacade` — `getTripContext(tripId)`(솔버 입력 집약).
- **이벤트**: `TripCreated`, `MustVisitChanged`(→ 재계산).

### C7. Place Data (모듈 7) · 에픽 E·F · FR-SCHED·ADR-0009 · **RAG 게이트**
- **목적**: 장소(POI) 위치·영업시간·카테고리 **표준 스키마로 정규화** + **closed-set 후보 풀(RAG 그라운딩)** 제공. **INV-1 소유자**.
- **책임**: 다중 지도/장소 API를 단일 스키마 뒤로 추상화(벤더 비종속), 영업시간 미확인 분리, 환각·폐업 POI 제외, 좌표·거리 산출 입력.
- **api**: `PlaceDataFacade` = **`CandidatePoolPort`**(§3.4).
- **외부 포트**: `MapPlacePort`(카카오/네이버/TMap·Google Places 어댑터 — 약관: 캐싱 금지·실시간·출처), 실패 시 폴백(ADR-0011).
- **PBT**: 서로 다른 API 응답 → 단일 스키마 정규화(불변식), 한 벤더 장애 시 계약 유지.

### C8. Itinerary Generation (모듈 8) · 에픽 E · FR-SCHED·FR-SOLVER · **딥 모듈**
- **목적**: day별 일정 생성 오케스트레이션 — 취향 점수(LLM)·후보(RAG)·앵커·제약을 **`SolverPort`에 위임**해 검증된 일정 산출.
- **책임**: 입력 집약(앵커·취향 벡터·필수 방문지·후보 풀·이동 추정), 생성 방식 분기(완전 AI/같이 고르기/직접), 첫 1일 조기 노출·백그라운드 채움, **폴백 체인**(§3.6), 확정(lock) 처리.
- **api**: `ItineraryGenerationFacade`.
- **소비 포트**: `SolverPort`·`PreferenceScoringPort`·`CandidatePoolPort`·`TravelEstimatePort`.
- **불변식**: 사용자 노출 시각·순서 = 솔버 검증값만(INV-2), duration 미표시(INV-3).

### C9. Plan-B Detection (모듈 9) · 에픽 F · FR-PLANB · **딥 모듈**
- **목적**: 활성 일정 + 실시간 신호(날씨·휴무·위치·체류) → 재계획 트리거 판정(사용자 비가시 임계·노이즈 필터).
- **책임**: 트리거 조건(강수·휴무·이동 지연·체류 초과) 감지, 노이즈/중복 폐기, 전역 빈도 상한·민감도, "그대로 둘게요" 억제 상태, 허위 알림 금지(외부 API 실패 시 무발화).
- **api**: `PlanBDetectionFacade`.
- **소비 포트**: `WeatherPort`(via C11)·`TravelEstimatePort`·위치 신호.
- **이벤트**: `PlanBTriggered`(→ 알림·재계산 제안).
- **PBT**: 노이즈 폐기·영향 신호만 트리거(불변식).

### C10. Itinerary Recalculation (모듈 10) · 에픽 F · FR-PLANB·FR-SOLVER · **딥 모듈**
- **목적**: 잔여 일정 재최적화 — `SolverPort.recalculate`(warm-start)로 대안 2~3개 + 재정렬안 산출.
- **책임**: 현재 위치·시각·고정 제약 입력, 대안 후보(솔버 검증분만), 변경 전/후 diff, 제외·이월 명시, 수동 폴백 전환.
- **api**: `RecalculationFacade`.
- **소비 포트**: `SolverPort`·`CandidatePoolPort`·`PreferenceScoringPort`(사유 해석·설명)·`TravelEstimatePort`.
- **불변식**: 재정렬 결과도 솔버 검증 통과분만 확정 후보(INV-2).

### C11. Weather & Context (모듈 11) · 에픽 F · FR-PLANB·ADR-0011
- **목적**: 날씨·맥락 데이터 수집, 일정 생성·Plan-B 감지에 공급.
- **api**: `ContextFacade`.
- **외부 포트**: `WeatherPort`(공공데이터포털/OpenWeather 어댑터). 실패 시 침묵(허위 알림 금지).

### C12. Travel Archive (모듈 12) · 에픽 G·H · FR-RECORD·ADR-0013 · **plan/actual/changelog 소유**
- **목적**: 방문·동선·**사진 메타데이터**·메모·변경 이력 보관.
- **책임**: plan/actual/change-log 3종 구분 저장, 방문 체크·실제 체류 산출, GPS 기록(동의 시), **사진 = 로컬 자산 참조 + 서버 메타데이터만**(자산 ID·촬영 시각·EXIF 위치·연결 장소), 오프라인 로컬 저장·동기화, 숙소·날짜 귀속.
- **api**: `ArchiveFacade`.
- **외부 포트**: `LocalPhotoAssetPort`(온디바이스 자산 참조), `ObjectStoragePort`(S3 — **커뮤니티 공개 사진만** EXIF 제거 후 업로드).
- **이벤트**: `VisitChecked`(→ Plan-B 체류 초과 입력), `TripEnded`(→ 회고 생성).

### C13. AI Reflection/Summary (모듈 13) · 에픽 H · FR-RECORD · **딥 모듈**
- **목적**: 기록 기반 당일 회고·전체 요약·스타일 분석·다음 여행 제안 생성.
- **책임**: 근거 데이터 기반 생성(환각 금지), 실패 시 비어 있지 않은 기본 카드(방문 N곳·이동 Nkm·사진 N장), 부분 데이터 누락 명시, 스타일 분석 임계(누적 방문 ≥10).
- **api**: `ReflectionFacade`.
- **소비 포트**: `PreferenceScoringPort`/`LlmGatewayPort`(생성), `ArchiveFacade`.
- **PBT**: 입력 비어도 기본 카드 비지 않음(불변식).

### C14. Notification (모듈 14) · 에픽 I · FR-NOTIF·ADR-0007 · **딥-ish**
- **목적**: 이중 경로(foreground 인앱 + background 푸시) 전달·**catch-up**(누락 0).
- **책임**: 종류별·채널별 토글, 중복 억제·빈도 상한, 미수신 재접속 catch-up, 커뮤니티 좋아요·댓글 알림 묶기·self-notification 제외.
- **api**: `NotificationFacade`(이벤트 구독).
- **외부 포트**: `PushPort`(FCM/APNs 어댑터), `RealtimePort`(WS/SSE).
- **구독 이벤트**: `StayRegistered`·`PlanBTriggered`·`ReflectionReady`·`CommunityReaction` 등.

### 후속 게이트 컴포넌트 (인터페이스만)
- **C15. Community (모듈 15)** · 에픽 K — `CommunityFacade`(공개/복제/좋아요/댓글/신고). 소비: `TripFacade`·`ItineraryGenerationFacade`(복제 재검증)·`ObjectStoragePort`(공개 사진 S3)·`ModerationPort`(금칙어·검토). 출시 선결 인프라(신고 큐·검토 보류·금칙어·양방향 차단)는 계약에 명시, 상세는 후속.
- **C16. Conversational Assistant (모듈 16)** · 에픽 J — `AssistantFacade`(자연어 → 모듈/솔버 라우팅·설명·재질의). **소비만**: `SolverPort`·`AccommodationSearchFacade`·`ItineraryGenerationFacade`·`RecalculationFacade`. 권한 경계(컨텍스트 주입 필터)·가드레일·rate-limit 계약. 단독 확정 금지(§3.5 위임). 상세는 후속.
- **C17. Collaborative Editing (모듈 17)** · 에픽 L — `CollabFacade`(초대·권한·항목 잠금·충돌 해소·동기화). 소비: `ItineraryGenerationFacade.validate`(=`SolverPort.validate`), `ArchiveFacade`(change log). MVP=soft lock. 상세는 후속.

---

## 3. AI / 솔버 계약 컴포넌트 (심화) ★

> **원칙(FR-SOLVER·ADR-0008·0015)**: **판단(judgment)은 LLM, 진실(truth)은 결정론적 컴포넌트.** 아래 포트로 경계를 못 박아, Phase 1(결정론적 솔버)에서 향후 Bedrock 에이전트로 **어댑터 교체만으로 대체**하되 실현가능성 소유권은 불변으로 유지한다.

### 3.0 불변식 (Invariants — 위반 시 재설계)
- **INV-1 (closed-set)**: LLM/에이전트는 **`CandidatePoolPort`가 그라운딩한 후보에서만** 선택. 웹/환각 POI 직접 사용 금지 → 반드시 Place Data(C7) 등록·검증 후.
- **INV-2 (검증 시각만 노출)**: 사용자에게 보이는 시각·순서는 **`FeasibilityValidator`/솔버가 검증한 값만**. LLM 생성 시각 직접 노출 금지.
- **INV-3 (거리만 표시)**: 이동 **소요시간(duration) 미표시** — DTO에 duration 필드 없음, 거리만(ADR-0009).
- **INV-4 (결정론적 폴백)**: AI 실패 시 결정론적 폴백(침묵 실패 금지, ADR-0011).

### 3.1 `SolverPort` (일정 지능 엔진 추상화) — FR-SOLVER-01·02·04
- **소유**: Itinerary Generation(C8)·Recalculation(C10) 도메인이 정의, **별도 솔버 서비스(Python)가 구현**.
- **어댑터**: Phase 1 `DeterministicSolverAdapter`(OPTW/TOPTW) / 향후 `BedrockAgentSolverAdapter`(옵션 B).
- **계약 보장**: 반환 일정의 모든 시각·순서는 검증됨(INV-2), 앵커·영업시간·이동 버퍼·시각 충돌 없음, `QualityScore` 포함.
- 시그니처는 `component-methods.md §SolverPort`.

### 3.2 `FeasibilityValidator` (결정론적 검증 도구) — 실현가능성 **소유자**
- **역할**: 시간창(영업시간)·이동 버퍼·앵커·필수 방문지 포함·시각 충돌을 판정. **두 단계 불변** — Phase 1은 솔버 내부, 향후 Bedrock 단계는 에이전트가 호출하는 도구(Q2=A). INV-2의 강제 지점.
- **순수 함수 성격** → **PBT 1순위**(시간창 비충돌·필수 방문지 보존 불변식).

### 3.3 `PreferenceScoringPort` / `LlmGatewayPort` (LLM 판단 계층)
- **역할**: (a) 취향·자유 텍스트 해석 → `PreferenceVector`, (b) 후보 POI 선호 점수화 → 솔버 목적함수 보상값, (c) 배치 **설명 문구** 생성(표시용, 시각 불변). 어시스턴트·회고도 재사용.
- **어댑터**: `LlmGatewayAdapter`(향후 Bedrock). rate-limit·가드레일·권한 경계(타 사용자 데이터·내부 지표 컨텍스트 주입 차단, ADR-0015)는 이 경계에서 강제.

### 3.4 `CandidatePoolPort` (RAG 그라운딩) — Place Data(C7)
- **역할**: (지역·카테고리·필터) → **실재 POI 후보 풀**. 그라운딩 미확인은 제외(INV-1). LLM 선택의 closed-set을 공급.

### 3.5 어시스턴트 위임 계약 (C16, 후속 인터페이스)
- 어시스턴트는 `SolverPort`·모듈 facade를 **호출·조립·설명만**. 변경은 사용자 명시 적용 시 `SolverPort.validate` 재검증 후에만 반영, **자동 확정·저장 금지**. 시각·거리는 솔버 검증값(INV-2).

### 3.6 폴백 체인 (INV-4 · US-SCHED-09·US-PLANB-04/11)
```
LLM 취향해석/설명 실패      → 결정론적 솔버 결과 제공 + 설명 문구만 생략
CandidatePool(장소API) 실패 → 부분 결과 + "일부 추천 빠짐" 안내
TravelEstimate(라우팅) 실패 → 직선거리 추정(추정치 표기)
SolverPort 전면 실패        → 최소 일정(앵커 + 시각 고정 필수 방문지만) + 재시도
Plan-B 외부신호 API 실패    → 자동 트리거 무발화(허위 알림 금지) · 수동 경로 유지
```

### 3.7 품질 score & 교체 트리거 (FR-SOLVER-02 · Open O-SOLVER)
- `QualityScore { preferenceFit, constraintSatisfaction, routeEfficiency, composite }` — 솔버 산출물에 부착.
- **용도**: Phase 1 산출물 품질 관측 지표. **composite가 부적절('별로')하다고 판단되면** 엔진을 Bedrock 어댑터로 **교체**(프로젝트 수준 결정, 런타임 폴백 아님).
- **이연**: score 산식·가중치·**임계값**·판정 프로세스는 CONSTRUCTION(Functional Design/NFR)·운영 결정(**O-SOLVER**). 이번 단계는 **자료구조·부착 지점·의사결정 위치**만 확정.
