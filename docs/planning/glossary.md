# 용어집 (Glossary)

> 출처: aidlc-docs/inception/application-design/components.md · aidlc-docs/inception/application-design/services.md · aidlc-docs/construction/u1-foundation/functional-design/domain-entities.md · aidlc-docs/inception/requirements/requirements.md (ADR 제목·유닛/에픽 매핑은 unit-of-work.md·prd-extracts.md·gap-analysis.md 교차 확인) · aidlc-docs에서 2026-07-05 추출 · 이후 본 문서가 정본이다.

이 문서는 TripPilot 팀이 설계·개발 문서 전반에서 만나는 도메인 용어, 기술·아키텍처 용어, 외부 연동 용어, 그리고 추적성 코드 접두사(M/C/D/Δ/N/P/BR/G/US/E/U/S 등)를 한곳에 모은 사전이다. 각 항목은 한 줄 정의 + 관련 기획/설계 문서 링크로 구성한다. 절 안에서는 국문은 가나다, 영문 약어는 알파벳 순으로 정렬한다.

- 링크는 형제 기획/설계 문서(같은 `docs/planning/` 폴더)를 상대경로로 가리킨다.
- 하나의 용어가 여러 문서에 걸치면 대표 문서 1~2개만 링크한다.

---

## 1. 핵심 도메인 용어

여행자·여행·일정·장소·기록을 다루는 제품 도메인의 1급 어휘다.

| 용어 | 정의 | 관련 문서 |
|---|---|---|
| **거점 (base)** | 여행의 기준점이 되는 등록 숙소. AI 일정 생성의 출발점이며(ADR-0002·0004), 여행과 날짜 구간으로 연결(BaseAssignment)되고 같은 여행 내 거점끼리만 날짜 비중첩 검증을 받는다(D15). 첫날 거점이 없으면 여행지 중심 좌표가 기본 거점이 된다(G41). | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **등록 숙소 (SavedStay)** | 외부에서 예약했거나 앱에서 저장한 숙소를 '등록'해 계정 레벨 풀에 보관한 항목. 여행 없이도 등록 가능하고, 거점 연결·일정 생성의 입력이 된다. 등록 시점 스냅샷(이름·주소·좌표)을 '사용자 입력 데이터'로 영구 저장(D13). | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **도착 확인 프롬프트** | 지오펜스 진입·외부 지도앱 복귀 시 '도착하셨나요?'를 띄우는 방식(D23). 자동 기록은 없고 확정·완료는 항상 사용자 탭이며, 위치 감지와 무관하게 수동 '도착' 탭은 언제나 가능하다(ADR-0010). | [flows.md](flows.md) · [units/u6-execution.md](units/u6-execution.md) |
| **동의 증적 (ConsentRecord)** | 약관 동의·철회의 법정 증적. 행 단위 불변·추가 전용(append-only)이며 항목·일시·버전 3요소가 최소 구성이다. 현재 동의 상태는 최신 GRANT/REVOKE 행의 폴드로 유도한다(N2·N3). | [domain.md](domain.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **닉네임 자동 생성** | '형용사+여행명사+2자리 숫자' 패턴으로 항상 값이 존재하게 만드는 규칙(G23). 자동 생성값만으로 온보딩을 통과할 수 있고, 2~20자·금칙어(C3)·중복 검증을 거친다. | [domain.md](domain.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **방문 상태 머신 (Visit)** | 개별 방문지의 실행 상태. `UPCOMING → ARRIVAL_PENDING → IN_PROGRESS → COMPLETED`(또는 어느 상태에서든 `SKIPPED`). 소유는 M18, 기록 영속은 M12. 종료 시각은 다음 장소 체크 시각으로 추정(D23). | [flows.md](flows.md) · [units/u6-execution.md](units/u6-execution.md) |
| **소프트 삭제·30일 유예** | 계정·여행 삭제 시 즉시 비노출(deletedAt 마킹) 후 30일 뒤 완전 삭제하는 정책(D18). 유예 중 동일 식별자 재가입은 제한(C4), 위치 발자취는 즉시 파기, 법정 보존 데이터만 분리 보관. | [domain.md](domain.md) · [decisions.md](decisions.md) |
| **스냅샷 (등록/확정 시점 사본)** | 사용자가 확정한 데이터(등록 숙소·필수 방문지·방문 체크·plan 일정)를 확정 시점 값으로 동결해 영구 저장한 불변 사본(D13·G132). 지도 API의 영구 캐싱 금지 약관을 우회하기 위해 '사용자 입력 데이터'로 취급한다(ADR-0017, 법무 확인 전제 P2). | [domain.md](domain.md) · [decisions.md](decisions.md) |
| **여행 상태 머신 (Trip)** | 여행 단위 생명주기. `PLANNED → CONFIRMED → ACTIVE → ENDED`. CONFIRMED 전이는 M8의 일정 확정 이벤트, ACTIVE/ENDED 전이는 M18이 트리거하며 정본은 M6이 보관한다. ACTIVE 내 하위 상태로 NORMAL/REST(휴식 모드)가 있다. | [flows.md](flows.md) · [units/u4-trip.md](units/u4-trip.md) |
| **온보딩 완료 판정** | '약관 동의 + 닉네임 통과'만으로 온보딩을 완료로 본다(G24). 취향 7종은 건너뛰어도 완료 처리되며, 미설정 축은 이후 점진 설정 카드로 회수한다. | [domain.md](domain.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **위시리스트** | 계정에 귀속해 저장·삭제·메모하는 숙소 즐겨찾기(M3). 가격 변동 가능 고지, 외부 소스 소실 시 stale(오래됨) 표시. 등록(M4)과 통합 목록으로 노출되며 출처 라벨로 구분한다(G103). | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **위치 동의 3층 (L1·L2·L3)** | 위치 기능을 3개 동의 층의 조합으로 관리하는 모델(G182). L1=OS 위치 권한(단말), L2=위치기반서비스 이용약관 필수 동의(서버), L3=GPS 발자취 보관 선택 옵트인. 서버 위치 서비스는 L1∧L2, 발자취 보존은 L1∧L2∧L3일 때만 허용된다. | [domain.md](domain.md) · [nfr.md](nfr.md) |
| **위치정보 법정 로그 (LocationLegalLog)** | 위치정보 수집·이용·제공 사실 확인자료. append-only, 최소 6개월 보존, 애플리케이션 역할은 삭제 권한이 없다(N2, SECURITY-14). 원시 좌표는 담지 않으며 계정 삭제·GPS 파기와 독립으로 보존된다. | [domain.md](domain.md) · [nfr.md](nfr.md) |
| **취향 7종** | 개인화 입력이 되는 7개 축: ①스타일 ②예산 ③동행(+반려동물 분리 불리언) ④활동 ⑤이동 방식 ⑥음식 ⑦페이스. 축별 NULL=미설정이고, 미설정이어도 조회 시 중립 기본값이 채워져 일정 생성이 실패하지 않는다. | [domain.md](domain.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **취향 중립 기본값** | 미설정 축에 대해 저장하지 않고 조회 시점에 파생 주입하는 값. 무가중치가 기본이며 이동 방식 미설정 시 '대중교통' 보수 추정을 쓴다. `isNeutralDefault` 플래그로 사용자 선택값과 구분한다(INV-PR2). | [domain.md](domain.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **캐노니컬 숙소 ID (canonical stay ID)** | 소스별 외부 숙소 ID들을 N:1로 묶는 내부 표준 숙소 식별자(StayIdentity). 좌표+이름 유사도 자동 매칭 + 운영자 보정으로 통합한다(D17). | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **캐노니컬 POI ID (canonical POI ID)** | 카카오·TourAPI 등 소스별 place_id를 N:1로 묶는 내부 표준 장소 식별자(M7). 좌표 근접(50m)+명칭 유사도로 매칭하고 한국어명 정본+영문 alias를 둔다(G133/G148). closed-set 후보 풀의 원소 ID가 된다. | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **편도(open-ended) 동선 / 숙소 전환일** | 숙소를 바꾸는 날의 동선을 '출발점=A 숙소, 복귀점=B 숙소'인 편도로 모델링하는 방식(G50). 다중 숙소 여행에서 날짜별 기준점이 자동 전환된다. | [flows.md](flows.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **필수 방문지 (MustVisit)** | 사용자가 여행에 반드시 넣도록 지정한 장소. 포함 고정형(`ANYTIME`, 기본)과 시각 고정형(`FIXED`) 2유형이 있고, 일수 비례 한도(하루 3곳×일수, G40), 저장 POI는 사본 복제로 투입(G129). 솔버에서 필수 노드/고정 블록으로 다뤄진다. | [domain.md](domain.md) · [units/u4-trip.md](units/u4-trip.md) |
| **휴식 모드 (REST)** | 여행 진행 중(ACTIVE) 하위 상태. 경미 트리거·일정 알림을 억제하고 심각 사유(기상특보·고정 일정 위협)만 유지한다. 재개 시각 도달 시 알림 + 남은 일정 재계산을 제안한다(G54). | [flows.md](flows.md) · [units/u6-execution.md](units/u6-execution.md) |
| **plan / current / actual / changelog** | 일정 데이터의 4원 구분(ADR-0013, D14). **plan**=확정 시 동결되는 불변 스냅샷(소유 M8), **current**=여행 중 편집·Plan-B가 반영되는 가변 현재본(변경 주체 M8·M10), **actual**=실제 방문 기록(소유 M12), **changelog**=변경 이력(통합 diff 스키마 G132, 소유 M12). 회고는 plan과 actual을 대조한다. | [domain.md](domain.md) · [decisions.md](decisions.md) |
| **Plan-B** | 여행 중 변수(날씨·휴무·이동 지연·체류 초과)에 대응해 당일 잔여 일정을 재계획하는 기능. 자동 트리거 4종을 감지(M9)하되 사용자 동의 전에는 어떤 일정도 바꾸지 않고, 사용자가 '대안 보기'를 눌러야 재계획 세션(M10)이 시작된다. 예약 변경이 아니라 실행 보조다(ADR-0006). | [flows.md](flows.md) · [units/u6-execution.md](units/u6-execution.md) |
| **POI (Point of Interest)** | 관광지·식당·카페 등 방문 대상 장소. M7 Place Data가 외부 소스를 단일 표준 스키마로 정규화해 전 모듈에 공급한다(ADR-0009). 상태는 ACTIVE/UNVERIFIED(영업시간 미확인)/LOST(확인 불가)/CLOSED로 구분한다. | [domain.md](domain.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |

---

## 2. 기술·아키텍처 용어

시스템이 어떻게 조립·동작하는지를 규정하는 어휘다.

| 용어 | 정의 | 관련 문서 |
|---|---|---|
| **가드레일 (guardrail)** | AI 어시스턴트(M16, 후속)가 모듈을 호출·위임할 때 적용하는 안전 제약. 잘못된 실행·권한 밖 접근을 막는다. LLM 권한 경계(ADR-0015)와 함께 신뢰 경계를 형성한다. | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| **결정론적 솔버 폴백** | LLM 경로가 실패·타임아웃하면 규칙 점수(카테고리-취향 매핑+인기 가중)로 대체하고, 최악의 경우 숙소+시각 고정형 필수 방문지만 배치한 최소 일정을 반환하는 폴백. "기본 모드"로 사용자에게 고지한다(ADR-0011). | [flows.md](flows.md) · [architecture.md](architecture.md) |
| **그라운딩 (LLM grounding)** | LLM이 실재하는 데이터 위에서만 답하게 보장하는 것. TripPilot은 LLM이 closed-set 후보 풀의 ID에서만 선택하도록 설계해 그라운딩 실패를 구조적으로 불가능하게 한다(G115). | [architecture.md](architecture.md) · [nfr.md](nfr.md) |
| **도메인 이벤트 (domain event)** | 모듈 간 비동기 통신 수단. 소유 모듈이 애그리거트 상태 변경과 함께 발행하고 구독 모듈이 반응한다(예: `ItineraryConfirmed`, `TriggerFired`, `TripEnded`). 공통 봉투는 eventId·eventType·occurredAt·aggregateKey·schemaVersion. | [flows.md](flows.md) · [architecture.md](architecture.md) |
| **멱등(idempotent) / at-least-once** | 아웃박스 릴레이는 이벤트를 최소 1회(at-least-once) 발행하므로 중복이 발생할 수 있고, 모든 구독자는 eventId 기준 멱등 처리(같은 이벤트를 여러 번 받아도 결과가 같음)를 필수로 한다. | [architecture.md](architecture.md) · [flows.md](flows.md) |
| **모듈러 모놀리스 (modular monolith)** | 17(+1)개 기능 모듈(M1~M18)+공통(C1~C3)을 단일 배포 단위 안에서 모듈 경계로 나눈 백엔드 아키텍처(D04). 각 모듈은 자기 소유 테이블에만 쓰고, 타 모듈은 공개 퍼사드(동기) 또는 도메인 이벤트(비동기)로만 접근한다. 스케줄러·워커도 동일 배포 내 스레드지만 추후 분리 워커 전환이 가능하게 경계를 지킨다. | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| **성능 예산 (performance budget)** | 각 플로우 단계에 배분한 시간 상한. AI 일정 생성=첫 1일 5초/전체 20초, Plan-B=10초(D38). LLM 등 예산 초과 위험 단계는 타임아웃을 예산보다 짧게 잡아 폴백 전환 시간을 확보한다. | [nfr.md](nfr.md) · [flows.md](flows.md) |
| **소프트 가중치 (soft weight)** | 솔버가 반드시 지킬 필요는 없지만 선호로 반영하는 값. 예산은 하드 제약이 아니라 LLM 추천 소프트 가중치 + 숙소 필터 상한으로만 쓴다(G37/G47). 하드 제약과 대비되는 개념. | [architecture.md](architecture.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **솔버 (Solver Engine, C2)** | OPTW/TOPTW(시간창 있는 오리엔티어링 문제) 최적화로 POI의 선택·순서·시각을 정하는 공통 엔진. 하드 제약 검증·이동시간 추정·결정론적 폴백을 소유하며 LLM이 실현 불가능한 일정을 내지 못하게 막는다(ADR-0008). | [architecture.md](architecture.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **스케줄러 잡 (J1~J10)** | 단일 배포 내 워커로 도는 배치 작업 집합. J1 날씨 폴링, J2 휴무 재조회, J3 여행 자동 종료·일자 경계, J4 리마인드 발송 큐, J5 인기 장소 집계, J6 삭제 유예 만료, J7 POI 정본 동기화, J8 미인증 정리, J9 알림함 보존 정리, J10 아웃박스 릴레이. 중복 실행은 분산 잠금/`SKIP LOCKED`로 방지한다. | [flows.md](flows.md) · [architecture.md](architecture.md) |
| **아웃박스 릴레이 (outbox relay, J10)** | 커밋된 아웃박스 레코드를 폴링해 실제 이벤트로 발행하고 발행 마킹하는 인프라 잡. 크래시 시 미마킹분을 재발행하므로 at-least-once가 보장된다. | [architecture.md](architecture.md) · [flows.md](flows.md) |
| **이동시간 부등식 / 안전계수 / 우회계수** | 솔버가 두 지점 이동 소요를 추정하는 제약. 직선거리에 우회계수(기본 1.3)·수단 계수(대중교통 ×1.5·도보 ×1.4)를 곱하고 버퍼(15분)를 더한다(G106, remote config 조정). 화면에는 소요시간을 표시하지 않고 거리만 노출한다(D25/Δ1, ADR-0009). | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| **지오펜스 (geofence)** | 방문 예정지 주변에 설정한 가상 경계. 포그라운드에서 진입이 감지되면 도착 확인 프롬프트를 띄운다. 백그라운드 위치 권한은 요청하지 않는다(D27, G62). | [flows.md](flows.md) · [units/u6-execution.md](units/u6-execution.md) |
| **침묵 실패 금지 (ADR-0011)** | 모든 컴포넌트가 자기 외부 의존·AI 산출의 폴백 경로를 소유하고, 실패 시 사용자 관찰 가능한 대체 경로를 제공해야 한다는 원칙. 모든 외부 의존 단계는 '명시적 타임아웃 + 폴백 + 사용자 고지' 3요소를 갖는다(RESILIENCY-10). | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| **클라이언트 경량 검증기 (D28)** | 편집 중 매 수정마다 클라이언트에서 도는 경량 제약 검사. 위반을 배지로 표시하되 차단하지 않고, 저장 시 서버가 확정 검증(C2)을 한다. 무거운 최적화는 서버, 경량 검증은 클라이언트로 분리한다. | [architecture.md](architecture.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **퍼사드 (공개 퍼사드, public facade)** | 모듈이 외부에 노출하는 유일한 동기 진입점. deny-by-default이고 리소스 소유권 검증(IDOR 방지)은 소유 모듈 책임이다. 타 모듈 데이터는 반드시 퍼사드나 이벤트로만 접근한다(D04, SECURITY-08). | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| **포트/어댑터 (Port/Adapter)** | 모든 외부 API를 `{Capability}Port` 인터페이스 뒤 `{Vendor}Adapter` 구현으로 격리하는 계약(D37, RESILIENCY-10). PR CI는 Port fake로 테스트하고, 실 어댑터는 타임아웃+서킷 브레이커+실패율 계측을 갖는다. | [architecture.md](architecture.md) · [nfr.md](nfr.md) |
| **트랜잭셔널 아웃박스 (transactional outbox)** | 애그리거트 상태 변경과 아웃박스 레코드 insert를 단일 DB 트랜잭션으로 묶고, 커밋 후 릴레이(J10)가 이벤트를 발행하는 패턴. DB 상태와 이벤트 발행의 원자성을 보장한다. | [architecture.md](architecture.md) · [flows.md](flows.md) |
| **하드 제약 (hard constraint)** | 솔버가 반드시 지켜야 하는 위반 불가 규칙. 영업시간 내 배치, 이동시간 부등식, 고정 블록(숙소 체크인/아웃·시각 고정형 필수 방문지·LOCK 슬롯) 불변, 국내 좌표 범위, POI 그라운딩, 계정 무결성 등. 소프트 가중치와 대비된다. | [architecture.md](architecture.md) · [nfr.md](nfr.md) |
| **closed-set 후보 풀** | 여행 컨텍스트(권역·시간창·취향)로 M7이 구성하는 폐쇄형 후보 집합. LLM은 이 집합의 ID에서만 선택하므로 그라운딩 실패가 구조적으로 불가능하다(G115). | [architecture.md](architecture.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **LLM Gateway (C1)** | 단일 벤더 관리형 LLM을 서버 경유로 호출하는 공통 컴포넌트. 기능별 모델 티어 라우팅(취향 해석·재질의=경량, 회고·설명=상위, D11), 서버 재조회 컨텍스트 주입(D31/ADR-0015), 출력 스키마 검증, 실패 시 결정론 폴백을 담당한다. | [architecture.md](architecture.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **warm-start** | 일정 재생성·재계획 시 LOCK 슬롯·체류 고정값·수동 추가 POI·완료 방문지를 고정 블록으로 보존하고 나머지만 다시 푸는 것(G46/G136). 사용자가 확정한 부분의 손실을 막는다. | [flows.md](flows.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |

---

## 3. 테스트·품질·복원력 용어

전 단계 차단 제약으로 적용되는 기준선(Baseline) 어휘다.

| 용어 | 정의 | 관련 문서 |
|---|---|---|
| **관측성 (observability)** | 구조화 로그 + APM/크래시 리포팅 + 외부 API 실패율 대시보드로 시스템을 계측하는 요건(G144, RESILIENCY-05). 침묵 실패 금지의 서버측 근거로, 외부 API 실패·LLM 오류·솔버 검증 실패는 전부 계측 대상이다. shallow/deep 헬스체크를 둔다. | [nfr.md](nfr.md) · [infrastructure.md](infrastructure.md) |
| **규모 가정 (scale assumption)** | 초기 국내 출시 규모 전제: DAU 1천 / 동시 일정 생성 10건 / 지역당 POI 후보 5천(G142, §6.8). 오토스케일 한도·비용 상한 알람 설계의 입력이다. | [nfr.md](nfr.md) · [infrastructure.md](infrastructure.md) |
| **기준선 (Baseline: Security/Resiliency/PBT)** | 요구사항 단계에서 옵트인해 전 단계 차단 제약으로 적용하는 규칙군. Security(SECURITY-01~15) 전체 강제, Resiliency(RESILIENCY-01~15) 적용, PBT(PBT-01~10) 전체 강제. 비준수는 차단 사유(blocking)다. | [nfr.md](nfr.md) · [decisions.md](decisions.md) |
| **하드 제약 게이트 (CI gate)** | 하드 제약 검증 테스트(숙소 기준점·충돌 무배치·POI 그라운딩·계정 무결성)를 100% 통과해야 머지되는 CI 차단 게이트(G114). 그 외 테스트는 비차단 리포트로 시작한다. | [nfr.md](nfr.md) · [units/u5-itinerary.md](units/u5-itinerary.md) |
| **DR / Backup & Restore** | 재해 복구 전략. 데이터는 관리형 DB 자동 백업(+PITR 권장)으로 보호하고, 재해 시 IaC 재배포 + 백업 복원으로 복구한다(CQ4=A, RESILIENCY-02·11). | [nfr.md](nfr.md) · [infrastructure.md](infrastructure.md) |
| **E2E 종단 테스트** | API 레벨 시나리오(숙소 저장→등록→일정 생성→재계획)를 CI 필수로, UI E2E는 핵심 해피패스 1~2개만 두는 방침(G118). 유닛 진행에 따라 CI에 점증 편입된다. | [nfr.md](nfr.md) · [units/u6-execution.md](units/u6-execution.md) |
| **KWCAG (접근성)** | 한국형 웹 콘텐츠 접근성 지침. 핵심 여정 화면(온보딩·일정·여행 중·재계획)에 우선 준수하고 나머지는 후속으로 둔다(G143). | [nfr.md](nfr.md) · [scope.md](scope.md) |
| **Multi-AZ (다중 가용영역)** | 단일 리전 안에서 컴퓨트를 2개 이상 가용영역에 분산하고, 관리형 PostgreSQL을 Multi-AZ로 구성하며 로드밸런서를 다중 AZ로 분산하는 토폴로지(RESILIENCY-08). RTO/RPO 시간 단위 목표와 정합. | [infrastructure.md](infrastructure.md) · [nfr.md](nfr.md) |
| **PBT (속성 기반 테스트, Property-Based Testing)** | 무작위 입력을 생성해 '항상 성립해야 하는 속성'을 검증하는 테스트 기법(PBT-01~10 전체 강제). 솔버 하드 제약, 직렬화 왕복, 상태 머신(여행·일정·방문)이 1급 대상이다. 백엔드=Kotest, 클라이언트=fast-check, 시드 로깅·수축(shrinking) 필수. | [nfr.md](nfr.md) · [units/u1-foundation.md](units/u1-foundation.md) |
| **RTO / RPO** | 재해 복구 목표. RTO=복구 소요 시간 목표, RPO=허용 데이터 손실 시간 목표. TripPilot은 둘 다 '시간 단위'로 설정하고 DR 전략은 Backup & Restore(CQ4=A). | [nfr.md](nfr.md) · [infrastructure.md](infrastructure.md) |

---

## 4. 외부 연동·데이터 소스

플랫폼이 의존하는 외부 API와 그 데이터 규약이다.

| 용어 | 정의 | 관련 문서 |
|---|---|---|
| **기상청 공공데이터포털** | 날씨 소스. 단기예보(강수확률)+기상특보를 수집해 Plan-B 트리거 (a)에 쓴다(D10). 무응답 시 트리거 침묵(허위 알림 금지)로 폴백한다. | [infrastructure.md](infrastructure.md) · [units/u6-execution.md](units/u6-execution.md) |
| **아웃바운드 클릭 (제휴 링크)** | OTA 딥링크로 나가는 이탈을 내부 집계 전용으로 기록하는 지표(M5). 사용자·LLM 컨텍스트에 노출하지 않으며(SECURITY-11), 제휴 수수료 고지와 복귀 핸드오프 판단에 쓴다. | [flows.md](flows.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **지도 API 약관 (캐싱 정책)** | 국내 지도 API는 영구 캐싱 금지·실시간 호출·출처 표기가 요구된다(ADR-0017). 그래서 탐색·추천 풀은 TTL 캐시로, 사용자 확정분만 스냅샷으로 저장한다(D13). 약관 적합성 법무 확인은 선결 과제(P2). | [decisions.md](decisions.md) · [nfr.md](nfr.md) |
| **카카오 / 카카오모빌리티 / 네이버** | 지도·장소 스택. 카카오=장소 검색·지오코딩(1차), 카카오모빌리티=도로 거리, 네이버=2차 폴백(D08). Port/Adapter로 격리해 벤더 비종속을 유지한다. | [infrastructure.md](infrastructure.md) · [architecture.md](architecture.md) |
| **기상청·TourAPI·OTA 등 데이터 규약** | 공공 소스(TourAPI 등 캐싱 허용)는 정본 캐시로, 상업 소스는 약관 최소치로만 호출한다. 전 외부 호출은 타임아웃+서킷 브레이커+폴백을 갖춘다(ADR-0011). | [infrastructure.md](infrastructure.md) · [decisions.md](decisions.md) |
| **FCM (Firebase Cloud Messaging)** | 단일 푸시 채널(iOS 포함, D12). 모든 알림은 서버 스케줄링으로 발송하고, 인앱 알림함(자체 DB, 90일 보존)을 항상 선(先) 적재해 푸시 실패 시에도 관측 가능하게 한다. | [infrastructure.md](infrastructure.md) · [units/u8-notification.md](units/u8-notification.md) |
| **OTA (Online Travel Agency)** | 외부 여행/숙소 예약 사업자. TripPilot은 실거래(예약·결제·재고)를 보유하지 않고 OTA에 위임한다(ADR-0003·0012). 국내 OTA 크롤링 금지, 리뷰·평점 미표시. | [scope.md](scope.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **OTA 딥링크** | 숙소 예약·결제를 위해 OTA로 보내는 외부 링크. 1차는 파트너별 URL 템플릿으로 만드는 '숙소명 검색 딥링크'만 제공하고(D09), 이동 직전 제휴 수수료를 고지한다. 포스트백 1탭 자동 등록은 후속(G29/G108). | [flows.md](flows.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |
| **TourAPI** | 한국관광공사 관광정보 공개 API. 캐싱 허용 공공 소스로 POI·숙소 정적 콘텐츠(유형 cat3·편의시설·영업시간)의 정본 동기화(J7)에 쓴다(D09·D13). 활용 신청·캐싱 조건 확인은 선결 과제(P4). | [infrastructure.md](infrastructure.md) · [units/u3-place-stay.md](units/u3-place-stay.md) |

---

## 5. 약어·코드 규칙 (추적성 접두사)

추적성 ID는 팀의 공용 어휘이므로 문서 전반에 그대로 등장한다. 접두사별 의미는 다음과 같다.

| 접두사 | 이름 | 범위·형식 | 의미 | 정본 문서 |
|---|---|---|---|---|
| **M** | 기능 모듈 (Module) | M1~M18 | 단일 책임을 갖는 기능 모듈(예: M1 Auth, M8 Itinerary Generation, M18 Trip Execution). | [architecture.md](architecture.md) |
| **C** | 공통(횡단) 컴포넌트 | C1~C3 | 어떤 기능 모듈에도 의존하지 않는 공통 컴포넌트: C1 LLM Gateway, C2 Solver Engine, C3 Content Moderation. ※ 요구사항 §7의 명확화 기본값 항목 코드(C1~C13)와 글자가 겹치므로 문맥으로 구분한다. | [architecture.md](architecture.md) |
| **D** | 확정 결정 (Decision) | D01~D38 | 요구사항 38문항으로 확정한 핵심 결정(예: D04 모듈러 모놀리스, D14 plan/current 이원 구조). | [decisions.md](decisions.md) |
| **Δ** | PRD 수정 델타 (Delta) | Δ1~Δ10 | 결정에 따라 원본 PRD 조항을 개정하는 변경분(예: Δ4 회고 트리거 개정, Δ7 M18 모듈 신설). 설계·구현 시 PRD 원문보다 우선한다. | [decisions.md](decisions.md) |
| **N** | 신규 기능 요구사항 (New) | N1~N8 | PRD에 없던 신규 FR(예: N1 연령 확인, N2 위치정보법 의무, N6 여행 제목, N7 M18 신설). | [user-stories.md](user-stories.md) |
| **P** | 비개발 선결 과제 (Prerequisite) | P1~P9 | 출시 전 완료가 필요한 비개발 항목(예: P1 위치기반서비스사업 신고, P6 LLM 벤더 계약, P7 약관 법무 작성). | [scope.md](scope.md) |
| **BR** | 비즈니스 규칙 (Business Rule) | BR-U{n}-xx | 유닛별 상세 비즈니스 규칙(예: BR-U1-01 이메일 중복 차단). 각 유닛의 Functional Design이 소유한다. | [units.md](units.md) |
| **G** | 갭 항목 (Gap) | G### | gap-analysis에서 식별한 빈틈과 그 확정 기본값(예: G115 closed-set 그라운딩, G182 위치 3층, G132 changelog 스키마). 설계 규칙의 추적 참조로 쓰인다. | [decisions.md](decisions.md) |
| **US** | 유저스토리 (User Story) | US-E{에픽}-{순번} | 에픽에 속한 유저스토리 ID(예: US-E1-01 소셜·이메일 회원가입). | [user-stories.md](user-stories.md) |
| **E** | 에픽 (Epic) | E1~E12 | 유저스토리 묶음 단위(§6 표 참조). | [epics.md](epics.md) |
| **U** | 작업 유닛 (Unit of Work) | U1~U11 | 개발 순서 단위. 1차 8개(U1~U8) + 후속 3개(U9~U11). 각 유닛은 Functional Design→NFR→Infra→Code Generation 루프를 완주한다. | [units.md](units.md) |
| **S** | 서비스 오케스트레이션 플로우 (Service) | S1~S9 | 모듈을 가로지르는 대표 흐름(예: S1 AI 일정 생성, S2 Plan-B 재계획, S6 계정 삭제 연쇄). ※ SECURITY-·RESILIENCY- 기준선 코드와는 별개다. | [flows.md](flows.md) |

**보조 코드**(문서에서 함께 등장):

| 접두사 | 의미 |
|---|---|
| **ADR-####** | 아키텍처 결정 기록(Architecture Decision Record), ADR-0001~0017. §6 참조. |
| **SECURITY-## / RESILIENCY-## / PBT-##** | 각각 보안·복원력·속성기반테스트 기준선 규칙 번호. §3의 기준선 항목 참조. |
| **INV-xx** | 엔티티 불변식(Invariant). 항상 참이어야 하는 데이터 제약(예: INV-A3 이메일 유일성). |
| **FD-U{n}-##** | 유닛 Functional Design에서 확정한 세부 결정. |
| **CP#** | 유닛 간 계약 포인트(Contract Point). 계약 테스트 대상 인터페이스. |
| **J#** | 스케줄러 잡(J1~J10). §2 스케줄러 잡 항목 참조. |
| **CQ# / Q#** | 요구사항 확정에 쓴 명확화 질문(CQ1~CQ4)·검증 질문(Q1~Q38). |

---

## 6. ADR (아키텍처 결정 기록) 색인

ADR은 아키텍처 수준의 결정을 기록하는 문서다. ADR-0001~0017은 전체적으로 '책임 분리'(LLM=해석·설명 / 솔버=실현가능성·시각 소유 / 외부 위임=예약·결제·길안내)라는 일관된 축을 공유한다. 원본에서 확인된 주요 ADR은 다음과 같다.

| ADR | 주제 |
|---|---|
| ADR-0002 / ADR-0004 | 등록 숙소 = AI 일정 생성의 출발점(거점 기반). |
| ADR-0003 / ADR-0012 | 앱은 실거래(예약·결제·재고)를 보유하지 않고 외부 OTA에 위임한다. 실제 길안내도 외부 지도앱 위임. |
| ADR-0005 | 액티비티(투어·체험) 전용 기능 제외 — 일정의 고정 블록은 등록 숙소와 사용자 지정 필수 방문지로만 구성한다. |
| ADR-0006 | 숙소 체크인/아웃 일시·위치는 변경 불가 — Plan-B는 예약 변경이 아니라 실행 보조다. |
| ADR-0007 | 회고 자동 생성 트리거 정의(원안 '마지막 숙소 체크아웃 이후' → Δ4로 '종료일 다음날 00:00 + 수동 종료'로 개정). |
| ADR-0008 | 역할 분리: LLM=취향 해석·점수·설명 / 솔버(알고리즘)=선택·순서·시각 보장. |
| ADR-0009 | POI 표준 스키마·벤더 비종속 + 이동 지표는 거리만 표시(소요시간 미표시), 경로는 핀 간 직선. |
| ADR-0010 | 방문 도착 확정은 항상 사용자 탭 — 수동 '도착' 탭은 위치 감지와 무관하게 언제나 가능. |
| ADR-0011 | 침묵 실패 금지 — 모든 외부 의존·AI 산출은 폴백 경로와 사용자 고지를 가진다. |
| ADR-0013 | 일정 데이터의 plan(불변 스냅샷)/current(가변)/actual/changelog 구분. |
| ADR-0014 | 커뮤니티에서 소셜 그래프(팔로우·구독·스크랩·평판) 미제공 — 타인 일정은 사본 복제(가져오기)로만 활용(후속). |
| ADR-0015 | LLM 컨텍스트는 서버 재조회 방식 — 클라이언트는 ID만 전달, 서버가 요청자 권한으로 재조회해 주입(권한 경계). |
| ADR-0016 | 동행 공동 편집(후속 게이트) — 서버 권위+낙관적 잠금 아키텍처 여지를 1차에 반영. |
| ADR-0017 | 지도 API 약관(영구 캐싱 금지·실시간 호출·출처 표기)과 위치정보법 반영을 데이터 모델 차원에서 강제. |

> ADR-0001은 원본에서 개별 제목이 확인되지 않았으나, 위 '책임 분리' 상위 원칙을 정의하는 최상위 ADR로 참조된다. 정확한 문안은 decisions.md 정비 시 PRD 원문(docs/PRD/)에서 확인한다.

---

## 7. 유닛(U)·에픽(E) 대응표

개발 순서 단위(U)와 유저스토리 묶음(E)의 대응이다. 상세는 [units.md](units.md)·[epics.md](epics.md).

| 유닛 | 이름 | 에픽 | 핵심 모듈 | 위상 |
|---|---|---|---|---|
| U1 | 기반·계정·온보딩 | E1 | M1, M2, C3 + 스캐폴드 | 1차 |
| U2 | 앱 셸·홈·내비게이션 | E2 | (클라이언트 중심)+부트스트랩 API | 1차 |
| U3 | 숙소·장소 데이터 | E3 | M3, M4, M5, M7 | 1차 |
| U4 | 여행 생성·필수 방문지 | E4 | M6 | 1차 |
| U5 | AI 일정 생성·확정 | E5 | M8, C1, C2 | 1차 |
| U6 | 여행 중 실행·Plan-B | E6+E7 | M18, M9, M10, M11 | 1차 |
| U7 | 기록·회고 | E8 | M12, M13 | 1차 |
| U8 | 알림·마이페이지·설정 | E9 | M14 (+각 모듈 설정) | 1차 |
| U9 | AI 어시스턴트 | E10 | M16 | 후속 게이트 |
| U10 | 여행자 커뮤니티 | E11 | M15 | 후속 게이트 |
| U11 | 동행 공동 편집 | E12 | M17 | 후속 게이트 |

---

## 8. 모듈(M/C) 한 줄 색인

전 모듈의 한 줄 책임이다. 상세는 [architecture.md](architecture.md).

| ID | 컴포넌트 | 한 줄 책임 | 위상 |
|---|---|---|---|
| M1 | Auth | 가입·로그인·토큰·동의 증적·계정 생명주기 | 1차 |
| M2 | User Profile | 닉네임·취향 7종·중립 기본값·개인화 입력 공급 | 1차 |
| M3 | Accommodation Search | 숙소 탐색·필터·상세·위시리스트 | 1차 |
| M4 | Saved Accommodation | 등록 숙소(계정 풀)·거점 연결·숙소 ID 통합 | 1차 |
| M5 | Affiliate Link | OTA 딥링크 생성·고지·아웃바운드 클릭 기록 | 1차 |
| M6 | Trip Creation | 여행 CRUD·예산·시간창·필수 방문지·여행 상태 머신 | 1차 |
| M7 | Place Data | POI 정본·canonical ID·하이브리드 캐싱·후보 풀 | 1차 |
| M8 | Itinerary Generation | 일정 생성 오케스트레이션·편집 재검증·일정 상태 머신 | 1차 |
| M9 | Plan-B Detection | 자동 트리거 4종 감지·억제·민감도 | 1차 |
| M10 | Itinerary Recalculation | 재계획 세션·후보 생성·전/후 비교·확정 | 1차 |
| M11 | Weather & Context | 기상청 예보·특보 수집·격자 변환·캐시 | 1차 |
| M12 | Travel Archive | actual 기록·사진·changelog·오프라인 동기화 | 1차 |
| M13 | AI Reflection | 회고·전체 요약·스타일 분석·공유 카드 | 1차 |
| M14 | Notification | 서버 스케줄링 발송·FCM·알림함·토글·방해금지 | 1차 |
| M15 | Community | 공개 스냅샷·피드·좋아요·댓글·신고·차단 | 후속 |
| M16 | Assistant | 대화 오케스트레이션·모듈 호출 위임·가드레일 | 후속 |
| M17 | Collaborative Editing | 초대·권한·항목 잠금·충돌 해소·프레즌스 | 후속 |
| M18 | Trip Execution | 활성 허브·도착 확인·방문 상태 머신·여행 종료 전이 | 1차 |
| C1 | LLM Gateway | 단일 벤더 서버 경유 호출·티어 라우팅·서버 재조회 주입·스키마 검증 | 1차(공통) |
| C2 | Solver Engine | OPTW/TOPTW 최적화·하드 제약 검증·이동시간 추정·결정론 폴백 | 1차(공통) |
| C3 | Content Moderation | 금칙어 사전 검증(닉네임·여행 제목 1차, UGC 확장 여지) | 1차(공통) |
