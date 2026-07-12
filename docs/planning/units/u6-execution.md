# 유닛 U6 상세 설계 — 여행 중 실행·Plan-B

> 출처: aidlc-docs/construction/u6-execution/functional-design/{domain-entities,business-rules,business-logic-model,frontend-components}.md, aidlc-docs/construction/u6-execution/nfr-requirements/{nfr-requirements,tech-stack-decisions}.md, aidlc-docs/construction/u6-execution/nfr-design/nfr-design-patterns.md, aidlc-docs/construction/u6-execution/infrastructure-design/infrastructure-design.md, aidlc-docs/construction/plans/u6-execution-{functional-design,nfr-design}-plan.md, aidlc-docs/inception/application-design/unit-of-work.md(§U6) · aidlc-docs에서 2026-07-05 추출 · 이후 본 문서가 정본이다.

## 1. 개요

### 1.1 이 유닛의 한 줄 정의

U6는 **"계획을 세우는 앱"을 "여행 중에 쓰는 앱"으로 만드는 유닛**이다. 확정된 여행 일정(U5 산출)이 현장 변수(날씨·휴무·이동 지연·체류 초과)에 부딪힐 때, 활성 일정 허브에서 방문을 진행·기록하고, 자동 트리거로 문제를 감지하며, **10초 내 대안(Plan-B)** 을 제시해 사용자가 일정을 이어가게 한다. 담당 서버 모듈은 M18 Trip Execution·M9 Plan-B Detection·M10 Itinerary Recalculation·M11 Weather & Context 4종이고, 여기에 U5가 완성한 C1 LLM Gateway·C2 Solver Engine을 **재사용**한다.

### 1.2 유닛 범위 — 에픽·스토리·모듈

| 구분 | 내용 |
|---|---|
| 소유 에픽·스토리 | **Epic 6(US-E6-01~03) + Epic 7(US-E7-01~13) = 16 스토리**. 1차 출시 유닛 중 스토리 최다·상태 머신 최다 |
| 서버 모듈 | M18 Trip Execution(실행 허브·방문/여행 상태 머신·종료 전이 정본), M9 Plan-B Detection(트리거 4종·억제), M10 Itinerary Recalculation(재계획 세션·후보·이월), M11 Weather & Context(기상청 예보·특보) |
| 재사용 자산 | C1 LLM Gateway(재계획 사유 해석)·C2 Solver Engine(하드 제약 4계열 재검증) — **U5 완성분, 계약 수준으로만 소비** |
| 계약 자산 | M12(GPS 발자취 수집=U6, 영속·기록 귀속=U7) |
| 클라이언트 features | `features/execution`(허브·도착·체류·현장 상세·다음 이동), `features/planb`(트리거·재계획·휴식·경로 비교), `shared/location`(위치 권한 3층 상태 G182·포그라운드 수집) |
| 서버 모듈 소스 경로 | `modules/execution`, `modules/planb-detection`, `modules/recalculation`, `modules/weather` |

### 1.3 목적 (unit-of-work.md §U6)

활성 일정 허브(M18)와 Plan-B 감지·재계획(M9·M10·M11)을 완성해, 확정 일정이 현장 변수에 **10초 내 대안으로 대응**하게 만드는 것이 목적이다. 홈 활성 카드와 '일정' 탭이 하나의 실행 허브로 수렴하고, 지오펜스 도착 감지·체류 측정·여행 종료 전이·휴식 모드·GPS 발자취까지 여행 중 상호작용 전체를 담는다.

### 1.4 포함 범위

- **M18 실행 허브**: 활성 일정 화면(홈 카드와 수렴하는 단일 허브), 도착 확인 프롬프트(지오펜스 진입→'도착하셨나요?', 확정은 항상 사용자 탭 D23), 방문 시작/완료/스킵 전이·실제 체류 측정, 현장 장소 상세, 다음 예정지 직선거리(G65)·외부 길찾기 앱 시트(G66)·여유 시간(G67), 여행 종료 전이(종료일 익일 00:00 자동+수동 버튼 D19/Δ4), 일자 경계 이벤트(DayClosed), 휴식 모드(경미 억제·심각 유지·재개 재계산 제안 G54).
- **M9 트리거**: 서버 폴링(날씨 1시간·휴무 당일 아침 D27) + 클라이언트 포그라운드 신호(이동 지연·체류 초과), 판정 로직 clock·외부 데이터 주입 순수 함수 분리(G116), 빈도 상한·민감도 3단계·무시 억제(시간당 2/일 8, remote config G58), `TriggerFired` 발행.
- **M11 날씨**: 기상청 단기예보·특보 수집(D10), 좌표→격자 변환, 캐시.
- **M10 재계획(S2)**: 수동·자동 진입, 기준 입력(현재 위치 또는 수동 입력 폴백 G64/US-E7-10), C1 사유 해석+M7 후보 소싱(저장 장소 우선 G53)+C2 검증 → 후보 2~3개(10초 D38), 대안 획득 2방식(AI에 맡기기/직접 수정), 전/후 비교→확정 시점 재검증(G56)→current만 갱신(D14), 당일 잔여 재정렬·이월 미배치 목록(C10), changelog diff 생산(G132 — 보관·열람은 U7), 외부 API 오류 시 수동 수정 폴백(US-E7-11).
- **GPS 발자취**: 포그라운드 저빈도 수집(1~5분)·단순화 폴리라인 보존·원시 좌표 파기(G55/G73), GPS 옵트인(U1 동의 모델) 전제, 계획 vs 실제 경로 지도 비교(US-E7-13).
- **위치 권한 just-in-time 발화 2번째 지점**(여행 중 첫 진입 — US-E1-04 연동).

### 1.5 명시적 제외 범위

| 제외 항목 | 이유·귀속 |
|---|---|
| 백그라운드 위치 수집 | 포그라운드 한정(D27/G62). OS 지오펜스 저전력 감지는 후속 검토 |
| changelog 보관·열람 UI·기록 귀속 | U7(M12) 소유. U6은 diff 이벤트 **생산**까지 |
| 오프라인 일정 조회 | 미보장(D24/Δ6) — 오류·재시도 안내만. 기록 '입력'만 M12 로컬 큐(U7) |
| 당일 임시휴무 자동 감지 | 정기 영업시간 변경만 자동, 임시휴무는 수동 트리거(G192) |
| AI 일정 생성(첫 1일 5초/전체 20초) | M8 소유로 U5 범위. U6는 재계획(S2)만 소유하고 C1·C2를 재사용 |
| 실제 FCM 푸시 발송 | M14(U8) 소관. U6은 `TriggerFired` 발행까지 |

### 1.6 선행·후행 유닛 — 계약 위치

U6는 **CP3(U5→U6)의 소비자이자 CP4(U6→U7)의 공급자**다.

```text
U5(AI 일정 생성·확정)                U6(여행 중 실행·Plan-B)              U7(기록·회고)
  │ CP3: plan/current·DaySchedule ──▶  실행 허브·재계획·트리거   CP4 ──▶  actual·changelog·회고
  │ C1·C2 자산 ─────────── 재사용 ───▶  (재계획 사유 해석·하드 제약 검증)
                                        │ CP5: TriggerFired ─────────────▶ U8(M14 알림)
```

| 관계 | 유닛 | 내용 |
|---|---|---|
| 선행(입력) | U5 | 일정 기준선(plan 불변/current 가변·DaySchedule·ItinerarySlot·FixedBlock) 공급 — [U5 상세](./u5-itinerary.md). C1·C2 프로덕션 자산 제공 |
| 후행(출력) | U7 | 방문 체크·여행 종료·changelog diff·GPS 폴리라인이 U7 기록·회고의 원천 — [U7 상세](./u7-archive.md) |
| 후행(출력) | U8 | `TriggerFired`(CP5)를 M14가 구독해 심각=푸시·경미=인앱 칩 — [U8 상세](./u8-notification.md) |

전체 개발 순서상 위치는 [개발 순서](../units.md)를 참조한다. 아키텍처 전반·핵심 결정은 [아키텍처](../architecture.md)·[핵심 결정/ADR](../decisions.md)에, 도메인 개념 지도는 [도메인 모델](../domain.md)에, 크로스커팅 NFR·인프라 정본은 [NFR 기준](../nfr.md)·[인프라](../infrastructure.md)에 있다.

### 1.7 산출물

- **서버 모듈**: `modules/execution`, `modules/planb-detection`, `modules/recalculation`, `modules/weather`.
- **앱 화면**: 활성 일정 허브(진행률·현재/다음 슬롯), 도착 확인 프롬프트, 방문 완료/스킵 액션, 현장 장소 상세, 외부 길찾기 시트, Plan-B 제안 칩·알림 랜딩, 재계획 기준 입력(위치 수동 입력 폴백 포함), 대안 후보 2~3개 비교 카드, 전/후 비교·확정, 휴식 모드 진입·재개, 여행 종료 확인, 계획 vs 실제 경로 지도 비교.
- **DB 마이그레이션(약 8~9개 테이블)**: 실행 상태(방문 전이·체류), 여행 실행 상태(활성·휴식·종료), 트리거 이력·억제 상태, 민감도 설정, 재계획 세션, 대안 후보, 미배치 목록, 날씨 캐시(격자), GPS 폴리라인.
- **외부 연동**: 기상청 공공데이터포털(단기예보+특보), 외부 지도 앱 딥링크(아웃바운드).
- **스케줄러 잡**: 날씨·특보 폴링(1시간, remote config), 휴무·영업시간 재조회(당일 아침 1회), 여행 자동 종료·일자 경계(일 1회 자정).

### 1.8 완료 기준(DoD) 요지

| 축 | 기준 |
|---|---|
| 기능 | E6 3개 + E7 13개 스토리 수용 기준 충족. Plan-B 대안 제시 10초(초과 시 수동 수정 폴백 제안 D38). 재계획 결과가 current에만 반영되고 plan 불변(D14) |
| 하드 제약(D37) | 재계획 결과도 생성과 **동일한 하드 제약 4계열 검증 100%**(C2 재사용) — 특히 고정 블록·확정 시각 필수 방문지 불변, 확정 시점 재검증(G56) 통과 없이 반영 불가 |
| PBT | 트리거 판정 순수 함수(상한 초과 발화 0·무시 2회 후 당일 동일 사유 억제·민감도 단조성), 방문 상태 머신(예정→도착→시작→완료/스킵) 전이 불변식, warm-start 재계획 고정 블록 보존, 휴식 모드 억제 규칙(심각 사유는 억제 불가), 폴리라인 단순화(원시 파기 후 재구성 불가·경로 위상 보존) |
| 확장 규칙 | SECURITY-14+N2(위치 데이터 처리 로그·옵트인 전제 수집), RESILIENCY-10(기상청·지도 어댑터 타임아웃·폴백 — 날씨 불가 시 트리거 (a) 계열만 비활성), RESILIENCY-01(M9·M10 High — 수동 수정 폴백 존재) 정합 |
| 계약 포인트 | CP3 소비자 측(일정 기준선) + CP4(U6→U7) 공급자 측(VisitChecked·TripEnded·DayClosed·changelog diff) + CP5 공급자 일부(TriggerFired) 계약 테스트. **E2E 종단 흐름(숙소 저장→등록→일정 생성→재계획, G118)을 U6 완료 시점에 CI 필수로 완성** — D37 계층 분리(외부는 fake) |

### 1.9 핵심 리스크와 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| **위치 권한 시나리오 복잡도** — OS 권한 × 법정 동의 × GPS 옵트인 3층(G182) 8조합 × 여행 중 상태 | 기능 오동작·법적 리스크 | 조합별 동작 매트릭스 명문화(§3.F BR-U6-25) 후 매트릭스 자체를 테이블 주도 테스트로 구현. 전 조합 폴백 존재 |
| 트리거 소음(과잉 알림)으로 알림 끄기 이탈 | Plan-B 가치 붕괴 | 상한·민감도·무시 억제 전부 remote config(G58), 판정 순수 함수 분리로 시뮬레이션 테스트(G116), 심각/경미 2단 구분 |
| 기상청 API 품질(지연·격자 변환 오차·특보 파싱) | 오탐·미탐 | 어댑터 격리+캐시, 특보 보수적 심각 분류, 폴링 실패 시 마지막 성공 데이터 TTL 내 사용 후 트리거 (a) 계열 일시 중지(침묵 실패 금지 — 관측 계측) |
| 포그라운드 한정 감지의 커버리지 한계 | 지연·체류 트리거 미발화 | 한계를 제품 동작으로 수용(D27) — 앱 재진입 시 일괄 재평가, 서버 폴링 계열은 독립 동작 |
| 재계획 10초 예산 초과 | UX 신뢰 하락 | 후보 소싱 저장 장소 우선(G53) 축소, C1 경량 티어, 타임박스 초과 시 부분 후보+수동 수정 폴백 제안(US-E7-11) |

### 1.10 선결 과제 (비개발 — 출시·활성 게이트)

| 과제 | 시점 | 내용·비차단 대응 |
|---|---|---|
| **P3 기상청 공공데이터포털 API 활용 신청** | U6 착수 전 | M11 개발·트리거 (a) 계열의 전제. `WeatherPort` 어댑터를 fake로 개발·테스트 선행(D37 계층 분리), 실키 병렬 신청 — 비차단 |
| **P1 위치기반서비스사업 신고**(위치정보법 제9조) + 위치 전문 법무 자문 | U6 기능 출시 전 필수(법정 전제) | GPS 발자취·위치 기반 트리거의 법정 전제. 신고 완료 전 해당 기능 **비활성 플래그** 운영. 위치 3층 모델·법정 로그 스키마는 U1에서 자문 반영 완료 — 개발 비차단 |
| P7 약관(위치기반서비스 약관) | U6 출시 전 | U1 동의 체계(3층 모델·버전)에 실문안 탑재 — 문안 교체만, 비차단 |

### 1.11 예상 규모

스토리 16(E6 3 + E7 13) · 신규 엔티티 약 8~9 · 외부 연동 1(기상청) + 외부 지도 앱 아웃바운드. 1차 유닛 중 스토리 최다·상태 머신 최다 — **시나리오 테스트 공수가 중심**이다.

### 1.12 이 유닛의 설계 결정 (FD-U6-xx)

정본 문서가 결정을 확정한 상태에서, Functional Design이 인터페이스 계약·불변식 수준으로 상세화하며 내린 판단이다.

| ID | 결정 | 근거 |
|---|---|---|
| FD-U6-01 | 방문 상태 머신은 components §3.3을 정본으로 계약 상세화, M18이 상태 소유·전이 강제, **actual 영속은 M12(U7)로 CP4 경계 분리**. 엔티티명 `VisitState`(M18) — 기록 영속 `VisitRecord`(M12)와 혼동 금지 | components §3.3, CP4 |
| FD-U6-02 | U6는 CP3의 소비자·CP4의 공급자. plan/current 이원 구조·slotId·고정 블록은 U5 소유 입력으로 재정의하지 않고 참조·소비만. 재계획 결과는 **current에만** 반영, plan 불변 | D14, CP3, CP4 |
| FD-U6-03 | C1·C2는 U5 완성 재사용 자산. 재사용 계약(입출력·하드 제약 재사용 선언)까지만 정의, 구현체는 U5·NFR 소유. **재계획 검증은 U5 하드 제약(U5-P1)을 그대로 재사용**(중복 재구현 금지) | components C1·C2, DoD, U5-P1 |
| FD-U6-04 | 트리거 판정은 clock·외부 데이터 주입 **순수 함수로 분리**(G116) — 상한·억제·민감도 불변식을 결정적 시뮬레이션 테스트 대상으로. remote config 수치는 NFR 소유 | G116, G58/G195, G106 |
| FD-U6-05 | 위치 동의 3층 동작 매트릭스를 business-rules에 명문화(N2/G182 이관 결정) — 전 조합 폴백 존재. 매트릭스 자체가 테이블 주도 테스트 스펙 | N2, G182 |
| FD-U6-06 | **소요시간(internalDuration) 전면 미표시(D25)를 U6 표시 계층 전역 규칙으로 승계** — 거리(G65)·여유 시간(G67)·대안 후보·전후 비교 지표 전부 거리·시각만. internalDuration은 C2 이동 부등식·M9 지연 판정 내부 전용 | D25/Δ1, U5 INV-TRAVEL1 |
| FD-U6-07 | 재계획 재정렬 범위=당일 잔여만(C10), 이월은 미배치 목록·사용자 날짜 선택 시 재계산. current 갱신은 확정 TX(11단계)에서만 | C10, D14 |
| FD-U6-08 | 여행 종료 전이는 단일 규칙(익일 00:00 자동 + 수동 버튼) + 멱등(경합 시 조건부 전이·이미 종료면 no-op). 종료가 회고 트리거 유일 소스 | D19/Δ4, CP4 |
| FD-U6-09 | GPS 발자취 수집은 U6, 기록 귀속·영속은 M12(U7). 계획vs실제 지도는 U3 `shared/map`·U5 지도 뷰 재사용(신규 브리지 미생성) | G55/G73, D34, CP4 |
| FD-U6-10 | 트리거 (a)날씨 계열은 M11 실패 시 **침묵**(허위 알림 금지 — `DataUnavailable`≠'맑음'), 나머지 계열 정상. 실패율은 관측 계측 | ADR-0011, RESILIENCY-10 |
| FD-U6-11 | 추적 ID 체계: 불변식 `INV-{도메인}`, 규칙 `BR-U6-xx`, 속성 `U6-Pxx`, data-testid `execution-{screen}-{role}` | U5 관례 승계 |

---

## 2. 도메인 엔티티

소유 모듈: M18 Trip Execution·M9 Plan-B Detection·M10 Itinerary Recalculation·M11 Weather & Context (+ C1·C2 재사용 계약, M12 GPS 계약). 표기 규약 — `필수`=NULL 불가, `선택`=NULL 허용, `유니크`=제약 범위 내 유일, `불변`=생성 후 변경 불가, `파생`=저장 안 함(조회 시점 계산).

### 2.0 엔티티 지도

```text
[M18 Trip Execution — 실행 허브·방문 상태 머신·여행 종료 전이 정본]
Trip 1 ── 1 TripExecutionState        (여행 실행 상태 — ACTIVE 하위 NORMAL/REST·종료 전이 D19)
TripExecutionState 1 ── 0..1 RestMode (휴식 모드 — 경미 억제·심각 유지·재개 재계산 G54)
Trip 1 ── 1 ActiveTripHub             (활성 허브 읽기 모델 — 진행률·현재/다음 슬롯·거리·여유 시간·파생 집약)
ActiveTripHub 1 ── * VisitState       (슬롯별 방문 상태 — 다음→도착확인대기→진행중→완료/스킵 D23)
VisitState 1 ── 0..* ArrivalPromptLog (도착 프롬프트 노출 이력 — 재프롬프트 억제 근거)

[M9 Plan-B Detection — 자동 트리거 4종·상한/억제·민감도(판정 순수 함수 G116)]
TriggerEvent          (트리거 수명 DETECTED→FIRED→SHOWN→ACCEPTED/DISMISSED→SUPPRESSED)
SuppressionState      (여행별 상한 카운터·사유별 무시 누적·당일 억제 목록)
SensitivitySetting    (민감도 3단계 ±50% — accountId별)
PollingSchedule       (활성 여행별 다음 평가 시각 — 날씨 1시간·휴무 아침)

[M10 Itinerary Recalculation — 재계획 세션·후보·이월(당일 잔여 C10)]
ReplanSession                     (세션 STARTED→CANDIDATES→COMPARING→CONFIRMED/CANCELLED)
ReplanSession 1 ── 0..3 Alternative (대안 후보 2~3개 — 솔버 통과분만)
Trip 1 ── 0..1 UnplacedList        (이월 미배치 방문지 — 날짜 재배치 대기)

[M11 Weather & Context — 기상청 예보·특보(D10)]
WeatherData = ForecastCache(격자·시간대·강수확률) + WeatherAlert(지역 특보)

[M12 계약 — GPS 발자취(수집=U6·영속·기록 귀속=M12/U7)]
GpsTrail  (단순화 폴리라인·옵트인 전제 D34/G55/G73)

[CP3 입력 — U5 소유(본 유닛은 참조·소비만)]
Itinerary(plan 불변/current 가변·상태 INTRIP) + DaySchedule[] + ItinerarySlot[](slotId·LOCK·고정 블록·DistanceRange) + FixedBlock[]

[CP4 출력 — U7 M12·M13 소비] VisitChecked · DayClosed · TripEnded · changelog diff(G132) · GPS 폴리라인
[CP5 출력 — U8 M14 소비] TriggerFired
```

### 2.1 TripExecutionState — 여행 실행 상태 (M18)

진행 중 여행의 **실행 국면 상태**. 여행 상태 머신(PLANNED/CONFIRMED/ACTIVE/ENDED)에서 `ACTIVE` 진입 이후의 실행 하위 상태(`NORMAL`/`REST`)와 **여행 종료 전이(D19)** 를 소유한다. 여행 상태 머신 본체는 M6 소유이며, 본 엔티티는 ACTIVE/ENDED 전이의 **트리거 주체**다.

**속성**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip 참조) | 필수·유니크 | 귀속 여행. 진행 중 여행은 항상 최대 1개(D21 날짜 겹침 차단으로 구조적 단수) |
| phase | 열거 {NORMAL, REST} | 필수·기본 NORMAL | ACTIVE 하위 실행 국면. REST=휴식 모드(§2.4) [G54] |
| currentDate | 날짜 | 필수 | 실행 기준 일자(일자 경계 배치가 갱신, DayClosed 소스) [D19] |
| currentSlotRef | 식별자(ItinerarySlot) | 선택 | 현재 진행 중(INPROGRESS) 슬롯. NULL=이동 중/미도착 |
| nextSlotRef | 식별자(ItinerarySlot) | 선택 | 다음 예정(UPCOMING) 슬롯. NULL=당일 잔여 없음 |
| endedAt | 시각(UTC) | 선택 | 종료 전이 시각. NULL=진행 중, 값 존재=ENDED(M6 정합) [D19] |
| endMethod | 열거 {AUTO_NEXTDAY, MANUAL} | 선택 | 종료 방식 — 익일 00:00 자동 배치 / 수동 버튼. NULL=미종료 [D19/Δ4] |

**파생 표시값(저장 안 함)**: `isActive`=`endedAt=NULL`(재계획 진입·트리거 평가 게이트), `progress`=완료(COMPLETED)+스킵(SKIPPED) 방문 ÷ 당일 계획 방문(G3).

**여행 실행 상태 전이**

```text
   (M6 여행 CONFIRMED/PLANNED)
        │ startDateReached(시작일 00:00 · M18 일자 경계 배치)
        ▼
     ACTIVE / NORMAL ◀──(resumeFromRest: 재개 시각 도달 ∨ 즉시 재개)──┐
        │  ▲                                                          │
        │  └────────(enterRestMode: 사용자 휴식 전환)────────▶ ACTIVE / REST
        │ autoEndTrips(종료일 익일 00:00) ∨ endTripManually(수동 버튼)
        ▼
      ENDED (종결) — TripEnded 발행 → 회고 자동 생성·기록 귀속 마감
```

| 전이 | 트리거 | 가드 조건 | 효과 |
|---|---|---|---|
| (M6) → ACTIVE/NORMAL | 시작일 00:00 도달(일자 경계 배치) | 여행 날짜 구간 진입·일정 미확정이라도 ACTIVE·D21로 동시 활성 ≤1 | 홈 활성 카드·일정 탭이 M18 허브로 수렴, plan/current 분리 작동(D14) |
| NORMAL → REST | enterRestMode(resumeAt?) | 진행 중 여행(isActive) | 경미 트리거·일정 알림 억제 신호(M9·M14), resumeAt을 리마인드 큐 등록 [G54] |
| REST → NORMAL | resumeFromRest(재개 시각 도달 ∨ 즉시 재개) | REST 상태 | 억제 해제 + **남은 일정 재계산 제안**(M10 위임) [G159] |
| ACTIVE → ENDED | autoEndTrips(익일 00:00 배치) ∨ endTripManually(수동 버튼) | isActive·**숙소 유무 무관 단일 규칙**(D19)·조건부 전이(이미 ENDED면 no-op) | TripEnded 발행 → M13 회고 생성·M14 완료 알림·M12 기록 귀속 마감 [D19/Δ4] |
| 일자 경계(전이 아님) | autoEndTrips 배치 동반 일자 경계 | currentDate < 오늘 | DayClosed 발행(당일 회고 초안 트리거 M13) + currentDate 갱신 |

**불변식**

- **INV-EXEC1 (종료 전이 단일성·멱등 — 하드 계열)**: ACTIVE→ENDED는 자동·수동 어느 경로든 조건부 전이(이미 ENDED면 no-op)로 정확히 1회만 발생한다 — 자동/수동 경합에도 TripEnded는 여행당 1회. endedAt·endMethod는 첫 전이에서만 확정.
- **INV-EXEC2 (진행 중 단수)**: isActive TripExecutionState는 계정당 최대 1개 — D21(날짜 겹침 차단)의 소비. 재계획·트리거 평가 대상 여행 모호성 0.
- **INV-EXEC3 (하위 상태 가드)**: phase는 전이표 조합으로만 변경. 표 밖 전이(ENDED→ACTIVE 재개 등) 구조적 불가(종료는 최종 상태, 재개 없음 C11).
- **INV-EXEC4 (종료 = 회고 트리거 유일 소스)**: 회고 자동 생성·기록 귀속 마감은 TripEnded(전체)·DayClosed(당일)로만 개시. 종료 후 기록 편집은 허용하되 회고 갱신은 수동 재생성만(C11).

### 2.2 ActiveTripHub — 활성 여행 허브 (M18, 읽기 모델 집약)

여행 중 화면의 **단일 허브 읽기 모델**. 홈 활성 카드·일정 탭이 수렴하는 하나의 허브로, 오늘 일정·방문 진행 상태·다음 예정지 거리·여유 시간을 집약한다. plan/current 중 **current가 실행 기준선**이며, 표시 데이터는 전부 거리·시각까지만(**소요시간 부재 D25**).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip) | 필수·유니크 | 진행 중 여행(D21 단수) |
| todaySlots | 목록<{slotRef, visitStatus, 시각/체류}> | 필수 | 오늘 일정 슬롯 + 방문 진행 상태(완료/진행 중/다음) — current DaySchedule 파생 |
| nextSlot | 참조(ItinerarySlot) | 선택 | 다음 예정지. NULL=당일 잔여 없음 |
| nextLegDistance | DistanceRange{value, transportMode, estimatedFlag} | 선택 | 현재 위치→다음 예정지 **거리 요약**(추정 표기) — **소요시간 필드 없음**. 화면 진입/포커스 1회 + 수동 새로고침(G65) [D25] |
| slackToNext | Duration(파생·표시) | 선택 | 다음 계획 시작 시각까지 **단순 시간 차이**(이동시간 미반영 G67) — 여유 시간 |
| progress | {completed, total, ratio} | 필수 | 방문 체크 완료 비율(G3) — 홈 카드·목록 공급 |
| restState | 참조(RestMode) | 선택 | 휴식 모드 진입 시 존재. NULL=NORMAL [G54] |

**불변식**

- **INV-HUB1 (단일 허브 수렴)**: 진행 중 여행당 1개 — 홈 활성 카드·일정 탭이 동일 허브 데이터 참조. 여행 종료 시 허브 소멸(홈 카드는 추억 카드로 전환).
- **INV-HUB2 (소요시간 표시 부재 — D25 정본 승계)**: nextLegDistance·slackToNext·모든 이동 표시에 소요시간(internalDuration) 필드가 구조적으로 없다 — 거리(DistanceRange)와 시각 차이(slack)까지만. internalDuration은 C2 이동 부등식·M9 지연 트리거 판정 내부 전용.
- **INV-HUB3 (온라인 전제)**: 활성 허브 조회는 온라인 전제 — 실패 시 오류·재시도 안내(오프라인 조회 미보장 D24/Δ6). 기록 '입력'만 M12 로컬 큐(U7).
- **INV-HUB4 (current 기준선)**: 오늘 일정은 U5 current(가변 현재본)에서 파생, 재계획 확정 시 current 갱신이 즉시 반영. plan(불변 스냅샷)은 회고 대조용으로만 소비.

### 2.3 VisitState — 방문 상태 (M18, 방문 상태 머신 정본)

일정 슬롯 1건의 **방문 진행 상태 머신**(다음→도착확인대기→진행중→완료/스킵). **M18이 상태 소유·전이 강제**하며, 실제 방문 기록(actual — 시각·사진·메모)의 **영속은 M12(U7)** 소유다(`VisitRecord`는 M12 엔티티 — 본 엔티티와 혼동 금지). 도착 확정·완료는 **항상 사용자 탭**(자동 기록 없음 D23).

**속성**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| visitStateId | 식별자 | 필수·유니크 | — |
| tripId | 식별자(Trip) | 필수 | 귀속 여행 |
| slotRef | 식별자(ItinerarySlot) | 필수·유니크(여행 내) | 대상 슬롯(canonicalPoiId는 슬롯에서 파생) |
| status | 열거 {UPCOMING, ARRIVALPENDING, INPROGRESS, COMPLETED, SKIPPED} | 필수·기본 UPCOMING | 방문 생애 상태(한글: 다음/도착확인대기/진행중/완료/스킵) |
| arrivedAt | 시각(기기 시각) | 선택 | 도착 확정 시각(사용자 탭·수정 가능). NULL=미도착. VisitChecked(start)로 M12 actual 공급 [D23] |
| departedAt | 시각 | 선택 | 방문 종료 시각. NULL=미완료. **다음 장소 도착 체크 시각으로 추정 시 estimatedFlag=true**(사용자 완료 탭이면 실측) [D23] |
| departedEstimatedFlag | 불리언 | 필수·기본 false | departedAt이 다음 장소 체크로 추정된 값인지(허위 정확성 방지) |
| promptSuppressed | 불리언 | 필수·기본 false | 도착 프롬프트 닫기/무시로 재프롬프트 억제됐는지 |

**파생값(저장 안 함)**: `actualStay`=`departedAt − arrivedAt`(둘 다 존재 시) — 실제 체류·M9 체류 초과 트리거 (d) 입력. `overstayGap`=`actualStay − plan 체류`(양수) — 다음 고정 일정 위협 판정 입력(BR-U6-11).

**방문 상태 전이**

```text
      UPCOMING(다음)
        │  ├──(geofenceEnter · 포그라운드 · 위치 3층 동의 충족)──▶ ARRIVALPENDING(도착확인대기)
        │  ├──(manualArrivalTap · 위치 무관 항상 가능 ADR-0010)──────────┐
        │  └──(userSkips)──▶ SKIPPED                                     │
        ▼                                                                ▼
   ARRIVALPENDING ──(userConfirmsArrival: '도착했어요' 탭)────────▶ INPROGRESS(진행중)
        ├──(userDismisses: 닫기/무시)──▶ UPCOMING(재프롬프트 억제)         │
        └──(userSkips)──▶ SKIPPED                                        │
                                                                         ▼
                    INPROGRESS ──(userCompletes 탭 ∨ 다음 장소 도착 체크)──▶ COMPLETED(완료)
                        └──(userCancels)──▶ SKIPPED
   COMPLETED / SKIPPED (종결) — 이후 시각·상태 수정은 기록 편집(상태 재전이 아님 C11)
```

| 전이 | 트리거 | 가드 조건 | 효과 |
|---|---|---|---|
| UPCOMING → ARRIVALPENDING | 지오펜스 진입 감지(포그라운드) ∨ 외부 지도앱 복귀 시 다음 예정지 근접(G66) | 위치 3층 동의 충족(G182)·GPS 정확도 충분·동일 방문지 재프롬프트 억제 | **'도착하셨나요?' 프롬프트만 — 자동 기록 없음**(D23) |
| ARRIVALPENDING → INPROGRESS | 사용자 '도착했어요' 탭 | — | arrivedAt 기록(기기 시각) → M12 actual·VisitChecked(start) 발행 |
| UPCOMING → INPROGRESS | 사용자 수동 '도착' 탭 | **위치 동의·감지와 무관하게 항상 가능**(ADR-0010) | 동일(수동 체크인 폴백 기본 수단) |
| ARRIVALPENDING → UPCOMING | 프롬프트 닫기/무시 | — | promptSuppressed=true(해당 방문지 재프롬프트 억제) |
| INPROGRESS → COMPLETED | (a) '방문 완료' 탭 (b) 다음 장소 도착 체크 | (b)의 departedAt은 다음 장소 체크 시각 추정(estimatedFlag=true) | 실제 체류 산출 → M12 보관(plan 대조)·**체류 초과 시 M9 신호**(VisitChecked(complete)) |
| any → SKIPPED | 사용자 '방문 안 함/스킵/취소' | — | M12 스킵 기록·잔여 일정 영향 시 Plan-B 제안 연결(BR-U6-05) |
| COMPLETED/SKIPPED 이후 | 시각·상태 수정 | 기록 편집으로 처리(**상태 재전이 아님** C11) | changelog 기록(M12) |

**ArrivalPromptLog — 도착 프롬프트 이력 (M18)**: `slotRef`(대상 슬롯), `shownAt`(노출 시각), `outcome`(열거 {CONFIRMED, DISMISSED, SKIPPED} — 재프롬프트 억제 근거).

**불변식**

- **INV-VISIT1 (전이 가드)**: status는 전이표 조합으로만 변경. 표 밖 전이(COMPLETED→INPROGRESS 역행·UPCOMING→COMPLETED 직행) 구조적 불가. COMPLETED/SKIPPED는 종결(이후는 기록 편집).
- **INV-VISIT2 (자동 기록 없음 — 하드 계열)**: 지오펜스 진입은 **프롬프트만** 생성하고 어떤 상태도 자동 확정하지 않는다 — INPROGRESS·COMPLETED 전이는 항상 사용자 탭이 트리거. 위치 감지 실패가 방문 처리를 막지 않음(수동 경로 항상 존재 ADR-0010).
- **INV-VISIT3 (체류 측정 결정성)**: actualStay = departedAt − arrivedAt은 동일 입력에 결정적 산출 — departedAt이 추정(다음 장소 체크)이면 departedEstimatedFlag=true로 전파(허위 정확성 금지). arrivedAt 부재 시 미산출(NULL).
- **INV-VISIT4 (완료 방문 불변 — 재계획 제외)**: COMPLETED/SKIPPED 방문은 재계획 재정렬 대상에서 제외·warm-start로 보존 — 재계획은 "현재 시각 이후 남은 일정만"에 적용.
- **INV-VISIT5 (actual 영속 경계 — CP4)**: 방문 시각·사진·메모의 영속 정본은 M12(U7) VisitRecord이며, M18 VisitState는 실행 중 상태 머신만 소유. M18은 VisitChecked 이벤트로 M12에 공급.

### 2.4 RestMode — 휴식 모드 (M18, ACTIVE 하위 상태 G54)

'여행 중'의 하위 상태(phase=REST). 진입 시 **경미 트리거·일정 알림을 억제**하고 심각 사유(기상특보·고정 일정 위협)만 유지하며, 재개 시각 도달 시 알림 + 남은 일정 재계산을 제안한다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip) | 필수·유니크 | 귀속 여행(진행 중 단수) |
| enteredAt | 시각 | 필수 | 휴식 진입 시각 |
| resumeAt | 시각 | 선택 | 재개 예정 시각. NULL=즉시 재개(수동) |
| suppressionScope | 열거 {MINOR_ONLY} | 필수·기본 MINOR_ONLY | 억제 범위 — **경미 트리거·일정 알림만 억제, 심각 사유는 억제 불가** |

**불변식**

- **INV-REST1 (심각 억제 불가 — 안전 불변식)**: severity=MINOR 트리거·일정 알림만 억제하고 **severity=SEVERE(기상특보·고정 일정 도착 위협)는 억제하지 못한다** — 휴식 중에도 안전 위협 알림은 통과(방해금지 예외 G100과 정합).
- **INV-REST2 (재개 재계산 제안)**: resumeAt 도달(∨ 즉시 재개) 시 알림 + resumeFromRest가 **남은 일정 재계산 제안**(ReplanProposal)을 반환 — 자동 재계획 아님, 사용자가 대안 보기를 눌러야 M10 세션 시작.
- **INV-REST3 (하위 상태 종속)**: TripExecutionState.phase=REST일 때만 존재, 여행 종료·즉시 재개 시 소멸 — 독립 생명주기 없음.

### 2.5 TriggerEvent — 자동 트리거 (M9, 트리거 수명 정본)

여행 중 재계획 필요 상황 4종(날씨·휴무·이동 지연·체류 초과)의 **감지·발화·억제 단위**. **제안만** 발화하고 자동으로 일정을 바꾸지 않는다. 판정 로직은 clock·외부 데이터 주입 순수 함수로 분리(G116).

**속성**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| triggerId | 식별자 | 필수·유니크 | — |
| tripId | 식별자(Trip) | 필수 | 귀속 진행 중 여행 |
| type | 열거 {WEATHER, CLOSURE, DELAY, OVERSTAY} | 필수 | 사유 4종 — (a)날씨·(b)휴무·(c)이동 지연·(d)체류 초과 |
| severity | 열거 {SEVERE, MINOR} | 필수 | 심각도 — SEVERE(기상특보·고정 일정 도착 위협)=푸시 / MINOR=인앱 칩 |
| affectedSlots | 목록<slotRef> | 필수 | 영향 받는 슬롯(다음 방문지·고정 일정) |
| source | {provider, kind} | 필수 | 외부 데이터 출처(기상청·영업시간)·감지 계열 — 알림 출처 표기 입력 |
| detectedAt | 시각 | 필수 | 감지 시각 — 알림 표기 |
| lifecycle | 열거 {DETECTED, FIRED, SHOWN, ACCEPTED, DISMISSED, SUPPRESSED} | 필수·기본 DETECTED | 트리거 수명 |
| detectionMode | 열거 {SERVER_POLL, CLIENT_FOREGROUND} | 필수 | 하이브리드 경로 — 날씨·휴무=서버 폴링 / 지연·체류=클라 포그라운드(D27) |

**SuppressionState — 억제 상태 (M9)**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자 | 필수·유니크 | 여행별 억제 상태 |
| hourlyCount / dailyCount | 정수 | 필수·기본 0 | 전역 상한 카운터(초기값 시간당 2/일 8 — remote config G58) |
| ignoreStreakByReason | Map<type, 정수> | 필수·기본 ∅ | 사유별 연속 무시 카운트 — **2회 연속 시 당일 동일 사유 억제(학습)** |
| dailySuppressedReasons | 집합<type> | 필수·기본 ∅ | 당일 억제된 사유(학습 결과)·휴식 모드 경미 억제 반영 |
| shownKeys | 집합<{type, slotRef}> | 필수·기본 ∅ | 동일 사유·동일 방문지 1회 노출 보장 키 |

**SensitivitySetting / PollingSchedule (M9)**: SensitivitySetting(accountId, level {적게/보통/많이} — 상한 ±50% 조정), PollingSchedule(대상 활성 여행, nextEvalAt — 날씨 1시간·휴무 당일 아침 1회).

**트리거 수명 상태 머신**

```text
   [evaluateServerTriggers 배치 ∨ reportClientSignal 포그라운드]
        │
        ▼
    DETECTED ──(상한·억제·민감도·위치 게이트 통과)──▶ FIRED ──▶ SHOWN(배너/칩·푸시는 심각만)
        │  └──(상한 초과·당일 억제·휴식 경미·위치 미동의)──▶ SUPPRESSED(발화 안 함·계측)
        │                                                       ▲
        ▼                                                       │
   SHOWN ──(사용자 '대안 보기')──▶ ACCEPTED(→ M10 재계획 세션 진입)
        └──(닫기/무시)──▶ DISMISSED ──(동일 사유 2회 무시)──▶ SUPPRESSED(당일 학습)
```

| 전이 | 트리거 | 가드/효과 |
|---|---|---|
| (없음) → DETECTED | 서버 배치 판정 ∨ 클라 신호 판정 | 순수 함수 판정(clock·외부 데이터 주입 G116) |
| DETECTED → FIRED | 상한·억제·민감도·위치 게이트 통과 | outbox TriggerFired(CP5) → M14(심각=푸시·경미=인앱 칩) |
| DETECTED → SUPPRESSED | 상한 초과·당일 억제·휴식 경미·위치 미동의·외부 데이터 없음 | 발화 안 함 + 실패/억제 계측(침묵이지만 관측) |
| FIRED → SHOWN | 배너/칩 노출 | 출처·감지 시각 표기 |
| SHOWN → ACCEPTED | 사용자 '대안 보기' 탭 | M10 startReplan(자동 진입) — **자동 일정 변경 없음** |
| SHOWN → DISMISSED | 닫기/무시 | 동일 방문지·사유 재노출 방지·ignoreStreak++ |
| DISMISSED → SUPPRESSED | 동일 사유 2회 연속 무시 | 당일 동일 사유 억제(학습) |

**불변식**

- **INV-TRIG1 (상한 불변식 — G58)**: 임의 (clock·트리거 시퀀스)에 대해 FIRED 발화 수는 전역 상한(시간당 2/일 8, 민감도 ±50%)을 초과하지 않는다 — 초과분은 묶어 1회로 정리·SUPPRESSED. 동일 {type, slotRef}는 1회만 SHOWN.
- **INV-TRIG2 (억제 멱등·학습)**: 동일 사유 2회 연속 무시 후 당일 동일 사유는 SUPPRESSED로 억제되고 멱등(반복 판정에도 재발화 0). 학습 상태는 당일 리셋(익일 재평가).
- **INV-TRIG3 (제안만 — 자동 변경 없음)**: TriggerEvent는 어떤 경로로도 일정을 자동 변경하지 않는다 — ACCEPTED 후에도 M10 세션의 사용자 확정이 있어야 current 갱신. 발화=제안.
- **INV-TRIG4 (판정 순수 함수 — G116)**: 트리거 판정은 clock·날씨·체류·이동 데이터를 파라미터로 주입받는 순수 함수 — 동일 입력 동일 판정. 민감도 레벨 상향 시 발화 임계 완화(단조성).
- **INV-TRIG5 (위치 동의 게이트 — D34)**: 위치 의존 트리거(c 이동 지연·d 체류 초과)는 위치정보 동의 철회 상태에서 미평가되고, 위치 비의존(a 날씨·b 휴무)만 지속 평가. 동의 3층(G182) 종속.
- **INV-TRIG6 (허위 알림 금지)**: 외부 데이터 부재(DataUnavailable)는 '맑음/정상'과 구분되어 자동 알림을 발화하지 않는다(침묵) — 수동 재계획 경로는 항상 유지, 실패는 관측 계측.

### 2.6 ReplanSession — 재계획 세션 (M10, 세션 상태 머신 정본)

수동·자동 트리거로 시작된 **재계획 세션**. 사유 해석(C1)→후보 2~3개 생성(M7 소싱+C2 검증)→전/후 비교→확정(current 반영)까지를 소유한다. 등록 숙소는 **항상 불변 고정 제약**(ADR-0006 — Plan-B는 예약 변경이 아닌 실행 보조).

**속성**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| sessionId | 식별자 | 필수·유니크 | — |
| tripId | 식별자(Trip) | 필수 | 대상 진행 중 여행(D21 단수) |
| reason | 열거 {Weather, Closure, Delay, Cancelled, Fatigue, None} | 선택 | 재계획 사유(5종 + '사유 없음'). None=명시적 무사유 |
| method | 열거 {DelegateToAi, ManualEdit} | 필수 | 대안 획득 방식 — AI에게 맡기기 / 직접 수정(수동 편집 직행) |
| triggerRef | 식별자(TriggerEvent) | 선택 | 자동 진입 시 원천 트리거. NULL=수동 진입 |
| basePosition | {coord, kind} | 선택 | 기준 위치·kind∈{GPS, MANUAL, LAST_VISIT, STAY} — 가정 표기 대상. NULL+GPS 불가 시 positionRequired 상태 |
| positionAssumption | 문자열 | 선택 | 폴백 가정 표기("추정 출발지 — 지도 핀 입력"·"마지막 완료 방문지 기준"). NULL=GPS 실측 |
| status | 열거 {STARTED, CANDIDATES, COMPARING, CONFIRMED, CANCELLED} | 필수·기본 STARTED | 세션 생애 |
| candidates | 목록<Alternative> | 선택 | 대안 후보 — CANDIDATES 이후 존재 |

**파생·게이트값**: `replanScope`=재정렬 범위 **당일 잔여만**(완료 방문·시각 고정 제외, C10). `fixedConstraints`=숙소 체크인/아웃(불변)·시각 고정형 필수 방문지·완료 방문지(warm-start 보존, ADR-0006).

**재계획 세션 상태 머신**

```text
   [startReplan(tripId, reason?, method, position?)]  — 가드: '여행 중'(날짜 구간 D19)·숙소 0개도 허용
        │
        ▼
    STARTED ──(method=ManualEdit)──▶ (수동 편집 화면 직행 · applyManualEdit)
        │ method=DelegateToAi
        │ getAlternatives (10초 예산 · C1 사유 해석 + M7 소싱 G53 + C2 검증)
        ▼
    CANDIDATES ──(후보 0건/전부 검증 실패/10초 초과)──▶ Fallback(3종: 1개 건너뛰기/휴식 전환/수동 수정)
        │ previewAlternative(choiceId)
        ▼
    COMPARING ──(confirmAlternative: 확정 버튼)──▶ [C2 재검증 1회 G56]
        │                                              ├─ 무효화 → CANDIDATES(재산출 안내)
        │                                              └─ 통과 → CONFIRMED
        └──(keepCurrentPlan '기존 유지')──▶ CANCELLED(어떤 변경도 미저장)
   CONFIRMED — current만 갱신(D14) + changelog(M12) + ItineraryChanged(CP5)
```

| 전이 | 트리거 | 가드/효과 |
|---|---|---|
| (없음) → STARTED | startReplan | **'여행 중' 상태만**(날짜 구간 D19, 숙소 0개 허용) — 위반 시 PreconditionFailed(NOT_ACTIVE) |
| STARTED → (수동 편집) | method=ManualEdit ∨ 외부 API 오류 폴백 | applyManualEdit — 숙소 고정 제약 위반 차단(BR-U6-19) |
| STARTED → CANDIDATES | getAlternatives 성공 | C1 사유 해석 + M7 저장 장소 우선 소싱(G53) + C2 하드 제약 검증 → 2~3개(10초 D38) |
| CANDIDATES → Fallback | 후보 0건·전부 실패·10초 초과 | 3종 폴백 + 사유 한 줄(빈 화면 금지) |
| CANDIDATES → COMPARING | previewAlternative(choiceId) | 전/후 비교(추가·삭제·시간 이동 diff, 지표 요약 — 소요시간 없음) |
| COMPARING → CONFIRMED | confirmAlternative + **C2 재검증 1회 통과(G56)** | current 갱신(plan 불변 D14) + changelog + ItineraryChanged |
| COMPARING → CANDIDATES | 확정 재검증 무효화 | RevalidationFailed — 후보 재산출 안내(확정 차단) |
| any → CANCELLED | keepCurrentPlan '기존 유지' ∨ 세션 폐기 | 어떤 변경도 미저장 |

**불변식**

- **INV-REPLAN1 (여행 중 게이트)**: startReplan은 '여행 중'(날짜 구간 진입 D19) 상태에서만 성공 — **등록 숙소 0개여도 날짜 구간 안이면 허용**(숙소=생성 기준일 뿐). 여행 중 아님이면 PreconditionFailed(NOT_ACTIVE).
- **INV-REPLAN2 (current만 갱신·plan 불변 — 하드 계열)**: 확정은 current에만 반영되고 U5 plan 스냅샷은 바이트 동일하게 불변 유지 — 재계획 연산 시퀀스 후에도 plan 변경 0. current 갱신은 확정 TX(11단계)에서만, 그 전 어떤 후보도 일정 미반영.
- **INV-REPLAN3 (확정 시점 재검증 — G56)**: CONFIRMED 전이는 확정 버튼 시점 C2 재검증 1회 통과 없이 불가 — 무효화되면 CANDIDATES 복귀·재산출 안내. 재검증은 U5 하드 제약 4계열 재사용.
- **INV-REPLAN4 (당일 잔여 범위 — C10)**: 재정렬 대상은 현재 시각 이후 당일 잔여 방문지만 — 완료 방문·시각 고정형 필수 방문지·숙소 고정 블록은 재배치 제외(warm-start 보존). 넣을 수 없게 된 방문지는 UnplacedList로 이월.
- **INV-REPLAN5 (숙소 고정 불가침 — ADR-0006)**: 등록 숙소 체크인/체크아웃 일시·위치는 변경 불가 고정 제약 — Plan-B는 숙소 예약을 바꾸지 않고 출발·복귀 기준점으로 고정한 채 방문 일정만 재구성. AI/직접 수정 어느 방식에서도 위반 불가.
- **INV-REPLAN6 (10초 예산 — D38)**: getAlternatives는 10초 목표 — 초과 시 산출된 후보만이라도 제시, 0건이면 3종 폴백. 확정 재검증은 별도 상호작용으로 10초 예산 외.
- **INV-REPLAN7 (기준 위치 가정 표기)**: basePosition이 GPS 실측이 아니면(MANUAL/LAST_VISIT/STAY) positionAssumption이 필수로 채워져 화면에 표기 — 추정 출발지 가정 명시(허위 정확성 금지).

### 2.7 Alternative / UnplacedList — 대안 후보·이월 (M10)

**Alternative — 대안 후보 (2~3개, 솔버 통과분만)**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| choiceId | 식별자 | 필수·유니크(세션 내) | 후보 택일 키 |
| slots | 목록<ItinerarySlot diff> | 필수 | 재정렬 후 당일 잔여 슬롯(C2 검증값) |
| rationale | 문자열 | 선택 | 추천 이유(사유 연결 LLM 설명 — 구체 근거·모호어 금지). NULL=템플릿 대체("추천 이유를 불러오지 못했어요") |
| distanceFromHere | DistanceRange{value, transportMode, estimatedFlag} | 필수 | 현재 위치→후보 **거리·수단만**(추정 표기) — **소요시간 없음** |
| stayEstimate | 정수(분) | 필수 | 예상 체류(추정 표기) |
| slackToNextFixed | Duration | 필수 | 다음 고정 제약(숙소 복귀·시각 고정 방문지)까지 여유 시간 |
| validationResult | {passed, hardConstraintsChecked} | 필수 | C2 하드 제약 4계열 통과분만 보관 |

**UnplacedList — 이월 미배치 목록 (M10)**: `tripId`(유니크), `unplacedPois`(목록<{poiRef, reason}> — 당일 잔여에 못 넣은 방문지+사유), `status`(열거 {PENDING_RESCHEDULE} — 날짜 재배치 대기, 사용자 날짜 선택 시 해당 일 재계산 세션 시작).

**불변식**

- **INV-ALT1 (솔버 통과분만)**: candidates의 모든 Alternative는 C2 하드 제약 4계열(숙소 시간창·영업시간·이동 부등식·시각 고정) 통과분만 — 환각·폐업·좌표 불명 POI는 구조적 제외(closed-set 그라운딩 G115).
- **INV-ALT2 (소요시간 부재 — D25)**: distanceFromHere·전후 비교 지표(총 이동 거리 증감·숙소 복귀 시각 변화)에 소요시간 필드 없음 — 거리·시각까지만.
- **INV-ALT3 (사유 부합)**: 후보는 사유에 부합 정렬 — 날씨→실내 우선, 체력(Fatigue)→이동거리·방문 수 축소. C1 사유 해석 실패 시 규칙 매핑 폴백.
- **INV-ALT4 (2~3개 또는 폴백)**: 유효 후보는 2~3개 제시 — 0건이면 빈 화면 대신 **3종 폴백(1개 건너뛰기/휴식 전환/수동 수정) + 사유 한 줄**. AI/직접 수정 두 분기 대칭.
- **INV-ALT5 (이월 명시 동의)**: 재정렬로 제외·이월되는 방문지는 확정 전 명시적으로 표시되고 사용자 동의 후에만 UnplacedList로 보관(침묵 드롭 금지).

### 2.8 WeatherData — 기상 데이터 (M11, 기상청 D10)

기상청 공공데이터포털 단기예보(강수확률)·기상특보를 수집·캐싱해 M9(트리거 (a) 판정)·M8(생성 맥락)에 공급하는 값 객체. **데이터 부재를 명시**해 소비자가 '데이터 없음'과 '맑음'을 구분하게 한다.

| 엔티티 | 속성 | 제약 | 의미·근거 |
|---|---|---|---|
| ForecastCache | gridXY | 필수 | 기상청 격자 좌표(좌표→격자 변환은 M11 정본, 결정적) |
| | timeSlot | 필수 | 예보 시간대(도착 시간대 강수확률 조회) |
| | pop | 필수 | 강수확률(%) — **60% 이상이 트리거 (a) 판정 기준** |
| | sky / announcedAt | 필수 | 하늘 상태·발표 시각(출처 표기 입력) |
| | fetchedAt + TTL | 필수 | 폴링 주기 정합 캐시(1시간)·동일 격자 중복 호출 억제(쿼터 보호) |
| WeatherAlert | region, alertType, effectiveAt, source | 필수 | 지역 특보 — **Plan-B 심각 사유·푸시 대상 입력** |

**불변식**

- **INV-WX1 (데이터 없음 명시 — 허위 알림 방지)**: API 실패 시 DataUnavailable을 명시 반환하고 추정치를 조작하지 않는다 — M9는 이를 받아 자동 알림 침묵, M8은 날씨 무반영 생성 지속. '데이터 없음'≠'맑음'.
- **INV-WX2 (격자 변환 결정성)**: 위경도→기상청 격자 변환은 결정적 순수 함수(동일 좌표 동일 격자).
- **INV-WX3 (TTL 캐시·쿼터 보호)**: ForecastCache는 폴링 주기(1시간)와 정합하는 TTL로 동일 격자 중복 호출 억제 — 쿼터 80% 알람·서킷 브레이커. 폴링 실패 시 마지막 성공 데이터 TTL 내 사용 후 트리거 (a) 계열 일시 중지.

### 2.9 GpsTrail — GPS 발자취 (M12 소유·U6 수집 계약)

계획 동선 vs 실제 경로 비교의 원천. **수집은 U6**(포그라운드 저빈도·단순화 폴리라인 생산), **기록 귀속·영속은 M12(U7)**. GPS 기록 옵트인(N2 3층 동의의 3층) 전제이며, 원시 좌표는 가공 후 파기한다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip) | 필수 | 귀속 여행 |
| date | 날짜 | 필수 | 수집 일자(날짜별 귀속) |
| simplifiedPolyline | 폴리라인(단순화) | 필수·불변 | **단순화 폴리라인만 서버 보존 — 원시 좌표는 가공 후 파기** |
| consentRef | 식별자(ConsentRecord) | 필수 | GPS 기록 옵트인 동의 참조 — **미동의 수집 불가** |
| collectionMeta | {interval, foregroundOnly} | 필수 | 수집 구간 메타 — 포그라운드 저빈도(1~5분) |

**파생 표시값**: cumulativeDistance(누적 실제 이동 거리·추정), estimatedSteps(걸음 수=GPS 거리 환산 추정·추가 권한 없음 G59) — 둘 다 **추정 표기 강제**.

**불변식**

- **INV-GPS1 (옵트인 전제 — D34 하드 계열)**: GpsTrail 수집·저장은 GPS 기록 옵트인 동의(consentRef) 전제 — 미동의 수집은 PermissionDenied(구조적 차단). 수집·이용 사실은 append-only 법정 로그로 기록(N2, 앱은 자기 로그 삭제 권한 없음).
- **INV-GPS2 (포그라운드 저빈도 — G55/G62)**: 수집은 포그라운드 한정 저빈도(1~5분) — 백그라운드 위치 권한 미요청. 포그라운드 밖 구간 미수집(제품 동작으로 수용, 앱 재진입 시 재평가).
- **INV-GPS3 (단순화 라운드트립 — 파기 후 위상 보존)**: 원시 좌표 파기 후 남는 단순화 폴리라인은 경로 위상(방문 순서·구간 연결)을 보존하며, 단순화→직렬화→역직렬화 라운드트립에서 위상 동등 — 원시 재구성은 불가하되 표시·거리 산출에 충분.
- **INV-GPS4 (철회·탈퇴 즉시 파기 — N2)**: 옵트인 철회·계정 탈퇴 시 GpsTrail·위치 파생 데이터는 즉시 파기(30일 유예 없음) — 단 법정 로그(수집·이용 사실)는 분리 보관 유지(M12 purgeLocationData).
- **INV-GPS5 (수집·영속 경계 — CP4)**: U6은 수집·폴리라인 생산까지, 기록 귀속·경로 비교 데이터·영속 정본은 M12(U7) — CP4로 공급.

### 2.10 CP3 소비 참조 계약 (U5 → U6 입력) — 일정 기준선

U6는 U5가 공급하는 **일정 기준선**을 실행 허브·재계획의 입력으로 소비한다(스키마 정본은 U5, 재정의 금지). **5개 유닛(U6·U7·U8·U10·U11) 공유 척추** — U6는 이를 신뢰하되 상태 머신 규칙(D20)을 방어적으로 재검증한다.

| 입력 객체(U5 소유) | U6 소비 용도 | 소비 시 방어 검증 |
|---|---|---|
| Itinerary(plan 불변/current 가변·상태 INTRIP·확정 D20) | 실행 기준선(current) 로드·재계획 결과 반영 대상(current만) | 상태 INTRIP 정합·확정 해제 경합 차단(D20)·plan 불변 유지 |
| DaySchedule[](일자·거점·시간창) | 오늘 일정 허브 구성·재계획 당일 범위 | 시간창 정합·거점 기준(하드 제약 재검증 시 C2) |
| ItinerarySlot[](slotId·LOCK·고정 블록·DistanceRange) | 방문 상태 머신 부착(slotRef)·재계획 재정렬·거리 표시(소요시간 없음) | slotId 무결성·소요시간 미매핑(D25)·closed-set 보존 |
| FixedBlock[](숙소 체크인/아웃·시각 고정 방문지) | 재계획 고정 제약(불가침 ADR-0006)·warm-start 보존 | 고정 블록 불변·충돌 자동 변경 금지(U5 INV-FIX 재사용) |

> 계약 변경 통제: plan/current 이중 구조·slotId 식별 체계는 ADR급. U6 착수 후 U5 계약은 필드 추가만 허용(파괴적 변경 금지).

### 2.11 CP4 공급 계약 (U6 → U7 출력) — actual·changelog·GPS

U6 산출이 U7 기록·회고 생산의 트리거·원천 데이터다. U6(M18·M10)이 발행하고 U7(M12·M13)이 구독한다.

| 이벤트/객체 | 필드(개요) | 경계 무결성 |
|---|---|---|
| VisitChecked | 여행·일정·slotRef, canonicalPoiId, 도착 확인 시각(사용자 탭 D23), 전이 유형(start/complete/skip), 실제 체류(departedEstimatedFlag) | INV-VISIT2·3·5 |
| DayClosed | 여행·일자, 당일 방문 요약(완료·스킵 카운트) — 당일 회고 초안 트리거 | INV-EXEC1·4 |
| TripEnded | 여행, 종료 방식(AUTO_NEXTDAY/MANUAL D19/Δ4), 종료 시각 — 전체 요약·스타일 분석 트리거 | INV-EXEC1·4 |
| changelog diff(G132 통합 스키마) | 항목 단위: 대상(slotRef), 행위자, 출처 유형(**PlanB** — 후속 공용 enum), 사유, 전/후 값(POI 내부 ID), 발생 시각, 스키마 버전 | INV-REPLAN2, G57/G132 |
| GPS 폴리라인 | 여행·일자, 단순화 폴리라인(원시 파기 후 G55/G73), consentRef | INV-GPS3·4·5 |

**검증 방법 — 통합 테스트 시나리오(CP4)**

1. **actual 생산 파이프라인**: 방문 완료 체크(U6) → VisitChecked 발행 → U7 actual 방문 기록 생성 → plan/actual/changelog 3계열 대조(US-E8-04) 정확 표시.
2. **회고 트리거 연쇄**: TripEnded(자동·수동 각각) 수신 시 전체 요약 생성 기동, LLM 실패 시 기본 카드 폴백까지 도달(침묵 실패 금지).
3. **changelog 재생 동등성**: U6 재계획 생산 changelog diff 시퀀스를 U7이 순서대로 재생한 결과가 current 스냅샷과 일치.

> 계약 변경 통제: changelog 통합 스키마(G132)는 후속 3유닛(U9·U10·U11) 공용 — 스키마 버전 필드로 전방 호환.

### 2.12 C1·C2 재사용 계약 (U5 자산 — 계약 수준)

U6은 U5가 프로덕션 품질로 완성한 **C1 LLM Gateway·C2 Solver Engine을 재사용**한다(중복 재구현 금지, FD-U6-03).

| 자산 | U6 재사용 용도 | 재사용 계약(입출력) | 하드 제약 재사용 |
|---|---|---|---|
| C1 LLM Gateway | 재계획 **사유 해석·후보 정렬 힌트**(날씨→실내·체력→축소) | C1.call(reason, sessionContext) 경량 티어(D11)·서버 재조회 컨텍스트 주입(D31)·타임아웃 1.5초 규칙 매핑 폴백 | closed-set 그라운딩(G115)·계정 무결성(D31·SECURITY-11) = U5 INV-SCORE1·4 재사용 |
| C2 Solver Engine | 후보 검증·재정렬·**확정 시점 재검증**(G56) | C2.solve/validate(warm-start·당일 잔여)·C2.estimateTravel(거리만 반환·internalDuration 내부) | **하드 제약 4계열(HC1~HC4) = U5-P1 그대로 재사용**(생성과 동일 검증, 재구현 0) |
| ConstraintSpec(C2 D28) | (수동 편집 폴백) 클라 경량 검증 | U5 shared/validation 재사용 | U5 INV-SOLVE1 재사용 |

> 재사용 원칙(FD-U6-03): U6은 C1·C2의 계약 인터페이스만 소비하고 도메인 로직(최적화·하드 제약 검증·closed-set)을 재구현하지 않는다 — "재계획 결과도 생성과 동일한 하드 제약 4계열 검증 100%"는 U5 C2·U5-P1 재사용으로 달성한다.

### 2.13 엔티티-스토리 추적 요약

| 엔티티 | 주 근거 스토리 | 주 결정 |
|---|---|---|
| TripExecutionState | US-E7-01, US-E8-08 | D19/Δ4, D21, G54, components §3.1 |
| ActiveTripHub | US-E2-02·03, US-E5-08, US-E6-03 | D21, D24/Δ6, D25, G3 |
| VisitState / ArrivalPromptLog | US-E6-01, US-E8-01 | D23, ADR-0010, components §3.3, CP4 |
| RestMode | US-E7-06 | G54, G159, G100 |
| TriggerEvent / SuppressionState / SensitivitySetting | US-E7-02 | D27, D10, D34, G58/G195, G116 |
| ReplanSession | US-E7-01·03·10·11·12 | D19, D38, C10, D14, G53, G56, ADR-0006 |
| Alternative / UnplacedList | US-E7-04·05·07·08 | G53, D25/Δ1, C10, G115 |
| WeatherData | US-E7-02 | D10, G195, RESILIENCY-09 |
| GpsTrail | US-E7-13, US-E8-03 | G55/G73, D34/N2, G59, G62, CP4 |

---

## 3. 비즈니스 규칙

규칙 ID `BR-U6-xx`(본 유닛 전역 유일 — 코드·테스트·리뷰 추적 키). 각 규칙은 **조건**(언제 평가하는가)·**동작**(무엇을 하는가)·**위반 시 처리**·**근거**(US·D·Δ·N·G·C·ADR)로 구성한다. remote config 수치(상한·임계·폴링 주기·안전계수 G106)·지오펜스 SDK·기상청 어댑터는 [NFR 기준](../nfr.md)·§6·§7 소유다. `[하드 계열]`=plan 불변·current만 갱신(D14) 계열, `[하드 제약 재사용]`=U5 C2 하드 제약 4계열 재사용 검증.

**규칙 색인**

| 그룹 | 규칙 |
|---|---|
| A. 도착 감지·방문 전이·체류 측정 | BR-U6-01 ~ 05 |
| B. 여행 실행 상태·종료 전이 | BR-U6-06 ~ 08 |
| C. 자동 트리거 하이브리드·억제 | BR-U6-09 ~ 14 |
| D. 재계획 세션·후보·확정 | BR-U6-15 ~ 22 |
| E. 휴식 모드 | BR-U6-23 ~ 24 |
| F. 위치 폴백·3층 동의·GPS 발자취 | BR-U6-25 ~ 28 |
| G. 표시(거리·여유·외부 지도) | BR-U6-29 ~ 31 |

### 3.A 도착 감지·방문 전이·체류 측정

**BR-U6-01 지오펜스 도착 감지 — 확인 프롬프트만·자동 기록 없음 [하드 계열]**
- 조건: 포그라운드 상태에서 다음 예정지 지오펜스 진입 감지 시(`onGeofenceEnter`).
- 동작: 현재 위치가 다음 예정지 인근임을 감지하면 **'도착하셨나요?' 확인 프롬프트만 노출**(UPCOMING→ARRIVALPENDING)하고, **도착 확정·방문 완료는 항상 사용자 탭으로만 처리**한다(자동 확정·자동 기록 없음, INV-VISIT2). 위치 감지는 **포그라운드 한정**이며 백그라운드 위치 권한은 요청하지 않는다(G62).
- 위반: 지오펜스 진입만으로 방문을 자동 완료·자동 기록하는 것은 결함(D23 위반) — 머지 차단 테스트(PBT U6-P1).
- 근거: US-E6-01, PRD 08-1, D23, D27, G62.

**BR-U6-02 수동 도착·방문 완료·스킵 — 위치 무관 항상 가능**
- 조건: 사용자 방문 처리 액션(도착/완료/스킵/취소) 시.
- 동작: 사용자가 **수동으로 '도착'을 표시하는 경로를 항상 제공**하고(위치 동의·GPS 정확도 무관 ADR-0010), 도착 시 방문 시작/완료 체크·사진·메모 진입점을 활성 일정 위에 노출한다. 장소 **스킵과 방문 완료 취소(undo)** 지원(INV-VISIT1 전이표).
- 위반: 위치 권한 없음/GPS 저정확도를 이유로 방문 처리를 막는 것은 결함(수동 체크인 기본 수단 보장).
- 근거: US-E6-01, PRD 08-1, D23, ADR-0010.

**BR-U6-03 방문 완료·실제 체류 측정 — 다음 장소 체크로 추정**
- 조건: 방문 완료 전이(INPROGRESS→COMPLETED) 시.
- 동작: 방문 완료는 활성 일정의 진행 상태(완료/진행 중/다음)에 반영되고 **실제 체류 시간 측정의 기준**이 된다. 방문 종료 시각은 (a) 사용자 '방문 완료' 탭 시각(실측) 또는 (b) **다음 장소 도착 체크 시각으로 추정**(departedEstimatedFlag=true)한다(INV-VISIT3). 실제 체류(actualStay)는 plan 체류와 함께 M12에 보관하고 **체류 초과 시 M9 트리거 (d) 입력**으로 공급한다.
- 위반: 추정 종료 시각을 실측으로 위장 표기하거나 체류 측정을 누락하는 것은 결함(허위 정확성·트리거 입력 누락).
- 근거: US-E6-01, PRD 08-1·09-1, D23.

**BR-U6-04 도착 프롬프트 1회·재프롬프트 억제**
- 조건: 도착 프롬프트 노출·닫기 시.
- 동작: 동일 방문지에 대해 프롬프트를 노출하고 사용자가 **닫으면(DISMISS) 해당 방문지로 재프롬프트하지 않는다**(promptSuppressed=true, ArrivalPromptLog 근거). 외부 지도앱 복귀 시 다음 예정지 근접이면 도착 확인 프롬프트를 노출한다(BR-U6-30 연계).
- 위반: 닫은 방문지에 재프롬프트 폭주는 결함(억제 규칙 위반).
- 근거: US-E6-01, US-E6-03, D23, G66.

**BR-U6-05 스킵·잔여 영향 — Plan-B 제안 연결**
- 조건: 방문 스킵/취소로 잔여 일정에 영향 발생 시.
- 동작: 방문 스킵(any→SKIPPED)이 잔여 일정에 영향을 주면 Plan-B 수동 재계획 제안으로 연결한다(자동 변경 아님 — 제안만, INV-TRIG3). 스킵 기록은 M12에 영속(actual).
- 위반: 스킵을 잔여 일정에 자동 반영(임의 재정렬)하는 것은 결함(제안만 원칙).
- 근거: US-E6-01, PRD 09-1, D23, INV-TRIG3.

### 3.B 여행 실행 상태·종료 전이

**BR-U6-06 여행 종료 전이 — 익일 00시 자동 + 수동 버튼 단일 규칙 [하드 계열]**
- 조건: 여행 종료 판정 시(`autoEndTrips` 배치 ∨ `endTripManually`).
- 동작: 여행 종료는 **(a) 종료일 다음날 00:00 자동 배치 + (b) '여행 종료' 수동 버튼** 병행의 단일 규칙이며 **숙소 유무와 무관**하다(D19/Δ4). 자동/수동 경합 시 **조건부 전이(이미 ENDED면 no-op)** 로 `TripEnded`는 여행당 정확히 1회 발행되고(INV-EXEC1), 이 전이가 회고 자동 생성·기록 귀속 마감의 **유일한 트리거**다(CP4).
- 위반: 종료 전이가 중복 `TripEnded`를 발행하거나 숙소 유무로 규칙이 갈리는 것은 결함(단일 규칙·멱등 위반, PBT U6-P8).
- 근거: US-E7-01, US-E8-08, PRD 07-1·09, D19/Δ4, services S4.1.

**BR-U6-07 일자 경계 — DayClosed 당일 회고 트리거**
- 조건: 일자 경계 배치(자정) 도달 시.
- 동작: 일자 경계에서 **`DayClosed`를 발행**해 당일 회고 초안 자동 생성(M13)을 트리거하고 currentDate를 다음날로 갱신한다. `DayClosed`는 당일 방문 요약(완료·스킵 카운트)을 포함한다(CP4).
- 위반: 일자 경계에 DayClosed 미발행으로 당일 회고가 트리거되지 않는 것은 결함.
- 근거: US-E8-06, D19, services S4.6, CP4.

**BR-U6-08 진행률 산출 — 방문 체크 완료 비율**
- 조건: 진행률 조회(허브·홈 카드·여행 목록) 시.
- 동작: 진행률은 **방문 체크 완료(COMPLETED+SKIPPED) 비율**로 산출한다(G3) — 홈 활성 카드·여행 목록에 공급. 활성 허브는 진행 중 여행당 1개로 수렴한다(단일 허브, INV-HUB1).
- 위반: 진행률 정의 불일치(카운트 기준 상이)·복수 허브 노출은 결함.
- 근거: US-E2-02, US-E9-07, G3, PRD 01-3.

### 3.C 자동 트리거 하이브리드·억제

**BR-U6-09 트리거 4종·하이브리드 감지 (D27)**
- 조건: 자동 트리거 감지 시.
- 동작: 재계획 필요 상황 4종을 하이브리드로 감지한다 — **(a) 날씨·(b) 휴무·영업시간 변경 = 서버 배치 폴링+푸시**(날씨 1시간·휴무 당일 아침 1회), **(c) 이동 지연·(d) 체류 초과 = 클라이언트 포그라운드 한정 감지**(백그라운드 위치 미요청 G62)로 분리(detectionMode). 판정 로직은 **clock·외부 데이터 주입 가능한 순수 함수로 분리**(결정적 테스트, G116, INV-TRIG4).
- 위반: 위치 트리거를 백그라운드에서 감지하거나 판정 로직에 clock·외부 데이터를 하드코딩(비결정)하는 것은 결함.
- 근거: US-E7-02, PRD 07-2, D27, G62, G116.

**BR-U6-10 기상 트리거 — 강수 60%·특보 (기상청 D10)**
- 조건: 트리거 (a) 날씨 판정 시.
- 동작: 다음 방문지 **도착 시간대 강수확률 60% 이상 또는 기상특보 발효**를 기상청 공공데이터포털 데이터로 판정한다(D10). 특보는 **심각(SEVERE) 사유·푸시 대상**, 강수확률은 사유별 심각도 규칙에 따른다. 좌표→기상청 격자 변환은 결정적(INV-WX2).
- 위반: 기상청 외 소스로 판정하거나 특보를 경미로 분류하는 것은 결함.
- 근거: US-E7-02, PRD 07-2a, D10.

**BR-U6-11 체류 초과·이동 지연 — 고정 일정 위협 판정**
- 조건: 클라이언트 포그라운드 신호(체류 초과·이동 지연) 수신 시(`reportClientSignal`).
- 동작: **(c) 이동 지연 = 계획 대비 임계(기본 15분 G106) 초과**, **(d) 체류 초과 = 계획 체류 대비 임계(기본 20분) 초과로 다음 고정 일정(숙소 복귀·시각 고정 방문지) 도착 위협** 시 트리거를 판정한다. 임계 파라미터는 remote config(G106). 고정 일정 도착 위협은 심각(SEVERE) 분류.
- 위반: 임계 하드코딩·고정 일정 위협 미반영으로 오탐/미탐하는 것은 결함(트리거 소음·미발화).
- 근거: US-E7-02, US-E8-01, PRD 07-2c·d, ADR-0009, G106.

**BR-U6-12 빈도 상한·묶음·민감도 (G58/G195)**
- 조건: 트리거 발화 전 억제 필터 시.
- 동작: **전역 빈도 상한(초기값 시간당 2회/하루 8회 — 초과·동시 발화는 묶어 1회로 정리)**, **동일 사유·동일 방문지 1회 노출**, **민감도 3단계(적게/보통/많이)가 상한을 ±50% 조정**한다. 상한 초과분은 SUPPRESSED. 전부 remote config(INV-TRIG1).
- 위반: 상한 초과 발화·동일 방문지 중복 노출·민감도 무시는 결함(트리거 소음 이탈, PBT U6-P3).
- 근거: US-E7-02, PRD 07-2, G58/G195.

**BR-U6-13 무시 억제 학습·심각도 채널 분리**
- 조건: 트리거 닫기(무시) 누적·발송 채널 결정 시.
- 동작: 사용자가 **동일 사유를 2회 연속 무시하면 당일 동일 사유를 억제(학습)** 한다(체류 초과 오발화 대응, INV-TRIG2·멱등). 발송 채널은 심각도로 분리 — **푸시는 심각 사유(기상특보·고정 일정 도착 위협)에 한정, 경미 건은 인앱 칩**. 알림에 **외부 데이터 출처·감지 시각을 표기**한다.
- 위반: 학습 억제 미적용·경미 사유 푸시·출처/시각 미표기는 결함.
- 근거: US-E7-02, PRD 07-2, G58.

**BR-U6-14 허위 알림 금지 — 데이터 없음 침묵 (ADR-0011)**
- 조건: 외부 API(날씨·영업시간) 무응답·`DataUnavailable` 시.
- 동작: 외부 데이터가 없으면 **자동 알림을 띄우지 않고 침묵**(허위 알림 금지)하며 **수동 재계획 경로만 유지**한다(INV-TRIG6·INV-WX1). '데이터 없음'을 '맑음/정상'과 구분하고, 다음 정상 응답 시점에 재평가한다. 이는 "잘못된 정보로 행동 유도 금지" 원칙이며 실패율은 관측 계측한다.
- 위반: 데이터 없음을 '맑음'으로 간주해 자동 알림을 억제하지 못하거나, 반대로 무응답에 허위 알림을 띄우는 것은 결함.
- 근거: US-E7-02 예외, PRD 07-2 예외, ADR-0011, RESILIENCY-10.

### 3.D 재계획 세션·후보·확정

**BR-U6-15 재계획 진입 — '여행 중' 게이트·숙소 0개 허용**
- 조건: 재계획 세션 시작(`startReplan`) 시.
- 동작: 수동(사유 5종+'사유 없음')·자동 트리거 '대안 보기' 어느 경로든 **'여행 중'(여행 날짜 구간 진입 D19) 상태에서만** 시작한다. **등록 숙소가 0개여도 날짜 구간 안이면 허용**(숙소=생성 기준일 뿐, 상태 진입 조건 아님, INV-REPLAN1). 진행 중 여행은 D21로 단수 — 대상 모호성 0. 방식 분기: **AI에게 맡기기 / 직접 수정**(직접 수정은 수동 편집 직행).
- 위반: 여행 중 아님에 재계획 진입 허용·숙소 0개 차단은 결함 — `PreconditionFailed(NOT_ACTIVE)` 반환.
- 근거: US-E7-01, US-E7-12, PRD 07-1·12, D19, D21.

**BR-U6-16 영향 분석 입력 — 현재 시각 이후 잔여만·숙소 고정 [하드 제약 재사용]**
- 조건: 재계획 영향 분석 입력 수집 시.
- 동작: 입력은 **현재 위치·현재 시각·남은 방문 예정지·고정 제약(숙소 체크인/아웃 일시·위치 — 변경 불가 ADR-0006 / 시각 고정형 필수 방문지)·당일 영업시간·POI 간 이동시간(거리 기반 추정 — 내부 계산 전용, 화면 소요시간 미표시 D25)** 이다. **영향 분석은 현재 시각 이후 남은 일정에만 적용하고 이미 완료된 방문지는 변경하지 않는다**(INV-REPLAN4·INV-VISIT4). 등록 숙소는 출발·복귀 기준점으로 고정한 채 방문 일정만 재구성한다(예약 자체 미변경).
- 위반: 완료 방문지 재배치·숙소 고정 제약 침범·소요시간 표시는 결함.
- 근거: US-E7-03, PRD 07-3, D25, ADR-0006, C10.

**BR-U6-17 후보 소싱·검증 — 저장 장소 우선·솔버 통과분만 [하드 제약 재사용]**
- 조건: 대안 후보 생성(`getAlternatives`) 시.
- 동작: 후보는 **C1 사유 해석**(날씨→실내 우선·체력→이동·방문 수 축소) + **M7 소싱(사용자 저장 장소 우선, 부족 시 주변 신규 POI 확장 G53)** + **C2 하드 제약 4계열 검증**으로 산출한다. 각 후보는 **솔버 검증 통과분만**(숙소 시간창·영업시간·이동 부등식·시각 고정 준수), 후보 POI는 RAG closed-set 그라운딩 실재 장소만(환각·폐업·좌표 불명 제외 — U5 INV-SLOT1 재사용). **2~3개** 제시, 10초 목표(D38). 각 후보 표시 정보(추천 이유·거리·수단·체류·다음 고정 제약까지 여유 시간)는 소요시간 없이 표기(INV-ALT2).
- 위반: 솔버 미검증 후보 제시·환각 POI 노출·소싱 우선순위 위반은 결함(하드 제약 재사용 위반, PBT U6-P11).
- 근거: US-E7-04, US-E7-05, PRD 07-4·5, G53, G115, D38, C2 재사용.

**BR-U6-18 대안 0개 폴백 3종 — 빈 화면 금지**
- 조건: 유효 후보 0건·전부 검증 실패·10초 초과 시.
- 동작: 빈 화면 대신 **폴백 3종 — "남은 방문지 1개 건너뛰기 / 휴식 모드로 전환 / 수동 일정 수정"** 을 제시하고 **대안이 없는 이유를 한 줄로 설명**한다(예: "남은 시간이 부족함 / 모든 후보가 영업 종료"). AI에게 맡기기·직접 수정 두 분기 대칭(INV-ALT4).
- 위반: 0건을 빈 화면으로 방치·사유 미설명은 결함.
- 근거: US-E7-04 예외, US-E7-12 예외, PRD 07-4·12, ADR-0011.

**BR-U6-19 수동 편집 폴백 — 숙소 고정 위반 차단**
- 조건: 직접 수정·외부 API 오류 폴백으로 수동 편집(`applyManualEdit`) 시.
- 동작: 수동 일정 수정에서 **순서 재배열·방문지 삭제·예정 시각 직접 입력**을 허용하되, **등록 숙소 체크인/체크아웃 고정 제약은 위반 불가**로 유지하고 침범 입력 시 **경고 + 저장 차단**한다. 어떤 외부 데이터가 누락된 채 수동 모드로 전환됐는지(예: 이동시간 자동 계산 불가) 화면에 표기하고, **API 복구 시 수동 수정 결과를 유지한 채 자동 검증·재계획을 재활성화**한다.
- 위반: 수동 수정에서 숙소 고정 제약 침범 허용·누락 데이터 미표기는 결함.
- 근거: US-E7-11, US-E7-12, PRD 07-11·12, ADR-0011, D28.

**BR-U6-20 전/후 비교 — 추가·삭제·이동 구분·지표 요약 (소요시간 없음)**
- 조건: 확정 직전 전/후 비교(`previewAlternative`) 시.
- 동작: 변경 전/후 일정을 나란히 보여주며 **시간대별로 추가/삭제/시간 이동된 항목을 시각적으로 구분**하고, **영향 지표(총 이동 거리 증감·방문지 수 증감·숙소 복귀 예정 시각 변화)를 요약**한다. **차량/도보 소요시간은 표시하지 않는다**(거리·시각만, INV-ALT2/D25). 사용자는 최종 "확정" 또는 "취소(원상복구)"를 선택한다.
- 위반: 변경 구분 미표시·소요시간 표기·지표 누락은 결함.
- 근거: US-E7-08, PRD 07-8, D25.

**BR-U6-21 확정 재검증·current 갱신·plan 불변 [하드 계열·하드 제약 재사용]**
- 조건: 대안 확정(`confirmAlternative`) 시.
- 동작: **확정 버튼 시점에 C2 솔버 재검증을 1회 수행**(G56)하고, 통과 시에만 **current에만 반영**한다 — plan 스냅샷은 불변 유지(D14, INV-REPLAN2). 재검증 무효화(그 사이 상황 변화) 시 **후보 재산출을 안내(확정 차단)**. 확정 TX에서 current 갱신 + **changelog 기록(사유·전/후 스냅샷·확정 시각·트리거 유형=자동/수동, G132)** + `ItineraryChanged` 발행(리마인드 재계산 D32). 재정렬은 변경분만 갱신하고 시각 고정형·완료 방문지는 보존(warm-start).
- 위반: 재검증 없이 반영·plan 변경·changelog 누락은 **하드 결함**(회고 대조 무결성, PBT U6-P5·P7).
- 근거: US-E7-08, US-E7-09, PRD 07-8·9, G56, D14, G57/G132, D32.

**BR-U6-22 당일 잔여 재정렬·이월 명시 동의 (C10)**
- 조건: 재정렬 범위 산정·이월 발생 시.
- 동작: 재정렬 범위는 **당일 잔여 일정만**(완료 방문·시각 고정 제외, INV-REPLAN4). 재정렬로 넣을 수 없게 된 방문지는 **미배치 목록(UnplacedList)에 보관**하고, **제외·이월되는 방문지를 확정 전 명시적으로 보여주고 사용자 동의를 받는다**(INV-ALT5). 사용자가 날짜를 선택하면 해당 일을 재계산(`rescheduleUnplaced`)한다.
- 위반: 타일자 임의 재정렬·이월 침묵 드롭·동의 없는 제외는 결함(PBT U6-P6).
- 근거: US-E7-07, PRD 07-7, C10.

### 3.E 휴식 모드

**BR-U6-23 휴식 모드 진입·억제 — 심각 사유 유지 (G54)**
- 조건: 휴식 모드 전환(`enterRestMode`) 시.
- 동작: 휴식 모드는 '여행 중'의 하위 상태(phase=REST)로, **경미한 트리거·일정 알림을 억제하고 심각 사유(기상특보·고정 일정 위협) 알림만 유지**한다(INV-REST1 — 심각은 억제 불가). 사용자는 **휴식 종료(재개) 시각을 입력하거나 즉시 재개**를 선택한다. "기존 유지" 선택 시 어떤 변경도 저장하지 않고 활성 일정 화면으로 복귀한다.
- 위반: 휴식 중 심각 사유(안전 위협) 억제·경미 알림 미억제는 결함.
- 근거: US-E7-06, PRD 07-6, G54, G100.

**BR-U6-24 휴식 재개 — 남은 일정 재계산 제안 (G159)**
- 조건: 재개 시각 도달 ∨ 즉시 재개(`resumeFromRest`) 시.
- 동작: **재개 시각 도달 시 알림과 함께 남은 일정 재계산을 제안**한다(자동 재계획 아님 — 사용자가 대안 보기를 눌러야 M10 세션 시작, INV-REST2·INV-TRIG3). phase는 REST→NORMAL로 복귀하고 억제가 해제된다.
- 위반: 재개 시 재계산 제안 미노출·자동 재계획 강행은 결함.
- 근거: US-E7-06, PRD 07-6, G159.

### 3.F 위치 폴백·3층 동의·GPS 발자취

**BR-U6-25 위치 3층 동의 동작 매트릭스 (G182 — Functional Design 이관 정본)**
- 조건: 위치 의존 기능(도착 감지·이동 지연/체류 트리거·재계획 기준 위치·GPS 발자취) 진입 시.
- 동작: 위치 동의는 **3층(① OS 위치 권한 × ② 앱 내 위치기반서비스 법정 동의 × ③ GPS 기록 옵트인)** 으로 관리하고, 조합별 기능 동작을 아래 매트릭스로 강제한다. **전 조합에 폴백이 존재**(빈 동작 금지)한다.

| ① OS 권한 | ② 법정 동의 | ③ GPS 옵트인 | 도착 자동 감지 | 위치 트리거(c·d) | 재계획 기준 위치 | GPS 발자취 |
|---|---|---|---|---|---|---|
| 허용 | 동의 | 옵트인 | 지오펜스 프롬프트(D23) | 평가 | GPS 실측 | 수집(포그라운드) |
| 허용 | 동의 | 미옵트인 | 지오펜스 프롬프트 | 평가 | GPS 실측 | **미수집**(비교 화면 추정 표기·레이어 disabled) |
| 허용 | 미동의 | — | **미감지**(수동 체크인) | **미평가**(위치 비의존만) | 수동 입력/최후 완료/숙소 | 미수집 |
| 거부 | 동의/미동의 | — | **미감지**(수동 체크인 ADR-0010) | **미평가** | **수동 입력 폴백**(핀·검색)→최후 완료→숙소(가정 표기) | 미수집 |
| (철회) 동의 후 철회 | 철회 | 철회 | 미감지 | 미평가 | 수동/숙소 | **즉시 파기**(N2) |

- 위반: 매트릭스 밖 동작(권한 거부에 자동 감지·미옵트인에 발자취 수집·철회 후 미파기)은 결함(법적·기능 리스크). 매트릭스 자체가 테이블 주도 테스트 스펙.
- 근거: US-E1-04, US-E7-10·13, N2, D34, G182, ADR-0010.

**BR-U6-26 위치 수동 입력 폴백 — 추정 출발지 표기 (US-E7-10)**
- 조건: 재계획 시 위치 권한 거부·GPS 불가 시.
- 동작: 위치 권한 거부를 감지하면 **재계획을 차단하지 않고 즉시 수동 위치 입력(지도 핀 지정 또는 장소 검색) 화면으로 안내**한다. 수동 입력 위치는 영향 분석·이동시간 산출의 현재 위치 기준점으로 사용하며 **추정 출발지임을 화면에 표기**한다(positionAssumption, INV-REPLAN7). 위치 입력도 거부·생략하면 **마지막 완료 방문지 또는 등록 숙소 위치**를 기준점으로 사용하고 그 가정을 명시한다.
- 위반: 위치 거부로 재계획 차단·추정 출발지 가정 미표기는 결함.
- 근거: US-E7-10, PRD 07-10, D22.

**BR-U6-27 GPS 발자취 — 옵트인·포그라운드 저빈도·원시 파기 (D34/G55/G73)**
- 조건: GPS 발자취 수집 시.
- 동작: GPS 발자취는 **GPS 기록 옵트인 동의를 전제**로(미동의 수집 불가 — `PermissionDenied`, INV-GPS1) **포그라운드 한정 저빈도(1~5분 간격)** 로 수집하며 **단순화 폴리라인만 서버에 보존하고 원시 좌표는 가공 후 파기**한다(INV-GPS3). 수집·이용 사실은 append-only 법정 로그로 기록(N2). **옵트인 철회·탈퇴 시 즉시 파기**(30일 유예 없음, 법정 로그는 분리 보관, INV-GPS4).
- 위반: 미동의 수집·백그라운드 수집·원시 좌표 영구 저장·철회 후 미파기는 결함(법적 리스크).
- 근거: US-E7-13, US-E8-03, D34/N2, G55/G73, G62.

**BR-U6-28 계획 vs 실제 경로·걸음 수 — 추정 표기 (US-E7-13)**
- 조건: 계획 동선 vs 실제 경로 지도 비교 조회 시.
- 동작: 지도에 **계획 동선(흐리게)과 실제 이동 경로(지나온 GPS 좌표 점선·점)를 함께 또는 토글로 표시**하고 **누적 실제 이동 거리·걸음 수를 표시**한다. **걸음 수는 GPS 이동 거리 환산 추정만**(추가 권한 없음 G59), 이동 거리·걸음 수 모두 **추정치임을 표기**한다(GPS 정확도·실내 구간 한계). 옵트인/권한 없으면 **실제 경로 레이어 비활성화 + 사유 표기**(계획 동선만).
- 위반: 추정 미표기·권한 없음에 실제 레이어 강제 노출은 결함.
- 근거: US-E7-13, PRD 07-13, G55, G59, D34.

### 3.G 표시 (거리·여유·외부 지도)

**BR-U6-29 여유 시간 — 이동시간 미반영 단순 차이 (G67/D25) [하드 규칙]**
- 조건: 현장 장소 상세·다음 일정까지 여유 시간 표시 시.
- 동작: **'다음 일정까지 여유 시간'은 다음 장소의 계획 시작 시각까지 남은 시간(이동시간 미반영 단순 차이)** 으로 계산한다(G67, D25 정합). 현장 장소 상세는 영업시간·예상 체류(추정 표기·출처)·주변 추천·여유 시간을 표시하고 **혼잡도는 '미확인'으로 통일 표기**(G199), 누락 데이터는 '미확인'.
- 위반: 여유 시간에 이동시간 반영·소요시간 표기는 결함(D25 위반).
- 근거: US-E6-02, PRD 08-2, G67, G199, D25.

**BR-U6-30 다음 예정지 거리 — 거리만·화면 진입 1회+새로고침 (G65)**
- 조건: 활성 일정 화면 '다음' 행 거리 표시 시.
- 동작: 별도 길찾기 화면 없이 **활성 일정 화면의 '다음' 행/맥락 액션에 현재 위치→다음 예정지 거리(거리 기반 추정)를 인라인으로 표시**하고 **차량/도보 소요시간은 표시하지 않는다**(INV-HUB2). 거리는 **화면 진입/포커스 시 1회 산출 + 수동 새로고침**(G65). 내부적으로 `C2.estimateTravel`을 쓰되 **거리만 반환**(internalDuration 내부 전용).
- 위반: 소요시간 표기·매 프레임 재산출(비용)·표시 DTO에 internalDuration 매핑은 결함(U5-P4 재사용).
- 근거: US-E6-03, PRD 08-3, D25, G65.

**BR-U6-31 외부 지도앱 위임·복귀 핸드오프 (G66)**
- 조건: 다음 예정지 길찾기·외부 지도앱 복귀 시.
- 동작: 실제 단계별 길안내·소요시간(대중교통 노선·환승 포함)은 **'외부 지도 앱으로 열기'로 위임**(출발·도착 좌표 전달)하고 **기기 설치 지도 앱 목록 시트에서 선택**하게 한다. **외부 지도앱에서 복귀하면 현재 활성 일정·다음 행동으로 매끄럽게 복귀**시키고, **복귀 시 다음 예정지에 근접해 있으면 도착 확인 프롬프트를 노출**한다(BR-U6-04 연계). 연결 가능한 외부 지도 앱이 없으면 **웹 지도 폴백 → 그것도 불가 시 앱 산출 거리 요약**(소요시간·수단별 경로 없음).
- 위반: 자체 턴바이턴 구현·복귀 맥락 상실·폴백 부재는 결함.
- 근거: US-E6-03, PRD 08-3, G66, D25, ADR-0012.

---

## 4. 비즈니스 로직 / 플로우 + 테스트 속성(PBT)

핵심 프로세스 플로우 5종과 Testable Properties(PBT-01) 식별표. 플로우 ID `FLOW-x`, 단계 `Sx`, 분기 `Bx`, 예외 `Ex`. 메서드 계약은 component-methods.md M18·M9·M10·M11, 서비스 정본은 services.md S2(Plan-B 재계획)·S4(여행 종료→회고)에 있다. **재사용 원칙(FD-U6-03)**: 재계획 후보 검증·확정 재검증은 U5 C2(하드 제약 4계열·U5-P1)를 그대로 재사용, 사유 해석은 U5 C1을 재사용한다 — U6은 오케스트레이션·상태 머신·트리거 억제·GPS 수집만 신규다.

### 4.1 FLOW-1 도착 → 방문 체크 → 체류 측정 (CP4 생산)

진입: 지오펜스 진입 감지 ∨ 수동 도착 탭 → `M18.onGeofenceEnter` / `M18.confirmArrival` → `M18.completeVisit`. 관련: US-E6-01, US-E8-01 · BR-U6-01~05 · D23, ADR-0010, G62, CP4.

```text
S1 도착 감지 [BR-U6-01]
   포그라운드 지오펜스 진입 → M18.onGeofenceEnter → '도착하셨나요?' 프롬프트만(UPCOMING→ARRIVALPENDING)
   가드: 위치 3층 동의 충족·GPS 정확도 충분(BR-U6-25 매트릭스) — 자동 기록 없음(INV-VISIT2)
   ├─ E1 위치 권한 없음·저정확도 → 프롬프트 미생성, 수동 체크인 대체(ADR-0010) [BR-U6-02]
   └─ B1 외부 지도앱 복귀 시 다음 예정지 근접 → 도착 프롬프트(handleExternalMapReturn) [BR-U6-30·31]
S2 도착 확정 — M18.confirmArrival(via=Prompt|Manual) [BR-U6-02]
   ARRIVALPENDING→INPROGRESS(∨ 수동 UPCOMING→INPROGRESS) · arrivedAt 기록(기기 시각·수정 가능)
   → VisitChecked(start) 발행(CP4 — M12 actual)
   └─ B2 프롬프트 닫기/무시 → ARRIVALPENDING→UPCOMING, promptSuppressed=true(재프롬프트 억제) [BR-U6-04]
S3 방문 완료 — M18.completeVisit [BR-U6-03]
   INPROGRESS→COMPLETED · departedAt = (a) '방문 완료' 탭 시각(실측) ∨ (b) 다음 장소 도착 체크 시각(추정·departedEstimatedFlag=true)
   actualStay = departedAt − arrivedAt(결정적 산출, INV-VISIT3) → M12 보관(plan 체류 대조)
   → VisitChecked(complete) 발행(CP4) · 체류 초과분(overstayGap) → M9 트리거 (d) 신호
   └─ B3 스킵/취소 → any→SKIPPED, 잔여 영향 시 Plan-B 제안 연결(INV-TRIG3) [BR-U6-05]
S4 진행 상태 반영 [BR-U6-08]
   활성 허브 진행 상태(완료/진행 중/다음) 갱신 · progress(완료+스킵 비율 G3) → 홈 카드·목록
```

사후 조건: 방문 상태는 전이표만 따르고(INV-VISIT1) 자동 확정 0(INV-VISIT2). actualStay 결정적(INV-VISIT3). VisitChecked·체류 신호가 CP4·M9로 정확히 공급된다.

### 4.2 FLOW-2 자동 트리거 감지 → 억제 → 알림

진입: 서버 배치 폴링(날씨·휴무) ∨ 클라 포그라운드 신호(지연·체류) → `M9.evaluateServerTriggers` / `M9.reportClientSignal`. 관련: US-E7-02 · BR-U6-09~14 · D27, D10, D34, G58/G195, G116 · services S2.1.

```text
S1 감지 (하이브리드, 순수 함수 판정) [BR-U6-09·10·11]
   서버 경로: J1(날씨 1시간)·J2(휴무 아침) → M9.evaluateServerTriggers
      (a) M11.getPrecipitationRisk 강수 60%↑ ∨ getActiveAlerts 특보(SEVERE), (b) M7 휴무·영업시간 변경
   클라 경로(포그라운드 D27): (c) 이동 지연(15분 G106)·(d) 체류 초과(20분·고정 일정 위협) → M9.reportClientSignal
   판정 = clock·외부 데이터 주입 순수 함수(G116, INV-TRIG4)
   ├─ E1 기상청·영업시간 무응답(DataUnavailable) → 트리거 침묵(허위 알림 금지 INV-TRIG6·INV-WX1) + 실패율 계측 [BR-U6-14]
   └─ E2 위치 동의 철회 → (c·d) 미평가, (a·b) 위치 비의존만 지속(INV-TRIG5) [BR-U6-25]
S2 억제 필터 [BR-U6-12·13]
   전역 상한(시간당 2/일 8·±50% 민감도), 동일 {사유·방문지} 1회, 초과·동시 발화 묶음 1회(INV-TRIG1)
   무시 2회 연속 → 당일 동일 사유 억제(학습·멱등 INV-TRIG2) · 휴식 모드 경미 억제(심각 유지 INV-REST1)
   ├─ B1 상한 초과·당일 억제·휴식 경미 → SUPPRESSED(발화 안 함·계측)
   └─ 통과 → DETECTED→FIRED
S3 발화·알림 — outbox TriggerFired(CP5) → M14 [BR-U6-13]
   심각(기상특보·고정 일정 위협)=푸시 / 경미=인앱 칩 · 출처·감지 시각 표기 · 방해금지 예외(진행 중 Plan-B severe G100)
S4 노출·수락 [트리거 수명 §2.5]
   FIRED→SHOWN(배너/칩) → 사용자 '대안 보기' → ACCEPTED → M10 재계획 세션(FLOW-3) — 자동 변경 없음(INV-TRIG3)
   └─ B2 닫기/무시 → DISMISSED → (2회) SUPPRESSED
```

사후 조건: 발화 수는 상한 불변식 준수(INV-TRIG1), 억제 멱등(INV-TRIG2), 판정 결정적(INV-TRIG4). 데이터 없음은 침묵(허위 알림 0). 트리거는 제안만(current 미변경).

### 4.3 FLOW-3 재계획 세션 (사유 → 후보 C1/C2 재사용 → 검증 → 확정 → current 갱신 → changelog)

진입: 수동 '재계획' ∨ 자동 트리거 '대안 보기' → `M10.startReplan`(정본 서비스 S2). 관련: US-E7-01·03·04·05·07·08·09·10·11·12 · BR-U6-15~22 · D14, D19, D25, D38, G53, G56, C10, ADR-0006 · services S2.2·S2.4.

```text
S1 세션 시작 — M10.startReplan(tripId, reason?, method, position?) [BR-U6-15]
   가드: '여행 중'(날짜 구간 D19)·숙소 0개 허용(INV-REPLAN1) — 위반 시 PreconditionFailed(NOT_ACTIVE)
   방식 분기: method=ManualEdit → S6 직행 / DelegateToAi → S2
   ├─ E1 GPS 불가 → positionRequired → M10.setManualPosition(핀·검색·추정 출발지 표기 INV-REPLAN7) [BR-U6-26]
   │     └─ 생략 → 최후 완료 방문지 ∨ 등록 숙소 기준(가정 명시)
S2 영향 분석 입력 수집 (1.0초 예산) [BR-U6-16]
   현재 위치·시각, 남은 일정(완료 방문 제외 — 현재 시각 이후만 INV-REPLAN4), 고정 제약(숙소 불변 ADR-0006·시각 고정), 당일 영업시간(M7), C2.estimateTravel(거리만 D25)
S3 C1 사유 해석 (1.5초 타임아웃) [BR-U6-17] — U5 C1 재사용
   C1.call(reason, sessionContext) 경량 티어 — 날씨→실내·체력→축소 정렬 힌트
   └─ E2 타임아웃·오류 → 규칙 기반 사유-카테고리 매핑 폴백(설명 축약)
S4 후보 소싱 (1.5초) [BR-U6-17]
   M7 저장 장소 우선 → 부족 시 주변 신규 확장(G53) · closed-set 그라운딩(G115, U5 INV-SLOT1 재사용)
S5 솔버 검증·재정렬 (4.5초·후보당 1.5초) [BR-U6-17] — U5 C2 재사용
   C2.solve/validate 후보별 하드 제약 4계열(HC1~HC4) 검증(U5-P1 재사용), warm-start(완료·시각 고정 보존), 당일 잔여만(C10)
   → Alternative 2~3개(솔버 통과분만 INV-ALT1), 사유 부합 정렬(INV-ALT3)
   ├─ E3 후보 0건/전부 실패/10초 초과 → Fallback 3종(1개 건너뛰기/휴식 전환/수동 수정)+사유 한 줄(INV-ALT4) [BR-U6-18]
   └─ E4 외부 API 오류 → S6 수동 수정 폴백(누락 데이터 표기·숙소 고정 위반 차단) [BR-U6-19]
S6 (분기) 수동 편집 — M10.applyManualEdit [BR-U6-19]
   순서 재배열·삭제·시각 직접 입력 · 숙소 고정 제약 위반 차단(입력 차단) · API 복구 시 자동 검증 재활성
S7 대안 표시·전후 비교 (0.5초) — M10.previewAlternative [BR-U6-20]
   후보별 추천 이유·거리·수단·체류·다음 고정 제약까지 여유(소요시간 없음 D25/INV-ALT2)
   전/후 diff(추가/삭제/시간 이동)·지표 요약(총 이동 거리·방문지 수·숙소 복귀 시각 증감)
   이월·제외 방문지 확정 전 명시 동의(INV-ALT5) [BR-U6-22]
S8 확정 — M10.confirmAlternative (별도 상호작용·1.0초) [BR-U6-21]
   확정 시점 C2 재검증 1회(G56, INV-REPLAN3)
   ├─ E5 재검증 무효화 → RevalidationFailed → S5 후보 재산출 안내(확정 차단)
   └─ 통과 → TX: current만 갱신(plan 불변 D14 INV-REPLAN2) + M12.appendChangeLog(사유·전후·트리거 유형 G132) + outbox ItineraryChanged
S9 사후 [BR-U6-21]
   M14 리마인드 재계산(D32) · 이월분 UnplacedList(사용자 날짜 선택 시 rescheduleUnplaced) [C10]
   └─ B1 '기존 유지'(keepCurrentPlan) → 어떤 변경도 미저장(CANCELLED)
```

성능 예산(D38 — services S2.4): S2~S7 합계 9.0초(여유 1.0초), S8 확정 재검증 1.0초는 10초 예산 외(별도 상호작용). 초과 시 산출 후보만 제시·0건이면 3종 폴백. 사후 조건: current만 변경·plan 바이트 동일 불변(INV-REPLAN2), 확정 재검증 통과 없이 반영 0(INV-REPLAN3), 재정렬 범위 당일 잔여만(INV-REPLAN4). changelog diff가 CP4로 U7 공급.

### 4.4 FLOW-4 여행 종료 전이 (자동/수동 D19 · DayClosed)

진입: J3 배치(종료일 익일 00:00 ∨ 일자 경계) ∨ '여행 종료' 수동 버튼 → `M18.autoEndTrips` / `M18.endTripManually`. 관련: US-E7-01, US-E8-08 · BR-U6-06·07 · D19/Δ4 · services S4.

```text
S1 종료 전이 [BR-U6-06]
   J3 M18.autoEndTrips(종료일 익일 00:00·숙소 무관 단일 규칙) ∨ M18.endTripManually
   TX: 여행 상태 조건부 전이(ACTIVE→ENDED, 이미 ENDED면 no-op — 자동/수동 경합 안전 INV-EXEC1) + outbox TripEnded
   → M13 회고 자동 생성·M14 완료 알림·M12 기록 귀속 마감(CP4)
S2 일자 경계 [BR-U6-07]
   J3 일자 경계 → DayClosed 발행(당일 방문 요약) → M13 당일 회고 초안 트리거 · currentDate 갱신
```

멱등성: `TripEnded`·`DayClosed` 핸들러는 (tripId, kind) 기준 중복 수신 안전(INV-EXEC1). 종료 후 기록 편집은 허용하되 회고 갱신은 수동 재생성만(C11). 사후 조건: 여행당 `TripEnded` 정확히 1회(PBT U6-P8), 회고 트리거는 종료 전이로만 개시(INV-EXEC4).

### 4.5 FLOW-5 휴식 모드 (진입 → 억제 → 재개 재계산)

진입: 재계획 대안 화면 '휴식 전환' ∨ 허브 휴식 버튼 → `M10.enterRestMode`. 관련: US-E7-06 · BR-U6-23·24 · G54, G159, G100.

```text
S1 진입 — M10.enterRestMode(tripId, resumeAt?) [BR-U6-23]
   TripExecutionState phase NORMAL→REST · RestMode{resumeAt?, suppressionScope=MINOR_ONLY}
   경미 트리거·일정 알림 억제 신호(M9·M14) · 심각 사유는 억제 불가(INV-REST1)
   resumeAt을 리마인드 큐(J4) 등록(NULL=즉시 재개 대기)
S2 재개 — M10.resumeFromRest [BR-U6-24]
   재개 시각 도달 알림 ∨ 즉시 재개 → phase REST→NORMAL(억제 해제)
   → ReplanProposal(남은 일정 재계산 제안) — 자동 재계획 아님(사용자 대안 보기 필요 INV-REST2·INV-TRIG3)
```

사후 조건: 휴식 중 심각 사유 억제 0(INV-REST1), 재개 시 재계산 제안(자동 변경 없음).

### 4.6 Testable Properties (PBT-01 — 속성 식별 정본)

PBT 전체 강제(D05~07 확장, D37 계층 분리). 프레임워크: 서버=Kotest Property Testing, 클라이언트=fast-check. 시드 로깅·수축(shrinking) 필수(PBT-08). **트리거 판정·상태 머신은 실코드 테스트, 외부(기상청·거리 API·LLM)만 어댑터 fake**(D37). 아래 속성은 U6 Code Generation의 DoD 항목이며, U6 DoD 명시 속성((a)트리거 판정 순수 함수 상한·억제·민감도·(b)방문 상태 머신 전이·(c)warm-start 고정 블록 보존·(d)휴식 억제 규칙·(e)폴리라인 단순화)을 전부 포함·확장한다.

**M18 Trip Execution (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P1 | 방문 상태 머신(stateful) | **방문 전이 가드**: 임의 (상태·트리거) 시퀀스에 (a) 전이표 조합만 성공, (b) 표 밖 전이(COMPLETED→INPROGRESS 역행·UPCOMING→COMPLETED 직행·SKIPPED 재전이) 전부 거부(INV-VISIT1), (c) **지오펜스 진입은 프롬프트만 — 어떤 상태도 자동 확정 안 함**(INV-VISIT2), (d) 수동 도착은 위치 무관 항상 가능(ADR-0010) | 상태·트리거 시퀀스 생성기(유효/무효 혼합) + 위치 동의·GPS 정확도 주입 |
| U6-P2 | 체류 측정 결정성 | **체류 산출 결정성**: actualStay=departedAt−arrivedAt이 (a) 동일 입력에 동일 산출(결정적·clock 주입), (b) departedAt이 다음 장소 체크 추정이면 departedEstimatedFlag=true 전파(허위 정확성 0), (c) arrivedAt 부재 시 미산출(NULL) | 방문 시각 쌍 생성기(실측/추정 혼합) + 다음 장소 체크 시각 주입 |
| U6-P8 | 여행 종료 전이 단일성 | **종료 전이 멱등·단일**: 임의의 (자동 익일 00:00 배치 · 수동 버튼) 발화 순서·중복에 `TripEnded`가 여행당 **정확히 1회** 발행되고(조건부 전이·이미 ENDED면 no-op, INV-EXEC1), endedAt·endMethod는 첫 전이에서만 확정 — 숙소 유무 무관 단일 규칙 | 종료 트리거 시퀀스 생성기(자동/수동 경합·중복·순서 셔플) + 숙소 유무 주입 |

**M9 Plan-B Detection (서버 — Kotest · 순수 함수 시뮬레이션)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P3 | 트리거 상한·억제 멱등(순수 함수) | **상한 불변식·억제 멱등**: 임의 clock·트리거 시퀀스에 (a) FIRED 발화 수가 **전역 상한(시간당 2/일 8·민감도 ±50%)을 초과하지 않음**(INV-TRIG1), (b) 동일 {type, slotRef} 1회만 SHOWN, (c) 동일 사유 2회 무시 후 당일 동일 사유 억제(멱등 — 반복 판정에 재발화 0, INV-TRIG2), (d) **휴식 모드 경미 억제·심각 사유 억제 불가**(INV-REST1) | clock·트리거 시퀀스 생성기(사유·방문지·시각 분포) + 무시 이벤트 + 휴식 상태·심각도 주입 |
| U6-P4 | 트리거 판정 결정성·민감도 단조 | **판정 순수 함수**: (a) 동일 (clock·날씨·체류·이동) 입력에 동일 판정(결정적·주입, INV-TRIG4), (b) 민감도 상향(적게→많이) 시 발화 임계 완화로 발화 집합이 단조 확대(비축소), (c) 위치 동의 철회 시 (c·d) 트리거 미평가·(a·b) 유지(INV-TRIG5) | 판정 입력 생성기(임계 경계 분포) + 민감도 레벨 시퀀스 + 위치 동의 상태 주입 |

**M10 Itinerary Recalculation (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P5 | plan 불변·current만 변경(하드 계열) | **재계획 격리**: 확정된 INTRIP 일정에 임의의 재계획 연산 시퀀스(사유·후보·확정·기존 유지)를 적용해도 (a) U5 PlanSnapshot.frozenDays가 **바이트 동일**하게 유지(plan 변경 0, INV-REPLAN2 · U5 INV-PLAN1 소비), (b) 변경은 current에만 반영, (c) '기존 유지'·CANCELLED는 current도 불변 | INTRIP 일정 + 재계획 연산 시퀀스 생성기(확정/취소/기존유지 혼합) |
| U6-P6 | 당일 잔여 재정렬 범위 불변식(C10) | **재정렬 범위**: 임의 재계획에 (a) 재배치 대상은 **현재 시각 이후 당일 잔여 방문지만**(완료·시각 고정·숙소 고정 제외, INV-REPLAN4), (b) 타 일자 슬롯 불변, (c) 넣지 못한 방문지는 UnplacedList로 이월(침묵 드롭 0)·확정 전 명시(INV-ALT5) | 일정 생성기(완료/잔여/고정 혼합·다일자) + 현재 시각·재계획 사유 주입 |
| U6-P7 | 확정 재검증 게이트(G56) | **확정 재검증**: 확정 버튼 시점 C2 재검증(G56)에 (a) 재검증 무효화 시 CONFIRMED 전이 거부·CANDIDATES 복귀(반영 0, INV-REPLAN3), (b) 통과 후보만 current 반영, (c) 재정렬 결과가 하드 제약 4계열 통과(U5-P1 재사용) | 후보 + 확정 시점 상황 변화(영업 종료·시간 경과) 주입 |

**M12 계약 — GpsTrail (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P9 | 폴리라인 단순화 라운드트립 | **GPS 폴리라인**: 임의 원시 좌표열에 (a) 단순화 폴리라인이 **경로 위상(방문 순서·구간 연결) 보존**(INV-GPS3), (b) 단순화→직렬화→역직렬화 라운드트립에서 위상 동등, (c) **원시 좌표 파기 후 재구성 불가**(파기 검증)·표시·거리 산출엔 충분, (d) 옵트인 미동의 입력은 수집 거부(INV-GPS1) | 원시 좌표열 생성기(밀도·노이즈 분포) + 옵트인 동의 상태 주입 |

**M11 Weather & Context (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P10 | 격자 변환 결정성 | **격자 변환**: 위경도→기상청 격자 변환이 (a) 동일 좌표 동일 격자(결정적 순수 함수, INV-WX2), (b) API 실패 시 `DataUnavailable` 명시('맑음' 위장 0 — INV-WX1·INV-TRIG6 입력) | 좌표 생성기(국내 범위 분포) + API 성공/실패 주입 |

**C2 재사용 검증 (서버 — U5 자산·계약 테스트)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U6-P11 | 하드 제약 재사용(U5-P1) | **재계획 하드 제약 = 생성 하드 제약**: 재계획 후보·확정 재정렬 결과가 **U5 C2 하드 제약 4계열(HC1 영업시간·HC2 이동 부등식·HC3 고정 블록·HC4 시간창)을 그대로 재사용 검증**해 위반 배치가 결과에 부재(INV-ALT1). **U5-P1(oracle 포함)을 재계획 입력으로 재실행** — U6은 하드 제약을 재구현하지 않고 U5 C2를 호출(재구현 0 확인) | 재계획 문제 인스턴스 생성기(당일 잔여·고정 블록·이동 파라미터) → U5 C2.solve/validate 재호출 |

**속성 없는 컴포넌트 (No PBT properties identified)**

| 컴포넌트 | 판정 | 사유 |
|---|---|---|
| M18 허브 조립(getActiveHub·getPlaceContext) | No PBT | 읽기 모델 집약·표시 DTO — 소요시간 미표시는 U5-P4(표시 게이트) 재사용, 진행률은 카운트 집계. 예시 기반+온라인 전제 오류 처리 통합 테스트 |
| M18 외부 지도 핸드오프(buildExternalMapHandoff·handleExternalMapReturn) | No PBT | 좌표 페이로드 조립·복귀 라우팅 — 폴백 계단(외부 앱 없음→웹→거리 요약)은 예시 기반 |
| M10 오케스트레이션(startReplan 시퀀스·10초 예산) | No PBT | 외부 모듈 조립·TX 경계·타임박스 — 도메인 로직은 하위 C2(U6-P11)·C1(U5 재사용)·상태 머신(U6-P5~7)으로 분해. 폴백 계단·성능 예산은 예시 기반 통합 테스트+어댑터 fake |
| M10 위치 폴백 체인(setManualPosition) | No PBT | 폴백 우선순위(GPS→수동→최후 완료→숙소)·가정 표기 — 3층 매트릭스(BR-U6-25)의 테이블 주도 테스트 |
| M11 캐시·쿼터 보호 | No PBT | TTL·서킷 브레이커 정책(수치 NFR) — 결정성(U6-P10)과 달리 정책 테이블. 예시 기반+계약 테스트 |

**커버리지 대조 (U6 DoD → 속성)**

| U6 DoD 명시 속성 | 대응 |
|---|---|
| (a) 트리거 판정 순수 함수(상한 초과 발화 0·무시 2회 억제·민감도 단조) | U6-P3 · U6-P4 |
| (b) 방문 상태 머신(예정→도착→시작→완료/스킵) 전이 불변식 | U6-P1 |
| (c) warm-start 재계획 고정 블록 보존 | U6-P7 · U6-P11(C2 재사용) |
| (d) 휴식 모드 억제 규칙(심각 사유 억제 불가) | U6-P3(d) |
| (e) 폴리라인 단순화(원시 파기 후 재구성 불가·위상 보존) | U6-P9 |
| (설계 확장) 체류 측정 결정성 | U6-P2 |
| (설계 확장) 재계획 plan 불변·current만 변경 | U6-P5 |
| (설계 확장) 당일 잔여 재정렬 범위 불변식(C10) | U6-P6 |
| (설계 확장) 여행 종료 전이 단일성(D19) | U6-P8 |
| (설계 확장) 격자 변환 결정성·데이터 없음 명시 | U6-P10 |
| (설계 확장) 재계획 하드 제약 = U5 재사용 | U6-P11 |

**속성 합계: 11개** (M18: 3 · M9: 2 · M10: 3 · M12(GPS): 1 · M11: 1 · C2 재사용: 1).

**하드 제약(D37) 대조 — U6은 재사용·경계 방어**

| 하드 제약 | U6 방어 속성·불변식 |
|---|---|
| **충돌 무배치**(재계획 결과도 영업시간·이동 부등식·시간창 위반 0) | **U6-P11(U5-P1 재사용·oracle)** · INV-ALT1 · BR-U6-17·21 |
| **숙소 기준점**(숙소 고정 제약 불가침 — 예약 미변경 ADR-0006) | INV-REPLAN5 · BR-U6-16·19 · U6-P6·P7 |
| **POI 그라운딩**(재계획 후보 ⊆ closed-set) | U5 INV-SLOT1 재사용 · INV-ALT1 · BR-U6-17 |
| **계정 무결성**(C1 재조회 컨텍스트 — 재계획 사유 해석) | U5 INV-SCORE4 재사용(SECURITY-11) · §2.12 재사용 계약 |
| **회고 대조 무결성**(재계획 후 plan 불변·current만) | U6-P5 · INV-REPLAN2 · U5 INV-PLAN1 소비 |

> **C2 재사용 명시(FD-U6-03)**: U6은 하드 제약 검증을 재구현하지 않는다 — 재계획 후보·확정 재검증은 U5 `C2.solve/validate`를 호출하고, PBT는 U5-P1(무차별 대입 oracle 포함)을 재계획 입력으로 재실행해 "재계획 하드 제약 = 생성 하드 제약"을 통합 검증한다(U6-P11). 이로써 "재계획 결과도 생성과 동일한 하드 제약 4계열 검증 100%"(U6 DoD)가 이중 개발 없이 성립한다.

---

## 5. 프런트엔드 컴포넌트

클라이언트 feature: `features/execution`(허브·도착·체류·현장 상세·다음 이동) + `features/planb`(트리거·재계획·휴식·경로 비교) + `shared/location`(위치 권한 3층 상태 G182·포그라운드 수집). 서버 능력은 component-methods.md M18·M9·M10·M11 참조, 판정 정본은 항상 서버(재계획 하드 제약=서버 C2, 트리거 판정=서버 M9 순수 함수)다. **지도 렌더링은 U3 `shared/map`(카카오 지도 SDK 브리지) 재사용 + U5 지도 뷰(순서 핀·동선) 재사용** — U6는 새 지도 브리지를 만들지 않는다(FD-U6-09). data-testid 규약: `execution-{screen}-{role}`(E2E·컴포넌트 테스트 앵커). 지도·장소 상세의 상위 화면 계보는 [U3 장소·숙소](./u3-place-stay.md), 일정 지도 뷰 원류는 [U5 일정](./u5-itinerary.md)에 있다.

### 5.1 실행·Plan-B 화면 플로우 (정본)

```text
[여행 시작일 00:00 도달(M18 배치) → 홈 활성 카드·'일정' 탭이 실행 허브로 수렴]
        │
        ▼
┌─ ActiveTripHubScreen (단일 허브 — 진행률·현재/다음 슬롯·다음 예정지 거리·여유 시간) ────────────┐
│   오늘 일정(완료/진행 중/다음) · nextLegDistance(거리만 D25) · slack(단순 차이 G67) · 진행률(G3)  │
│   상단: TriggerBannerHost(Plan-B 제안 칩·배너 — 자동 트리거 SHOWN)                              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   │ 도착/방문          │ 장소 상세        │ 다음 이동           │ '대안 보기'/'재계획'   │ '여행 종료'
   ▼                   ▼                 ▼                    ▼                      ▼
ArrivalPromptSheet  PlaceContextSheet  NextLegBar          ReplanFlow            EndTripConfirm
(도착 확인·수동 도착) (영업·체류·여유·미확인) (거리·외부 지도 시트)  (사유·기준·후보·전후·확정)  (수동 종료 D19)
   │ 방문 체크/스킵                       │ 외부 지도앱 복귀 → 도착 프롬프트   │ 휴식 전환
   ▼                                     (handleExternalMapReturn G66)        ▼
VisitCheckControls ──▶ VisitChecked(CP4)                                    RestModeScreen
                                                                             (진입·재개 재계산 G54)
        │ 계획 vs 실제 경로 토글
        ▼
PlanVsActualMapScreen (계획 동선 흐리게 + GPS 발자취 점선 · 누적 거리·걸음 수 추정 — U3/U5 map 재사용)
```

**전역 규칙**
- 실행·Plan-B 화면군은 5탭 셸(U2) 내 '일정' 탭 스택 + 홈 활성 카드에서 진입하며 **단일 허브(ActiveTripHubScreen)로 수렴**한다(INV-HUB1). 여행 종료(ENDED) 시 허브 소멸(추억 카드 전환).
- **사용자에게 보이는 모든 시각·거리·여유 시간은 서버 검증값·거리만** 렌더한다 — **소요시간 필드는 어떤 화면에도 없다**(D25/Δ1, INV-HUB2/INV-ALT2, U5 INV-TRAVEL1 재사용). 이동 구간·다음 예정지는 `DistanceRange`(거리·수단·추정)까지만.
- **도착 확정·방문 완료는 항상 사용자 탭** — 지오펜스는 프롬프트만(자동 기록 없음 D23). 위치 실패 시 수동 체크인이 기본 수단(ADR-0010).
- **자동 트리거는 제안만** — 배너/칩은 '대안 보기'를 눌러야 재계획 진입(자동 일정 변경 없음, INV-TRIG3). 심각=푸시·경미=인앱 칩.
- **재계획 결과는 current에만** 반영·plan 불변(D14). 확정 전 어떤 후보도 일정 미반영(확정 재검증 G56 통과 후에만).
- 위치 의존 UI는 **`shared/location` 3층 상태(G182)에 게이트**되며 전 조합에 폴백 존재(BR-U6-25 매트릭스). 지도 실패 시 목록/거리 요약 폴백.

### 5.2 컴포넌트 계층

```text
features/execution
├─ ExecutionNavigator                      — 실행 허브 스택('일정' 탭·홈 활성 카드 진입)
│  ├─ ActiveTripHubScreen
│  │  ├─ HubProgressHeader                 — 진행률(완료/진행 중/다음 G3)·D-day 맥락
│  │  ├─ TodayTimeline                     — 오늘 일정 슬롯(방문 상태 배지)
│  │  │  └─ VisitSlotRow                   — 슬롯(POI·시각·체류·방문 상태·현재/다음 하이라이트)
│  │  ├─ NextLegBar                        — 다음 예정지 거리(거리만 D25)·'외부 지도로 열기'·수동 새로고침(G65)
│  │  ├─ TriggerBannerHost                 — Plan-B 제안 배너/칩(SHOWN)·출처·감지 시각·'대안 보기'
│  │  └─ EndTripButton                     — '여행 종료' 수동 버튼(D19)
│  ├─ ArrivalPromptSheet                   — '도착하셨나요?'(지오펜스·자동 기록 없음 D23)
│  │  ├─ ConfirmArrivalButton              — '도착했어요'(사용자 탭 확정)
│  │  └─ DismissPromptButton               — 닫기(재프롬프트 억제)
│  ├─ VisitCheckControls                   — 방문 시작/완료/스킵/취소 액션+기록 진입점(사진·메모=U7)
│  │  ├─ CompleteVisitButton               — 방문 완료(실제 체류 측정)
│  │  ├─ SkipVisitButton / UndoVisitButton — 스킵·취소
│  │  └─ ManualArrivalButton               — 수동 도착(위치 무관 ADR-0010)
│  ├─ PlaceContextSheet                    — 현장 장소 상세(영업시간·예상 체류·주변 추천·여유 시간 G67)
│  │  ├─ OpeningHoursRow / StayEstimateRow — 영업시간·예상 체류(추정 표기·출처)
│  │  ├─ CrowdednessRow                    — 혼잡도 '미확인' 고정(G199)
│  │  ├─ SlackToNextRow                    — 다음 일정까지 여유(단순 차이·소요시간 없음 G67/D25)
│  │  └─ NearbyRecommendList               — 주변 추천(탭 → Plan-B 수동 재계획 G64)
│  ├─ ExternalMapHandoffSheet              — 설치 지도 앱 목록 시트(외부 위임 G66)
│  └─ EndTripConfirmDialog                 — 여행 종료 확인(수동 종료 → 회고 생성 트리거)
└─ (진입점) HomeActiveTripCard             — 홈 활성 일정 카드(U2 슬롯·허브로 수렴 — 데이터는 M18)

features/planb
├─ PlanbNavigator                          — Plan-B 스택(트리거 랜딩·재계획·휴식·경로 비교)
│  ├─ ReplanFlow
│  │  ├─ ReplanReasonPicker               — 사유 5종+'사유 없음'(수동) · 방식(AI에게 맡기기/직접 수정)
│  │  ├─ ReplanPositionInput              — 기준 위치(GPS 실패 시 지도 핀·검색·추정 출발지 표기 US-E7-10)
│  │  ├─ AlternativeCompareList           — 대안 후보 2~3개 비교 카드(추천 이유·거리·체류·여유 — 소요시간 없음)
│  │  ├─ AlternativeFallbackGuide         — 대안 0개 폴백 3종(1개 건너뛰기/휴식 전환/수동 수정)+사유 한 줄
│  │  ├─ BeforeAfterCompare               — 전/후 비교(추가·삭제·시간 이동 구분·지표 요약)
│  │  ├─ UnplacedConsentDialog            — 이월·제외 방문지 명시+확정 전 동의(C10)
│  │  ├─ ConfirmReplanButton              — 확정(확정 시점 재검증 G56 통과 후 current 반영)
│  │  ├─ KeepCurrentButton                — '기존 유지'(어떤 변경도 미저장)
│  │  └─ ManualEditFallback               — 수동 일정 수정(순서·삭제·시각 — 숙소 고정 위반 차단 US-E7-11)
│  ├─ TriggerBannerHost (features/execution와 공유 렌더 계약) — 배너/칩·심각/경미 구분
│  ├─ RestModeScreen
│  │  ├─ RestResumeInput                  — 재개 시각 입력 ∨ 즉시 재개
│  │  └─ ResumeRecalcPrompt               — 재개 시 남은 일정 재계산 제안(G159)
│  ├─ UnplacedListScreen                  — 미배치(이월) 목록·날짜 선택 재배치(C10)
│  ├─ SensitivitySettingControl           — 트리거 민감도 3단계(적게/보통/많이 G58 — 설정 연동 U8)
│  └─ PlanVsActualMapScreen (U3 shared/map·U5 map 재사용)
│     ├─ PlannedRouteLayer                — 계획 동선(흐리게)
│     ├─ ActualTrailLayer                 — 실제 GPS 발자취(점선·점·옵트인 게이트)
│     └─ TrailStatsBar                    — 누적 실제 거리·걸음 수(추정 표기 G59)
└─ shared/location                         — 위치 권한 3층 상태·포그라운드 수집(G182)
   ├─ LocationConsentState                — OS 권한 × 법정 동의 × GPS 옵트인 3층 상태(N2)
   ├─ GeofenceForegroundWatcher           — 포그라운드 지오펜스 진입 감지(백그라운드 미사용 G62)
   ├─ GpsTrailCollector                   — 포그라운드 저빈도(1~5분) 수집·단순화(옵트인 전제 D34)
   └─ LocationFallbackResolver            — 3층 조합별 동작 매트릭스 적용(BR-U6-25)
```

### 5.3 실행 허브 화면군 (features/execution)

**ActiveTripHubScreen (활성 일정 허브)** — props: `accountId` · state: 허브 데이터(오늘 일정·진행 상태·다음 예정지·여유·진행률), 트리거 배너 목록, 휴식 상태.
- 폼 검증(서버 규칙 대응): 진행 중 여행당 단일 허브로 수렴(홈 카드·일정 탭 단일 소스 INV-HUB1). 다음 예정지는 `NextLegBar`가 **거리만**("약 850m · 도보, 추정") — 소요시간 없음(BR-U6-30, INV-HUB2). 온라인 전제 — 실패 시 오류·재시도(오프라인 조회 미보장 D24). 상단 `TriggerBannerHost`는 자동 트리거 제안(제안만, '대안 보기' 필요 INV-TRIG3).
- 상호작용: `M18.getActiveHub` · `M18.getTripProgress` · `M9.getActiveTriggerBanners` · '여행 종료' → `EndTripConfirmDialog`.
- data-testid: `execution-hub-timeline`, `execution-hub-nextleg`, `execution-hub-progress`, `execution-hub-triggerbanner`, `execution-hub-endtrip`.
- 서버 능력: `M18.getActiveHub`, `M18.getTripProgress`, `M18.getNextLegDistance`, `M9.getActiveTriggerBanners`.

**ArrivalPromptSheet + VisitCheckControls (도착·방문 체크)** — props: `tripId`, `slotId` · state: 방문 상태, 프롬프트 노출/억제, 도착 방식(Prompt/Manual).
- 폼 검증: 지오펜스 진입 시 **'도착하셨나요?' 프롬프트만 — 자동 기록 없음**(BR-U6-01, INV-VISIT2). 도착 확정·완료는 **항상 사용자 탭**(D23). 위치 없음/저정확도면 프롬프트 미노출 — **수동 도착 경로 항상 제공**(BR-U6-02, ADR-0010). 닫기 시 재프롬프트 억제(BR-U6-04). 완료 시 실제 체류 측정(BR-U6-03). 스킵·취소 지원.
- 상호작용: `M18.onGeofenceEnter`(프롬프트) · `M18.confirmArrival(via)` · `M18.completeVisit`(→ VisitChecked·M12.checkVisit 위임) · `M18.skipVisit`/`M18.undoVisitAction`. 사진·메모 진입점은 U7(M12.attachMedia).
- data-testid: `execution-arrival-prompt`, `execution-arrival-confirm`, `execution-arrival-dismiss`, `execution-visit-complete`, `execution-visit-skip`, `execution-visit-manual`.
- 서버 능력: `M18.onGeofenceEnter`, `M18.confirmArrival`, `M18.completeVisit`, `M18.skipVisit`, `M18.undoVisitAction`, (U7)`M12.checkVisit`.

**PlaceContextSheet (현장 장소 상세)** — props: `tripId`, `slotId` · state: 장소 카드(영업시간·예상 체류·주변 추천·여유 시간).
- 폼 검증: 영업시간·예상 체류(추정 표기·출처)·주변 추천·여유 시간 표시. **여유 시간=다음 계획 시작 시각까지 단순 차이(이동시간 미반영)**(BR-U6-29, G67/D25). **혼잡도 '미확인' 고정**(G199), 누락 데이터 '미확인'. 주변 추천 탭 → Plan-B 수동 재계획(G64).
- 상호작용: `M18.getPlaceContext` · 주변 추천 탭 → `M10.startReplan`(수동 재계획 연결).
- data-testid: `execution-place-hours`, `execution-place-stay`, `execution-place-crowd`, `execution-place-slack`, `execution-place-nearby`.
- 서버 능력: `M18.getPlaceContext`, `M10.startReplan`(주변 추천 편입 경유).

**NextLegBar + ExternalMapHandoffSheet (다음 이동·외부 길찾기)** — props: `tripId`, `slotId` · state: 다음 예정지 거리, 외부 지도 앱 목록, 복귀 처리.
- 폼 검증: **거리만**(거리 기반 추정·추정 표기)·소요시간 미표시(BR-U6-30, D25). 화면 진입/포커스 1회 산출+수동 새로고침(G65). '외부 지도로 열기' → 설치 앱 시트(G66). **복귀 시 다음 예정지 근접이면 도착 확인 프롬프트**(BR-U6-31·04). 외부 앱 없음 → 웹 지도 → 거리 요약 폴백(소요시간 없음).
- 상호작용: `M18.getNextLegDistance`(거리만) · `M18.buildExternalMapHandoff`(좌표 위임) · `M18.handleExternalMapReturn`(복귀→도착 프롬프트).
- data-testid: `execution-nextleg-distance`, `execution-nextleg-refresh`, `execution-nextleg-openmap`, `execution-nextleg-return`.
- 서버 능력: `M18.getNextLegDistance`, `M18.buildExternalMapHandoff`, `M18.handleExternalMapReturn`.

**EndTripConfirmDialog (여행 종료)** — props: `tripId` · state: 종료 확인.
- 폼 검증: 수동 '여행 종료' 버튼 → 종료 전이(자동 익일 00:00과 병행 단일 규칙 D19). 종료 = 회고 자동 생성 트리거(자동/수동 경합 멱등 INV-EXEC1). 숙소 유무 무관.
- 상호작용: `M18.endTripManually`(→ TripEnded·M13 회고).
- data-testid: `execution-endtrip-confirm`, `execution-endtrip-cancel`.
- 서버 능력: `M18.endTripManually`.

### 5.4 Plan-B 화면군 (features/planb)

**ReplanFlow (재계획 — 사유·기준·후보 비교·전후·확정)** — props: `tripId`, `triggerRef?`(자동 진입 시) · state: 세션(사유·방식·기준 위치·후보·비교·확정), 폴백 상태.
- 폼 검증:
  - 진입: '여행 중' 게이트(숙소 0개 허용 BR-U6-15). 사유 5종+'사유 없음', 방식 **AI에게 맡기기/직접 수정**(직접 수정=수동 편집 직행 US-E7-12).
  - 기준 위치: GPS 실패 시 `ReplanPositionInput`(핀·검색·**추정 출발지 표기** BR-U6-26). 생략 시 최후 완료 방문지/숙소(가정 명시).
  - 후보: `AlternativeCompareList` 2~3개 — 추천 이유·거리·수단·체류·여유(소요시간 없음 BR-U6-17·20, INV-ALT2). 솔버 통과분만.
  - 0건 폴백: `AlternativeFallbackGuide` 3종(1개 건너뛰기/휴식 전환/수동 수정)+사유 한 줄(BR-U6-18).
  - 전후 비교: `BeforeAfterCompare`(추가/삭제/시간 이동 구분·지표 요약 — 총 이동 거리·방문지 수·숙소 복귀 시각 증감, 소요시간 없음 BR-U6-20). 이월 방문지 `UnplacedConsentDialog`(확정 전 동의 C10).
  - 확정: **확정 시점 재검증(G56)** 통과 후 current 반영(plan 불변 D14, BR-U6-21). 무효화 시 재산출 안내. '기존 유지' → 미저장.
  - 수동 편집 폴백: `ManualEditFallback`(순서·삭제·시각 — **숙소 고정 위반 차단** BR-U6-19, US-E7-11).
- 상호작용: `M10.startReplan` · `M10.setManualPosition` · `M10.getAlternatives` · `M10.previewAlternative` · `M10.confirmAlternative`(G56 재검증) · `M10.keepCurrentPlan` · `M10.applyManualEdit`.
- data-testid: `execution-replan-reason`, `execution-replan-method`, `execution-replan-position`, `execution-replan-candidate`, `execution-replan-fallback`, `execution-replan-compare`, `execution-replan-unplaced`, `execution-replan-confirm`, `execution-replan-keep`, `execution-replan-manualedit`.
- 서버 능력: `M10.startReplan`, `M10.setManualPosition`, `M10.getAlternatives`, `M10.previewAlternative`, `M10.confirmAlternative`, `M10.keepCurrentPlan`, `M10.applyManualEdit`, (U7)`M12.appendChangeLog`.

**TriggerBannerHost (자동 트리거 제안 랜딩)** — props: `tripId` · state: 활성 배너/칩(유형·영향 일정·출처·감지 시각), 심각/경미 구분.
- 폼 검증: 비차단 배너/칩 — **제안일 뿐, '대안 보기'를 눌러야 재계획 시작**(자동 변경 없음 INV-TRIG3). 심각=푸시 랜딩·경미=인앱 칩(BR-U6-13). **출처·감지 시각 표기**. 닫기 시 재노출 억제(2회 무시→당일 억제 BR-U6-13). 외부 데이터 없으면 배너 미노출(허위 알림 금지 BR-U6-14).
- 상호작용: `M9.getActiveTriggerBanners` · `M9.dismissTrigger` · '대안 보기' → `ReplanFlow`(triggerRef 전달).
- data-testid: `execution-trigger-banner`, `execution-trigger-source`, `execution-trigger-seealternatives`, `execution-trigger-dismiss`.
- 서버 능력: `M9.getActiveTriggerBanners`, `M9.dismissTrigger`, `M9.getSuppressionState`.

**RestModeScreen (휴식 모드)** — props: `tripId` · state: 재개 시각, 억제 상태.
- 폼 검증: 휴식 진입 시 **경미 트리거·일정 알림 억제, 심각 사유만 유지**(BR-U6-23, INV-REST1). 재개 시각 입력 ∨ 즉시 재개. **재개 시 남은 일정 재계산 제안**(`ResumeRecalcPrompt` — 자동 재계획 아님 BR-U6-24).
- 상호작용: `M10.enterRestMode(resumeAt?)` · `M10.resumeFromRest`(→ 재계산 제안) · `M9.getSuppressionState`.
- data-testid: `execution-rest-resumeinput`, `execution-rest-resumenow`, `execution-rest-recalcprompt`.
- 서버 능력: `M10.enterRestMode`, `M10.resumeFromRest`, `M9.getSuppressionState`.

**PlanVsActualMapScreen (계획 vs 실제 경로 — U3/U5 map 재사용)** — props: `tripId`, `date` · state: 계획 동선·실제 발자취 레이어, 누적 거리·걸음 수, 옵트인/권한 상태.
- 폼 검증: 계획 동선(흐리게)+실제 GPS 발자취(점선·점) 함께/토글(BR-U6-28). **누적 실제 거리·걸음 수 추정 표기**(걸음 수=거리 환산 G59). **옵트인/권한 없으면 실제 레이어 비활성화+사유 표기**(계획 동선만 BR-U6-25 매트릭스). 지도 실패 시 방문 목록 폴백.
- 상호작용: `M12.getRouteComparison`(계획·실제·거리·걸음) · `CentroidMapView`/순서 핀은 U3 `shared/map`·U5 map 재사용.
- data-testid: `execution-route-planned`, `execution-route-actual`, `execution-route-stats`, `execution-route-disabled`.
- 서버 능력: (U7)`M12.getRouteComparison`, (U3)`shared/map` 브리지.

**UnplacedListScreen (이월 미배치 목록)** — props: `tripId` · state: 이월 방문지 목록, 날짜 선택.
- 폼 검증: 당일 잔여 재정렬로 이월된 방문지 목록(C10). 사용자가 날짜 선택 시 해당 일 재계산 세션 시작(BR-U6-22).
- 상호작용: `M10.getUnplacedPois` · `M10.rescheduleUnplaced(targetDate)`.
- data-testid: `execution-unplaced-list`, `execution-unplaced-reschedule`.
- 서버 능력: `M10.getUnplacedPois`, `M10.rescheduleUnplaced`.

### 5.5 shared/location — 위치 권한 3층 상태·포그라운드 수집 (U6 신규, G182)

- 책임: 위치 동의 **3층(① OS 권한 × ② 위치기반서비스 법정 동의 × ③ GPS 기록 옵트인)** 상태를 관리하고, 조합별 기능 동작 매트릭스(BR-U6-25)를 클라이언트에서 적용한다. 포그라운드 지오펜스 감지·GPS 저빈도 수집을 담당하되 **판정 정본은 서버**(도착=사용자 탭·트리거=서버 M9). 수집 로직·SDK 브리지는 NFR/Code Generation 소유, 본 문서는 계층 계약만 규정한다.
- props: `LocationConsentState{ osPermission, legalConsent, gpsOptIn }` · state: 3층 상태, 포그라운드 활성 여부, GPS 정확도.
- 상호작용·폴백:
  - `GeofenceForegroundWatcher`: 포그라운드 지오펜스 진입 → `M18.onGeofenceEnter`(프롬프트만). **백그라운드 위치 미사용**(G62). 저정확도/권한 없음 → 감지 생략(수동 체크인).
  - `GpsTrailCollector`: **GPS 옵트인 전제**(미동의 미수집 INV-GPS1) 포그라운드 저빈도(1~5분) 수집·단순화 → `M12.appendGpsTrack`(원시 파기 후 폴리라인만). 철회 시 즉시 중단·`M12.purgeLocationData`.
  - `LocationFallbackResolver`: 3층 조합별 동작 매트릭스 적용(BR-U6-25) — 권한 거부→재계획 수동 위치 입력(US-E7-10)·옵트인 거부→발자취 레이어 disabled. 전 조합 폴백 존재.
  - 위치 just-in-time 발화 2번째 지점(여행 중 첫 진입 — US-E1-04 연동, [U1 기반](./u1-foundation.md) 프리프롬프트 프레임 재사용).
- data-testid: `execution-location-consent`, `execution-location-fallback`, `execution-location-geofence`.
- 서버 능력: `M18.onGeofenceEnter`, (U7)`M12.appendGpsTrack`, (U7)`M12.purgeLocationData`, (U1)위치 동의 증적.

### 5.6 shared/ 재사용·U6 완성분

| 계층 | U6 범위 | 근거 |
|---|---|---|
| shared/map (U3 소유) | **재사용** — 계획 vs 실제 경로 지도·순서 핀·이동 동선·발자취 레이어(카카오 브리지). U6는 신규 지도 브리지 미생성 | components §6.1, U3 shared/map, FD-U6-09 |
| U5 일정 지도 뷰 | **재사용** — 순서 핀·계획 동선 렌더(재계획 전후 비교·경로 비교) | U5 frontend-components MapView |
| shared/location | **신규** — 위치 3층 상태·포그라운드 지오펜스·GPS 수집·폴백 매트릭스 | G182, N2, D34, G62 |
| shared/api | 트리거 배너 스트림·폴백 고지(허위 알림 금지)·재계획 10초 진행·오프라인 조회 미보장 오류 안내 | ADR-0011, D38, D24 |
| shared/ui | 거리·'추정' 표기·'미확인' 표기·전후 비교 diff 시각화·심각/경미 배너 | D25, G199, PRD 07-8 |

### 5.7 화면-스토리-서버 능력 추적 매트릭스

| 컴포넌트 | 스토리 | 서버 능력(M18·M9·M10·M11·M12) |
|---|---|---|
| ActiveTripHubScreen | US-E2-02·03, US-E5-08, US-E6-03 | M18.getActiveHub · getTripProgress · getNextLegDistance · M9.getActiveTriggerBanners |
| ArrivalPromptSheet + VisitCheckControls | US-E6-01, US-E8-01 | M18.onGeofenceEnter · confirmArrival · completeVisit · skipVisit · undoVisitAction · (U7)M12.checkVisit |
| PlaceContextSheet | US-E6-02 | M18.getPlaceContext · M10.startReplan(주변 추천 편입) |
| NextLegBar + ExternalMapHandoffSheet | US-E6-03 | M18.getNextLegDistance · buildExternalMapHandoff · handleExternalMapReturn |
| EndTripConfirmDialog | US-E7-01, US-E8-08 | M18.endTripManually |
| TriggerBannerHost | US-E7-02 | M9.getActiveTriggerBanners · dismissTrigger · getSuppressionState · updateSensitivity |
| ReplanFlow | US-E7-01·03·04·05·07·08·09·10·11·12 | M10.startReplan · setManualPosition · getAlternatives · previewAlternative · confirmAlternative · keepCurrentPlan · applyManualEdit · (U7)M12.appendChangeLog |
| RestModeScreen | US-E7-06 | M10.enterRestMode · resumeFromRest |
| PlanVsActualMapScreen | US-E7-13 | (U7)M12.getRouteComparison · (U3)shared/map |
| UnplacedListScreen | US-E7-07 | M10.getUnplacedPois · rescheduleUnplaced |
| shared/location | US-E1-04, US-E6-01, US-E7-10·13 | M18.onGeofenceEnter · (U7)M12.appendGpsTrack · purgeLocationData |

---

## 6. NFR (요구·설계 패턴·기술 스택)

시스템 전역 NFR 정본은 [NFR 기준](../nfr.md)이다. 본 절은 그 정본을 U6 관점으로 전개하되, U6가 **실시간성(재계획 10초)·외부 의존(기상청)·배터리/위치·서버 배치 폴링이 핵심인 유닛**이므로 인프라·플랫폼 결정은 전역 정본 상속(재정의 금지), 재계획 연산은 [U5](./u5-itinerary.md) C1·C2 재사용(신규 없음), 유닛 증분(서버 폴링·트리거 침묵·포그라운드 지오펜스·위치 3층 폴백·GPS 법정 로그)은 충실히 확정한다. 추적 ID: 요구 `NFR-U6-xx`, 패턴 `PAT-U6-xx`, 스택 `U6-Wx·U6-Px·U6-Cx`.

### 6.1 U6 NFR 프로필 — 세 축

U6의 NFR 본질은 **현장 변수(날씨·휴무·지연·체류초과)에 10초 내 유효한 대안으로 대응하되, 허위 알림을 만들지 않고, 포그라운드·저전력·법정 동의 안에서 위치를 다루는 것**이다. 세 축이 핵심이고 서로 긴장한다.

1. **실시간성/성능(핵심)** — D38의 Plan-B 대안 제시 10초를 services.md §S2.4 단계 예산으로 분해하고, 예산 초과가 예상되는 LLM(사유 해석)은 타임아웃을 예산보다 짧게(1.5초) 잡아 폴백 전환 시간을 확보한다. 도착 감지 반응·거리 갱신 등 현장 상호작용 체감을 함께 지킨다.
2. **복원력(핵심)** — 외부·비결정 의존(기상청·지도)은 전부 폴백 필수. 기상청 무응답 → 트리거 침묵(허위 알림 금지 D27), 재계획 외부 API 실패 → 수동 수정 폴백, 위치 불가 → 수동 입력. 어떤 경로도 여행 중 사용자를 막다른 길에 두지 않는다(ADR-0011). 재계획 대안 산출은 C1·C2(U5 자산) 재사용 — LLM/외부에 인질 잡히지 않는다.
3. **위치·배터리·프라이버시(핵심)** — 위치 감지는 포그라운드 한정(D27·G62 — 백그라운드 위치 권한 미요청), GPS 발자취는 별도 옵트인(D34·N2) 전제 저빈도(1~5분) 수집·원시 좌표 파기, 서버 폴링 주기는 원격 구성 상한(G195), 위치 처리는 3층 동의 매트릭스(G182)를 벗어나지 않는다.

보안·무상태·관측성·배포의 서버 규약은 **U1 전역 정본 상속**, 재계획 연산(C1·C2)은 **U5 정본 재사용**, U6는 **서버 폴링·클라 포그라운드 감지·위치 3층 폴백·GPS 법정 로그** 증분만 소유한다.

### 6.2 워크로드 중요도

| 컴포넌트 | 중요도 | 불가용 시 영향·U6 대응 |
|---|---|---|
| 실행 허브 상태 저장·조회(M18 저장부·DB) | **Critical** | 여행 중 활성 일정·방문 상태 접근 불가 — 현장 피해 최대. RDS Multi-AZ·Auth 상속(폴백 없음, 오류·재시도) |
| Plan-B 감지(M9) | **High** | 여행 중 선제 대응 불가 — **수동 재계획 경로 항상 유지**. 자동 감지 축소를 화면 표기 |
| Plan-B 재계획(M10) | **High** | 대안 산출 불가 — **수동 일정 수정 폴백 존재**(US-E7-11·12). C1·C2는 U5 재사용(폴백 체인 상속) |
| 날씨·컨텍스트(M11 기상청 소비) | **Medium 이하** | 트리거 (a) 계열(강수·특보) 미발화 — **트리거 침묵**. 나머지 트리거·수동 경로 정상 |

핵심 원칙: 외부·비결정 의존(기상청·지도·LLM)은 전부 폴백 필수 경로이며, M9·M10이 High인 근거는 **수동 폴백이 존재**한다는 점이다 — 자동 대응이 죽어도 사용자는 수동 재계획·수동 수정으로 일정을 이어갈 수 있다.

### 6.3 성능·실시간성 (D38, services.md §S2.4)

> 경계 명시 — AI 일정 생성(S1) 5초/20초는 U6 아님: "AI 일정 생성 첫 1일 5초/전체 20초"는 M8 소유로 U5 범위. U6는 재계획(S2)만 소유하며 C1·C2를 재사용하되, U5의 5초/20초 예산·생성 트리거는 U5 NFR이 소유한다.

**재계획 10초 예산 — 단계 예산 (services.md §S2.4 상속·승격)**

| 단계 | 예산 | 타임아웃·폴백(타임아웃<예산 원칙) | 추적 |
|---|---|---|---|
| 5~6. 세션 생성 + 영향 분석 입력 수집 | **1.0초** | 위치 수동 입력 시간은 예산 외(사용자 상호작용). 위치 폴백 체인은 §6.4 | S2.2, US-E7-03·10 |
| 7. **LLM 사유 해석(C1 — 경량 티어, U5 재사용)** | **1.5초** | **타임아웃 1.5초 — 초과 즉시 규칙 기반 사유-카테고리 매핑 폴백**(추천 이유 템플릿/생략) | US-E7-01·04·05 |
| 8. 후보 소싱(M7 — **사용자 저장 장소 우선** G53) | **1.5초** | 저장 장소 우선이라 대부분 내부 조회. 부족 시 주변 신규 POI 확장 | G53, US-E7-04 |
| 9. 후보별 솔버 검증·재정렬(C2 — 2~3개, 당일 잔여만 C10) | **4.5초** | 후보당 1.5초. 유효 후보 0건→3중 폴백 · 외부 API 오류→수동 수정 | US-E7-04·07·11 |
| 10. 비교 지표 산출 + 응답 | **0.5초** | 총 이동 거리·방문지 수·숙소 복귀 시각 증감(소요시간 미표시 D25) | US-E7-08 |
| **합계** | **9.0초** (여유 1.0초) | 초과 시 산출된 후보만 제시, 0건이면 3중 폴백 | **D38** |
| 11. 확정 재검증(C2 `validate` 1회 G56) | **1.0초** | **별도 상호작용 — 10초 예산 외**. 무효화 시 후보 재산출 안내(확정 차단) | US-E7-08 |

- **NFR-U6-PERF-01 (재계획 10초 게이트)**: '대안 보기'를 누른 시점부터 **대안 후보 2~3개 + 전/후 비교를 10초 내 제시**. 10초는 하드 게이트가 아니라 체감 목표이며, 초과 시에도 산출된 후보만이라도 제시하거나 수동 수정 폴백을 제안한다(빈 화면 금지).
- **NFR-U6-PERF-02 (LLM 타임아웃 1.5초 < 예산)**: 재계획 사유 해석 단계는 타임아웃 1.5초로, 10초 예산 안에 규칙 매핑 폴백·후보 소싱·솔버 검증까지 완주할 여유를 남긴다. 타임아웃은 예산이 아니라 폴백 전환 트리거. C1은 U5 게이트웨이 재사용(경량 티어).
- **NFR-U6-PERF-03 (솔버 검증 시간 예산)**: 후보별 C2 검증·재정렬은 후보당 1.5초(2~3개=4.5초). 재정렬 범위가 당일 잔여만(C10)이라 문제 크기가 작아 예산 내 완료. C2는 U5 솔버 재사용(warm-start·오라클 검증 상속).
- **NFR-U6-PERF-04 (확정 재검증은 예산 외)**: 확정 버튼 시점 재검증(G56)은 10초 예산 외 별도 상호작용이다 — 무효화되면 확정 차단·후보 재산출 안내.
- **NFR-U6-PERF-05 (도착 감지 반응)**: 포그라운드 지오펜스 진입 감지 시 '도착하셨나요?' 프롬프트를 지체 없이 노출 — 단 도착 확정·방문 완료는 항상 사용자 탭(자동 확정 없음 D23). 지오펜스 평가는 클라이언트 로컬 연산(무네트워크·체감 즉시). 외부 지도 앱 복귀 시 다음 예정지 근접이면 도착 프롬프트 재노출.
- **NFR-U6-PERF-06 (거리 갱신 정책)**: 다음 예정지 직선거리는 화면 진입/포커스 시 1회 산출 + 수동 새로고침(G65 — 상시 폴링 아님, 배터리·비용 절감). 거리 기반 추정 표기·소요시간 미표시(D25). 여유 시간은 다음 계획 시작 시각까지 단순 차이(G67).
- **NFR-U6-PERF-07 (일반 화면 전환 300ms)**: 활성 허브·방문 전이·비교 카드 전환은 로컬 상태 전환. 지도 렌더는 U3 `shared/map` 상속(지연 로드·실패 시 목록 폴백).

### 6.4 복원력 (§6.2·§6.3, RESILIENCY-10, ADR-0011 — 침묵 실패 금지)

**트리거 침묵 — 기상청·휴무 무응답 (services.md §S2.1, D27)**

| 의존 단계 | 실패 시 폴백 | 사용자 고지 |
|---|---|---|
| **기상청(M11 — 단기예보·특보)** | **트리거 침묵** — 트리거 (a) 계열(강수·특보)만 자동 발화 중지, 마지막 성공 데이터 TTL 내 사용 후 침묵 | **없음**(허위 알림 금지) — 수동 재계획 경로 항상 유지 |
| **휴무·영업시간(M7 — J2 재조회)** | 해당 POI 스킵 + 로깅, 트리거 침묵(정기 변경만 자동 G192) | 없음 |

- **NFR-U6-RES-01 (기상청 무응답 = 트리거 침묵, 허위 알림 금지)**: 기상청·영업시간 소스 무응답 시 자동 알림을 발화하지 않는다. 트리거 (a) 계열만 일시 중지하고 나머지 트리거(위치 의존 (c)(d))·수동 재계획은 정상 동작. 폴링 실패는 실패율로 계측("알림 침묵"은 관측되지만 사용자에게는 조용). 특보는 보수적으로 심각 분류하되 무응답 시엔 침묵이 우선.
- **NFR-U6-RES-02 (마지막 성공 데이터 TTL 사용)**: 폴링 실패 시 마지막 성공 날씨 데이터를 TTL 내 사용 후 만료되면 침묵으로 전환 — 오래된 데이터로 발화하지 않는다.

**재계획 외부 실패 · 위치 불가 폴백 (services.md §S2.2)**

| 의존 단계 | 실패 시 폴백 | 사용자 고지 |
|---|---|---|
| LLM 사유 해석(C1 — U5 재사용) | 규칙 기반 사유-카테고리 매핑, 추천 이유 템플릿/생략 | "추천 이유를 불러오지 못했어요" |
| 재계획 외부 API(길찾기·POI 검색·영업시간) | **수동 일정 수정 화면 전환** — 순서 재배열·삭제·시각 직접 입력 | 누락된 외부 데이터 화면 표기, 숙소 고정 제약 위반 입력 차단 |
| 솔버 유효 후보 0건(C2 — U5 재사용) | **3중 폴백** — 남은 방문지 1개 건너뛰기 / 휴식 모드 전환 / 수동 일정 수정 | 대안 없는 이유 한 줄 설명 |
| 위치(GPS 불가·권한 거부) | 위치 폴백 체인 — 수동 입력→마지막 완료 방문지→등록 숙소 | 가정을 화면 표기(추정 출발지) |

- **NFR-U6-RES-03 (재계획 외부 API 실패 = 수동 수정 폴백)**: 재계획 중 외부 API 오류(날씨·영업시간·길찾기·POI 검색 실패/시간 초과) 시 수동 일정 수정 화면으로 전환. 수동 수정 중에도 등록 숙소 체크인/체크아웃 고정 제약은 위반 불가(입력 차단), 누락 데이터 화면 표기, API 복구 시 자동 검증·재계획 재활성화.
- **NFR-U6-RES-04 (유효 후보 0건 = 3중 폴백)**: 솔버가 대안 0개를 산출하면 빈 화면 대신 3중 폴백 + 사유 한 줄. C2 솔버·오라클 검증은 U5 재사용.
- **NFR-U6-RES-05 (기존 유지 = 무변경)**: "기존 유지" 선택 시 어떤 변경도 저장하지 않고 활성 일정으로 복귀. current 갱신은 확정 TX(11단계)에서만 발생.
- **NFR-U6-RES-06 (위치 불가 = 수동 입력 폴백)**: 위치 권한 거부·GPS 불가 감지 시 재계획을 차단하지 않고 즉시 수동 위치 입력(지도 핀·검색)으로 안내. 폴백 체인: **GPS → 수동 입력 → 마지막 완료 방문지 → 등록 숙소**, 어느 폴백이든 가정을 화면 표기. 도착 감지도 위치 불가 시 수동 체크인으로 대체.
- **NFR-U6-RES-07 (3층 조합 전부 폴백 존재)**: OS 권한 × 법정 동의 × GPS 옵트인 3층(G182)의 전 조합에 폴백이 존재 — 권한 거부→수동 도착 확인·위치 수동 입력, 옵트인 거부→발자취 미수집(비교 화면은 계획 동선만·사유 표기). 조합별 동작 매트릭스는 §3.F BR-U6-25에 명문화하고 테이블 주도 테스트로 구현.

**어댑터 4요소 계약 (RESILIENCY-10 — U1·U5 상속)**

| 의존 (Port · 소유) | 타임아웃 | 재시도 | 서킷 | 폴백 |
|---|---|---|---|---|
| **기상청**(`WeatherPort` · M11) | 어댑터 타임아웃 | 즉시 1회(services.md J1) | 독립 서킷 | 마지막 성공 TTL 후 **트리거 침묵** |
| **LLM 사유 해석**(`LlmPort` · C1 — U5 재사용) | 1.5초 | 스키마 위반 1회 | 벤더 독립 | 규칙 기반 사유 매핑 |
| **이동시간**(`RoadDistancePort` · C2 — U5 재사용) | 어댑터 | 없음 | 독립 | 직선거리×우회계수(G106) |

- **NFR-U6-RES-08 (서킷·계측 의무)**: 기상청 어댑터는 명시적 타임아웃 + 독립 서킷(벌크헤드) + 폴백을 가진다(Resilience4j — U5·U3 확정분 재사용). 서킷 open/half-open·기상청 오류·트리거 침묵 전환은 전부 계측(A12·A11). C1·C2 어댑터는 U5 정본(NFR-U5-RES-06) 재사용 — U6은 재계획 소비자.

### 6.5 위치·배터리·프라이버시 (D27·D34·N2·G182·G195)

- **NFR-U6-PRIV-01 (포그라운드 한정 — 백그라운드 위치 미요청)**: 위치 감지(지오펜스 도착·이동 지연·체류 초과)는 포그라운드 한정이며 백그라운드 위치 권한을 요청하지 않는다(D27·G62). 커버리지 한계(백그라운드 미발화)는 제품 동작으로 수용 — 앱 재진입 시 일괄 재평가하고, 서버 폴링 계열(날씨·휴무)은 포그라운드와 독립 동작.
- **NFR-U6-PRIV-02 (배터리 예산 — 저빈도 수집)**: GPS 발자취는 포그라운드 한정 저빈도 수집(1~5분 간격)이며 상시 고빈도 추적을 하지 않는다(G55/G73). 지오펜스·거리 산출도 상시 폴링이 아니라 이벤트/포커스 기반 — 배터리 소모를 구조적으로 억제. 걸음 수는 GPS 이동 거리 환산 추정만(추가 권한 없음 G59).
- **NFR-U6-PRIV-03 (위치 just-in-time 발화)**: 위치 권한 OS 다이얼로그는 여행 중 첫 진입 시점에 발화(US-E1-04 just-in-time 2번째 지점) — 프리프롬프트(사유 고지) 후 요청. 백그라운드 위치는 발화하지 않는다.
- **NFR-U6-PRIV-04 (폴링 주기 상한 원격 구성)**: 서버 배치 폴링은 날씨 1시간·휴무 당일 아침 1회를 초기값으로 하되 전부 원격 구성(G195) — 운영 중 주기·상한을 코드 재배포 없이 조정(비용·쿼터 보호). 트리거 빈도 상한(시간당 2회/하루 8회)·민감도 3단계·무시 억제도 원격 구성(G58/G195).
- **NFR-U6-PRIV-05 (GPS 옵트인 전제 수집)**: GPS 발자취는 GPS 기록 옵트인(3층 동의의 3층, N2) 동의를 전제로만 수집한다(D34) — 옵트인 없이는 수집하지 않는다. 옵트인 철회·탈퇴 시 즉시 파기(유예 없음).
- **NFR-U6-PRIV-06 (원시 좌표 파기 · 단순화 폴리라인만 보존)**: 원시 GPS 좌표는 단순화 폴리라인으로 가공 후 파기하고 원시 좌표는 보존하지 않는다(G55/G73). 서버에는 단순화 폴리라인만 저장 — 위상은 보존하되 원시 재구성은 불가(PBT 대상).

### 6.6 트리거 상한·억제 (§7.3 G58/G195 · 순수 함수 G116)

- **NFR-U6-QOS-01 (트리거 빈도 상한)**: 자동 트리거는 전역 상한 시간당 2회/하루 8회(초과·동시 발화는 묶어 1회)를 지킨다(G58/G195). 동일 사유·동일 방문지는 1회만 노출하고, 닫으면 재노출하지 않는다. 상한은 원격 구성(G195).
- **NFR-U6-QOS-02 (민감도·무시 억제 학습)**: 민감도 3단계(적게/보통/많이)가 상한을 ±50% 조정하고, 사용자가 2회 연속 무시하면 당일 동일 사유를 억제(학습, G58). 휴식 모드 중에는 경미 사유 억제, 심각 사유(기상특보·고정 일정 위협)만 유지(G54 — 심각은 억제 불가).
- **NFR-U6-QOS-03 (판정 순수 함수 분리 — G116)**: 트리거 판정 로직은 clock·외부 데이터(날씨·체류)를 주입 가능한 순수 함수로 분리해 결정적 테스트가 가능하게 한다 — 상한·억제·민감도 시뮬레이션을 재현 가능한 PBT로 검증(U6-P3·P4).
- **NFR-U6-QOS-04 (심각/경미 2단 · 푸시 경계)**: 트리거는 severity 2단(severe·minor)으로 구분 — 심각만 푸시(M14 소비), 경미는 인앱 칩. 알림에 출처·감지 시각 표기. **U6은 TriggerFired 발행까지**이며 실제 푸시 발송은 M14([U8](./u8-notification.md)) 소관.

### 6.7 보안 (Security Baseline 상속 — 위치정보법 증분)

전역 보안 설정(deny-by-default·헤더·에러 핸들러·구조화 로깅·시크릿)은 U1 스캐폴드가 소유하고 U6는 상속한다. U6 증분은 **위치정보 법정 로그·GPS 데이터 처리·소유권** 세 지점이다.

- **NFR-U6-SEC-01 (위치정보 법정 로그 = U1 append-only 재사용)**: 위치정보 수집·이용·제공 사실확인자료(로그)는 U1이 생성한 append-only 법정 로그 테이블에 기록한다(N2·SECURITY-14) — U6은 이 테이블의 **첫 기록 개시 유닛**이다. GPS 이벤트와 동일 트랜잭션 기록(유실 0). 앱 역할은 자기 로그 삭제 권한 없음(DB REVOKE + IAM Deny 2중 강제). 최소 6개월 보존, 계정 삭제 시에도 법정 로그는 분리 보관 유지.
- **NFR-U6-SEC-02 (위치정보법 준수 — P1 법정 전제)**: GPS 발자취·위치 기반 트리거는 위치기반서비스사업 신고(P1) 완료를 법정 전제로 한다 — 신고 완료 전 해당 기능 비활성 플래그 운영. 위치기반서비스 약관 별도 필수 동의·GPS 기록 별도 옵트인(3층 동의 G182)은 U1 동의 체계 상속.
- **NFR-U6-SEC-03 (GPS 데이터 로그 마스킹 · 경계)**: 위치 데이터를 다루는 어댑터·서비스 로그는 PII·정밀 좌표를 마스킹(U1 PAT-OBS-01 상속·SECURITY-03) — 구조화 로그·상관 ID에 원시 좌표 미출현. 법정 로그(수집 사실)와 운영 로그(디버깅)를 분리.
- **NFR-U6-SEC-04 (소유권 — IDOR 차단)**: 실행 상태·트리거·재계획 세션·GPS 폴리라인 접근은 토큰 주체(accountId) 스코핑(IDOR 차단, SECURITY-08). 재계획은 확정 시점 소유권 재검증.
- **NFR-U6-SEC-05 (기상청 API 키 = 시크릿)**: 기상청 API 키는 소스·이미지·설정 파일에 미포함 — Secrets Manager 주입(`external/kma`). 시크릿 스캔 CI 게이트(SECURITY-10).
- **NFR-U6-SEC-06 (LLM 경계 = U5 재사용)**: 재계획 사유 해석의 LLM 컨텍스트 경계(서버 재조회 D31·closed-set 그라운딩 G115·필드 최소화)는 U5 정본(NFR-U5-SEC-01·02) 재사용 — U6는 소비자이며 신규 LLM 경계를 만들지 않는다.

### 6.8 하드 제약·PBT 요건 (D37 · §6.6)

- **NFR-U6-QUAL-01 (하드 제약 4계열 100% — 재계획 재검증, D37 머지 차단)**: 재계획 결과도 생성과 동일한 하드 제약 4계열 검증 100%(C2 재사용) — 특히 고정 블록·확정 시각 필수 방문지 불변, 확정 시점 재검증(G56) 통과 없이 반영 불가. LLM·기상청은 어댑터 fake 모킹, 솔버·제약 검증은 실코드.
- **NFR-U6-QUAL-02 (PBT 대상 — G116)**: (a) 트리거 판정 순수 함수(상한 초과 발화 0·무시 2회 후 당일 동일 사유 억제·민감도 단조성), (b) 방문 상태 머신 전이 불변식, (c) 여행 실행 상태 머신(활성↔휴식→종료 — 자동/수동 종료 경합 안전), (d) 재계획 warm-start 고정 블록 보존, (e) 휴식 모드 억제 규칙(심각 사유는 억제 불가), (f) 폴리라인 단순화(원시 파기 후 재구성 불가·경로 위상 보존). Kotest(서버)·fast-check(클라)·시드 로깅·수축. 속성 식별은 §4.6(PBT-01).
- **NFR-U6-QUAL-03 (E2E 종단 흐름 완성 — G118)**: 숙소 저장→등록→일정 생성→재계획 E2E를 U6 완료 시점에 CI 필수로 완성(D37 계층 분리 — 외부는 fake). CP3(소비자)·CP4(공급자 — VisitChecked·TripEnded·DayClosed·changelog diff)·CP5(TriggerFired) 계약 테스트 통과.

### 6.9 규모·확장성 (§6.8 G142 — DAU 1천 · 활성 여행 ≤1/사용자)

- **NFR-U6-SC-01 (서버 폴링 대상 = 진행 중 여행 수 — 과설계 금지)**: 서버 배치 폴링(J1 날씨·J2 휴무)의 대상은 진행 중 여행이다. 여행 날짜 겹침 차단(D21)으로 사용자당 활성 여행 ≤1이며, DAU 1천에서 진행 중 여행 수는 소량이다 — 별도 폴링 워커·큐·오토스케일 상향은 과설계(G142). 기존 ShedLock 스케줄러 내에서 흡수. 전환 트리거: 폴링 대상·기상청 호출량이 태스크·쿼터를 상시 압박하면 EventBridge + ECS RunTask 분리 재평가.
- **NFR-U6-SC-02 (기상청 호출 격자 중복 제거)**: 날씨 폴링은 방문 예정지 좌표를 격자로 변환 후 중복 제거해 호출한다 — 인접 방문지는 동일 격자로 묶여 호출량 억제. 트리거 상한(G58)이 중복 발화를 흡수(J1 멱등성). 폴링 주기 상한은 원격 구성(G195).
- **NFR-U6-SC-03 (데이터 볼륨)**: U6 신규 테이블 ~8~9개. DAU 1천·활성 여행 ≤1 기준 소량 — 단일 PostgreSQL로 충분(샤딩 불요). GPS 폴리라인·법정 로그는 append 성격이나 저빈도(1~5분)·활성 여행 소량이라 일 수만 행 수준.
- **NFR-U6-SC-04 (폴링/배치 커넥션 벌크헤드)**: 폴링·배치 잡의 DB 커넥션 풀은 실행 허브 API 처리 풀과 분리(U1 PAT-PERF-02 벌크헤드 상속) — 배치가 여행 중 실시간 요청 지연을 유발하지 않게 한다.

### 6.10 기술 스택 결정

스택 대분류(RN Expo + Spring Boot Kotlin + PostgreSQL, D02)와 서버·클라이언트 라이브러리 정본(U1 S-1~S-13·C-1~C-8), 복원력 라이브러리(Resilience4j — U3-S1), 스케줄러(ShedLock — SI §1.2)는 기확정이다. U6는 그 위에 ① 기상청 API 클라이언트, ② 서버 배치 폴링, ③ 클라이언트 지오펜스/포그라운드 위치, ④ GPS 폴리라인 단순화 4개 지점만 구체화하며, 재계획 연산(C1·C2)은 U5 확정분을 재사용(신규 없음)한다.

| # | 영역 | 결정 | 상속/증분 | 근거 |
|---|---|---|---|---|
| U6-W1 | 기상청 API 클라이언트 | **`WeatherPort` 추상화 + 기상청 단기예보·특보 클라이언트** · **LCC DFS 격자 변환**(좌표→격자) · Resilience4j 타임아웃·서킷 재사용 · 무응답 시 마지막 성공 TTL 후 **트리거 침묵** · 캐시=격자 단위 인메모리 TTL(Caffeine 재사용) | 증분 | D10·D27, G191 |
| U6-P1 | 서버 배치 폴링 | **기존 ShedLock 스케줄러 재사용**(J1 날씨 1h·J2 휴무 아침·J3 자동 종료 자정) — 별도 워커·큐 없음. 주기·상한 원격 구성(G195) | 상속 | SI §1.2, G58/G195 |
| U6-C1 | 클라 지오펜스·포그라운드 위치 | **expo-location(포그라운드 한정)** · 지오펜스 로컬 평가 · 저빈도(1~5분) 수집 · 백그라운드 위치 미요청(D27) | 증분 | D27·G62, G55/G73 |
| U6-C2 | GPS 폴리라인 단순화 | **Douglas-Peucker 단순화** — 클라 1차 단순화 + 서버 정규화, 원시 좌표 파기(G73) | 증분 | G55/G73, D34 |
| U6-R1 | 재계획 연산(C1·C2) | **U5 LLM Gateway·Solver Engine·오라클 검증·warm-start·closed-set 재사용(신규 없음)** — U6은 소비자 | **상속(U5)** | services.md §S2, U5 tech-stack |
| U6-S1 | 복원력·캐시 라이브러리 | **Resilience4j**(타임아웃·서킷 — U3·U5 재사용) + **Caffeine**(격자 캐시 — U3 재사용) | 상속 | RESILIENCY-10, U3-S1·S4 |
| U6-PD | 클라우드·시크릿·로그·스케줄러 | U1 PD-1~9 종결·SI 상속 — 기상청 키 Secrets Manager(`external/kma`), ShedLock·아웃박스 | 상속 | SI §1.2·§4·§6 |

- **기상청 클라이언트(U6-W1) 대안 비교**: (A) `WeatherPort` 어댑터 추상화(권고) — 소스 교체·격자 변환·타임아웃·트리거 침묵을 한 곳에 격리(D27 정합). (B) 트리거 모듈 직접 호출 — 소스 종속·침묵 로직 분산으로 허위 알림 금지 강제 약화(비채택). (C) 유료 날씨 SaaS(OpenWeather 등) — D10이 기상청 공공데이터포털 확정(무료·국내 특보 직접), 대안 불필요·비용 증가(비채택). **P3 미확정(쿼터 미상) 상태에서도 어댑터·격자 변환·침묵 폴백은 확정 가능**(소스 무관) — P3 비차단 근거.
- **서버 폴링(U6-P1) 대안 비교**: (A) 기존 ShedLock 재사용(권고) — 신규 AWS 리소스 0·저빈도 저부하·TriggerFired 아웃박스 직결. (B) 별도 폴링 워커+큐 / (C) EventBridge+ECS RunTask — 진행 중 여행 소량·저빈도 폴링에 과설계이며 SI §4(브로커 없음)와 배치(비채택).
- **포그라운드 위치(U6-C1) 대안 비교**: (A) expo-location 포그라운드 한정(권고) — D27·G62 정합·저소모·로컬 지오펜스 평가. (B) 백그라운드 지오펜스 / (C) OS 네이티브 지오펜스 저전력 — 커버리지 넓으나 D27 포그라운드 한정 결정 위반·위치정보법/배터리 리스크(후속 검토). **네이티브 델타**: expo-location은 iOS `NSLocationWhenInUseUsageDescription`·Android 위치 권한 문자열을 config plugin으로 주입 — U3(카카오 지도)·U1('내 주변' 프리프롬프트) 시점에 도입됐는지 확인, 신규 권한 문자열 추가 시 EAS Build 재빌드 델타(OTA 불가).
- **GPS 단순화(U6-C2) 대안 비교**: (A) Douglas-Peucker 클라 1차 단순화 + 서버 정규화·원시 즉시 파기(권고) — 원시가 서버·네트워크에 상주하지 않음(G73·D34)·위상 보존·재구성 불가. (B) 원시 전량 저장(G73 위반) / (C) 서버 전용 단순화(원시 전송·상주 리스크)(비채택).

### 6.11 NFR 설계 패턴 카탈로그 (PAT-U6-01~06)

U6의 재계획 연산·보안 기본·관측성·무상태·복원력 골격 패턴은 U5·U1의 전역 정본을 상속하며, U6 신규 패턴은 6종(서버 폴링·포그라운드 감지·확정 재검증·알림 억제·위치 3층·GPS 법정 로그)이다. 패턴 형식: 문제 → 적용(설계) → U6 적용 지점 → 검증 기준.

**전역 상속 패턴 (재정의 금지)**

| 상속 패턴 | 정본 | U6 적용 지점 |
|---|---|---|
| PAT-U5-02 LLM 게이트웨이 폴백 체인 | U5 | 재계획 사유 해석(C1 경량 티어) 재사용 — 타임아웃 1.5초→규칙 사유 매핑 폴백 |
| PAT-U5-03 솔버 warm-start·오라클 검증 | U5 | 재계획 C2 재사용 — PAT-U6-03이 확정 재검증(G56)·warm-start·고정 블록 불변 소비 |
| PAT-U5-06 closed-set 그라운딩 구조 | U5 | 재계획 후보 소싱도 closed-set(G115) — 환각·폐업 POI 구조적 배제 |
| PAT-U5-04 트랜잭셔널 처리(아웃박스) | U5 | 재계획 current 갱신 + changelog + `ItineraryChanged`·`TriggerFired` 아웃박스 |
| PAT-SEC-01 인증 필터 체인(deny-by-default) | U1 | 실행 상태·트리거·재계획 세션·폴리라인 = 인증 필수·accountId 스코핑(IDOR) |
| PAT-SEC-05 시크릿 관리 | U1 | 기상청 키 = Secrets Manager 주입(`external/kma`) |
| PAT-RES-01 외부 의존 격리 계약(4요소) | U1 | PAT-U6-01이 기상청(WeatherPort) 어댑터 계약을 이 형식으로 작성 |
| PAT-RES-03 우아한 성능 저하 | U1 | PAT-U6-01·05 — 기상청 실패→트리거 (a)만 침묵·나머지 정상, 위치 불가→수동 입력 |
| PAT-PERF-02 커넥션 풀·벌크헤드 | U1 | 폴링·배치 커넥션 풀 ↔ 실행 허브 API 풀 분리 |
| PAT-OBS-01 구조화 로깅·PII 마스킹 | U1 | GPS·위치 로그 마스킹·상관 ID(원시 좌표 미출현) — 법정/운영 로그 분리 |
| PAT-OBS-03 메트릭·알람 대상 | U1 | 기상청 실패율·서킷 open(A12)·쿼터(A11)·트리거 침묵 전환·아웃박스 적체(A10) 계측 |

**PAT-U6-01 서버 배치 폴링 + 트리거 침묵 — 허위 알림 금지**
- 문제: 날씨·휴무는 사용자 위치 없이 서버가 주기 폴링한다(D27). 외부 소스 무응답이면 "위험 없음"인지 "확인 불가"인지 알 수 없다 — 추측으로 알림을 발화하면 허위 경보가 되어 알림 끄기 이탈을 부른다. 침묵 실패(관측 불가)도 금지(ADR-0011).
- 적용: 서버 배치 폴링(ShedLock 재사용)을 돌리되 소스 무응답 시 발화를 억제(트리거 침묵)하고 실패를 관측한다. "사용자에게는 조용, 운영자에게는 계측."

```text
[J1 날씨 폴링 1h / J2 휴무 아침 1회] ── 진행 중 여행의 방문 예정지 좌표
  → 격자 변환·중복 제거(WeatherPort)
  → 기상청/M7 조회
     ├ 성공: 강수확률 ≥60% 또는 특보 / 휴무·영업시간 변경 감지
     │   → M9 상한·억제 필터(G58) + 민감도 → TX 트리거 기록 + outbox TriggerFired
     │       └ M14(U8) 구독: 심각만 푸시 · 경미는 인앱 칩  ← U6는 발행까지
     └ 무응답/서킷 open:
         → 마지막 성공 데이터 TTL 내 사용 → 만료 시 **트리거 침묵**(자동 알림 미발화)
         → 실패율 계측(A12) · 트리거 (a) 계열만 비활성 · 위치 트리거·수동 경로 정상
```

  - 설계 원칙: (a) 기상청 무응답=침묵(허위 알림 금지), (b) 트리거 (a) 계열만 일시 중지·위치 의존 트리거(c·d)·수동 재계획은 정상(부분 장애 격리), (c) 폴링 실패는 반드시 계측과 짝(침묵 실패 금지 관측 A12), (d) 특보는 보수적으로 심각 분류하되 무응답 시엔 침묵이 우선, (e) J1·J2는 상태 기반 조회 + 트리거 상한(G58)이 중복 발화 흡수→자연 멱등, (f) U6는 TriggerFired 발행까지 — FCM 푸시는 M14(U8) 소관.
- U6 적용 지점: M11 `WeatherPort`(격자 변환·TTL·침묵), M9 `evaluateServerTriggers`(폴링·상한·억제), J1·J2 스케줄 잡(ShedLock 재사용), 아웃박스 `TriggerFired`(발행만).
- 검증 기준: RESILIENCY-10 — 기상청 어댑터 명시 타임아웃·독립 서킷·트리거 침묵 폴백(코드 리뷰+계약 테스트). fake로 기상청 무응답·서킷 open 주입 시 자동 알림 미발화 + 실패율 계측 검증. G58/G195 상한·억제·민감도. J1·J2 멱등성.

**PAT-U6-02 클라 포그라운드 지오펜스 감지 — 포그라운드 한정·배터리**
- 문제: 도착 감지·이동 지연·체류 초과는 사용자 위치가 필요하나, 백그라운드 위치를 상시 추적하면 배터리를 소모하고 위치정보법·프라이버시 리스크가 커진다(D27·G62). 포그라운드 한정이면 앱을 닫은 동안 감지 공백이 생긴다.
- 적용: **expo-location 포그라운드 한정 + 로컬 지오펜스 평가**(U6-C1). 커버리지 한계를 제품 동작으로 수용하고 재진입 일괄 재평가로 보완한다.
  - 포그라운드 한정(D27·G62): 백그라운드 위치 권한 미요청. 위치 just-in-time 발화는 여행 중 첫 진입 시점.
  - 로컬 지오펜스 평가: 지오펜스 진입 판정은 클라이언트 로컬 연산(무네트워크) — 도착 프롬프트 즉시 노출, 단 확정은 항상 사용자 탭(자동 확정 없음 D23).
  - 저빈도 수집(1~5분): 상시 고빈도 추적 대신 저빈도 위치·이벤트/포커스 기반 거리 갱신 — 배터리 억제.
  - 재진입 일괄 재평가: 백그라운드 감지 공백은 앱 재진입 시 일괄 재평가로 보완. 서버 폴링 계열(날씨·휴무)은 포그라운드와 독립 동작(PAT-U6-01).
  - 위치 불가 폴백: 권한 거부·GPS 불가 시 수동 체크인·수동 위치 입력(PAT-U6-05로 연결).
- U6 적용 지점: `shared/location`(포그라운드 권한·저빈도 수집·지오펜스 평가), `features/execution`(도착 프롬프트·거리 갱신·수동 체크인), M18 방문 상태 전이(사용자 탭 확정).
- 검증 기준: D27·G62 — 백그라운드 위치 권한 미요청 검증(정적 분석·권한 매니페스트 리뷰). 지오펜스 진입 시 도착 프롬프트 노출·자동 확정 없음(D23) 테스트. 배터리: 저빈도(1~5분)·이벤트 기반 수집 확인. 재진입 일괄 재평가·위치 불가 수동 폴백 테스트.

**PAT-U6-03 재계획 확정 시점 재검증 — warm-start·오라클(C1·C2 재사용)**
- 문제: 대안 산출 시점과 사용자 확정 시점 사이에 상황이 바뀔 수 있다(시간 경과·새 트리거). 재계획 결과가 고정 블록(숙소 체크인/아웃·시각 고정 필수 방문지)을 흔들거나 하드 제약을 위반하면 현장에서 실행 불가한 일정이 된다.
- 적용: U5 솔버 warm-start·오라클 검증(PAT-U5-03)을 재계획에 재사용하고, 확정 버튼 시점 재검증(G56)을 추가한다.
  - warm-start(G46 — U5 재사용): 재계획 시 완료 방문지·시각 고정 필수 방문지·LOCK 슬롯을 불변 고정 블록으로 놓고 당일 잔여만 재배치(C10 — 이월은 미배치 목록).
  - 오라클 검증(D37 — U5 재사용): 후보 배치를 독립 검증기로 하드 제약(숙소 기준점·충돌 무배치·영업시간·closed-set) 재확인 — 검증 실패 후보는 결과에서 제외.
  - 확정 시점 재검증(G56 — U6 소유): `confirmAlternative` 시 `C2.validate` 1회 재검증(11단계). 무효화 시 확정 차단 + 후보 재산출 안내. 통과 시 current만 갱신(plan 불변 D14) + changelog + `ItineraryChanged` 단일 TX.
  - 사유 해석 폴백(C1 — U5 재사용): LLM 타임아웃 1.5초 초과 시 규칙 사유 매핑.
- U6 적용 지점: M10 `startReplan`·`confirmAlternative`(재검증·current 갱신), C2 `solve/validate`(U5 재사용·warm-start·오라클), C1 `call`(U5 재사용·사유 해석), 재계획 세션 상태 머신.
- 검증 기준: D37 하드 제약 4계열 100%(머지 차단) — 재계획 결과도 오라클이 재검증. G56 — 확정 시점 재검증 무효화 시 확정 차단·재산출 테스트. PBT (d) warm-start 고정 블록 보존. D14 — current 갱신·plan 불변(직렬화 왕복). CP3 소비자·CP5(ItineraryChanged) 계약 테스트.

**PAT-U6-04 알림 상한·억제 학습 — 순수 함수 분리**
- 문제: 트리거가 과잉 발화하면 사용자는 알림을 끄고 Plan-B 가치가 붕괴한다. 상한·민감도·무시 억제 로직이 외부 상태(clock·날씨)에 얽히면 테스트가 불가능하고 회귀가 잦다.
- 적용: 판정 로직을 순수 함수로 분리(G116)하고, 상한·억제·민감도를 원격 구성(G195)한다.
  - 판정 순수 함수(G116): clock·날씨·체류를 주입 가능한 순수 함수로 분리 — 상한·억제·민감도 시뮬레이션을 재현 가능한 PBT로 검증.
  - 전역 상한(G58/G195): 시간당 2회/하루 8회(초과·동시 발화는 묶어 1회), 동일 사유·동일 방문지 1회 노출 — 전부 원격 구성.
  - 민감도·무시 억제 학습: 민감도 3단계 ±50% 조정, 2회 연속 무시 시 당일 동일 사유 억제(학습). 휴식 모드 중 경미 억제·심각(기상특보·고정 일정 위협)만 유지(G54 — 심각은 억제 불가).
  - severity 2단·푸시 경계: severe만 푸시(M14 소비), minor는 인앱 칩. 출처·감지 시각 표기.
- U6 적용 지점: M9 판정 순수 함수(상한·억제·민감도), 트리거 이력·억제 상태·민감도 설정 엔티티, 휴식 모드(M10 `enterRestMode`), remote config(G195).
- 검증 기준: G116 — 판정 순수 함수 clock·데이터 주입 결정적 테스트. PBT — 상한 초과 발화 0·무시 2회 후 억제·민감도 단조성·심각 억제 불가(U6-P3·P4). G58/G195 — 원격 구성 반영 테스트. severity 푸시 경계(severe만 M14 푸시) 계약 테스트(CP5).

**PAT-U6-05 위치 3층 동의 폴백 체인 — 조합 매트릭스**
- 문제: 위치 처리는 OS 권한 × 법정 동의 × GPS 옵트인 3층(G182)의 8조합 × 여행 중 상태가 얽혀 복잡하다 — 어느 조합이 누락되면 기능 오동작이나 법적 리스크가 된다. 위치가 막히면 재계획·도착 감지가 중단될 위험이 있다.
- 적용: 조합별 동작 매트릭스를 명문화(§3.F BR-U6-25)하고, 전 조합에 폴백을 보장한다.

```text
위치 3층 (G182)
  OS 권한 ─┐
  법정 동의 ─┼─→ 조합별 동작 매트릭스(테이블 주도 테스트)
  GPS 옵트인 ┘

폴백 체인(재계획 기준점, US-E7-10):
  GPS → 수동 입력(핀·검색) → 마지막 완료 방문지 → 등록 숙소
       └ 어느 폴백이든 '추정 출발지' 화면 표기

동작 분기:
  권한 거부      → 수동 도착 확인 · 위치 수동 입력(재계획 차단 없음)
  옵트인 거부    → 발자취 미수집(비교 화면은 계획 동선만 · 사유 표기, US-E7-13)
  전부 허용      → 포그라운드 감지 · 발자취 수집(옵트인 전제)
```

  - 설계 원칙: (a) 재계획을 위치로 차단하지 않음(위치 불가→수동 입력 폴백), (b) 전 조합에 폴백 존재(권한 거부→수동, 옵트인 거부→미수집), (c) 어느 폴백이든 가정을 화면 표기(추정 출발지), (d) 매트릭스 자체를 테이블 주도 테스트로 구현(전 조합 커버), (e) 3층 동의 모델·법정 로그는 U1 정본 재사용(PAT-U6-06 연결).
- U6 적용 지점: `shared/location`(3층 상태 관리·폴백 체인), M10 `startReplan`(위치 폴백 기준점), `features/execution`(수동 도착 확인)·`features/planb`(수동 위치 입력), US-E7-13 비교 화면(옵트인 분기).
- 검증 기준: G182 — 3층 조합 매트릭스 테이블 주도 테스트 전 조합 커버. US-E7-10 — 위치 불가 시 수동 입력 폴백·재계획 비차단. US-E7-13 — 옵트인 거부 시 계획 동선만 표시·사유 표기. NFR-U6-RES-06·07 정합.

**PAT-U6-06 GPS 옵트인·법정 로그·폴리라인 단순화**
- 문제: 위치 데이터는 위치정보법 법정 의무 대상이다 — 수집 사실을 append-only 로그로 남기고(N2), 원시 좌표를 과잉 보존하면 안 되며(D34), 옵트인 없이 수집하거나 철회 시 파기하지 않으면 법 위반이다. 위치기반서비스사업 신고(P1) 전에는 기능이 켜지면 안 된다.
- 적용: 옵트인 전제 수집 + 원시 파기 + 법정 로그(U1 재사용) + 신고 게이트를 결합한다.
  - 옵트인 전제(D34·N2): GPS 발자취는 3층 동의의 3층(GPS 옵트인) 전제로만 수집. 옵트인 철회·탈퇴 시 즉시 파기(유예 없음).
  - 원시 파기·단순화 폴리라인(G73): 원시 좌표는 클라에서 Douglas-Peucker 단순화 후 즉시 파기, 서버는 단순화 폴리라인만 보존(원시 재구성 불가).
  - 법정 로그(N2·SECURITY-14 — U1 append-only 재사용): 위치정보 수집·이용 사실을 U1이 생성한 append-only 법정 로그 테이블에 GPS 이벤트와 동일 TX 기록(유실 0). 앱 역할은 자기 로그 삭제 권한 없음(DB REVOKE + IAM Deny 2중 강제). U6은 이 테이블의 첫 기록 개시 유닛. 월 1회 스냅샷 잡이 전월분을 `log-archive`로 내보내기.
  - 신고 게이트(P1): 위치기반서비스사업 신고 완료 전 기능 비활성 플래그.
- U6 적용 지점: `shared/location`(옵트인·단순화·원시 파기), M18/M10(GPS 폴리라인 저장 — 법정 로그 동일 TX), 위치 법정 로그(U1 테이블 재사용), 계정 삭제 파기 핸들러.
- 검증 기준: N2·SECURITY-14 — 법정 로그 append-only(마이그레이션 리뷰·REVOKE·IAM Deny), GPS 동일 TX 기록(유실 0). D34 — 옵트인 없이 미수집·철회 시 즉시 파기 테스트. G73 — 원시 파기·단순화 폴리라인만 보존(원시 재구성 불가) PBT(U6-P9 위상 보존). P1 — 신고 전 비활성 플래그 확인.

### 6.12 선결·미결 (P1·P3·P7)

U6는 비개발 선결 3건이 있으나, NFR 산출물은 어댑터 fake·비활성 플래그로 비차단이다. U6의 신규 외부 벤더·인프라 미결은 기상청(P3) 1건뿐이며, 나머지(클라우드·CI/CD·컴퓨트·DB·재계획 연산·위치 법정 로그·시크릿)는 전역 결정 GD-1~7·SI·U1·U5 상속이다.

| 과제 | 차단 대상 | 대응 |
|---|---|---|
| **P1 위치기반서비스사업 신고**(위치정보법 제9조) + 위치 전문 법무 자문 | GPS 발자취·위치 기반 트리거의 법정 출시 전제 | 위치 3층 모델·법정 로그 스키마는 U1에서 자문 반영 완료(append-only 재사용). 신고 완료 전 기능 비활성 플래그 — 개발·테스트 비차단 |
| **P3 기상청 공공데이터포털 API 활용 신청** | M11 개발·트리거 (a) 계열의 전제 | `WeatherPort` 어댑터를 fake로 개발·테스트 선행(D37 계층 분리), 실키 병렬 신청. 무응답 시 트리거 침묵 폴백 — 비차단 |
| P7 약관(위치기반서비스 약관) | 동의 화면·재열람 실문안 | U1 동의 체계(3층 모델·버전) 상속, 문안만 교체 — 비차단 |

---

## 7. 인프라

공유 인프라 정본은 [인프라](../infrastructure.md)(이하 SI)다. **U6는 SI를 참조만 하고 재정의하지 않는다.** 본 절은 U6가 SI에 추가하는 인프라 증분(기상청 아웃바운드·서버 폴링 잡·GPS/날씨 스키마·위치 법정 로그 기록 개시)만 기술한다. 재계획 연산 인프라는 [U5](./u5-itinerary.md) 재사용(신규 없음), 배포 파이프라인 정본은 U1 스캐폴드 생성분이다.

### 7.1 요약 — U6 인프라 증분: 신규 AWS 리소스 0

U6는 실시간·위치 유닛이나 **신규 AWS 리소스는 0**이다 — SI가 이미 U6를 명시적 소비자로 예약해 두었기 때문이다: NAT 아웃바운드(§2.1) + 스케줄 잡 프레임(§1.2 ShedLock) + 위치 법정 로그 기록 개시(§5.3) + 기상청 시크릿(§6 프레임) + 외부 쿼터·실패율 알람(§8.2 A11·A12) + 아웃박스(§4). U6 인프라 결정은 넷 — **① 기상청 벤더 아웃바운드·시크릿, ② 서버 배치 폴링 잡(기존 스케줄러), ③ GPS 발자취·날씨 캐시 저장(RDS 스키마), ④ 위치 법정 로그 기록 개시**이며, 전부 기존 리소스 내 확장/설정이다.

선결 경계: 기상청 API 활용 신청·쿼터·서비스 키는 P3 확정 대상이고, GPS 발자취·위치 기반 트리거의 실서비스 활성은 P1(위치기반서비스사업 신고) 완료 전 비활성 플래그 대상이다. 본 절은 아웃바운드 경로·시크릿 항목·폴링 잡·저장 스키마·법정 로그까지 벤더 중립으로 확정한다(개발 비차단, 출시는 P1·P3 게이트).

### 7.2 기상청 벤더 아웃바운드 · 시크릿 보관 (SI §2·§6 상속)

아웃바운드 경로: ECS(프라이빗 앱 서브넷) → NAT Gateway(SI §2.1, 기존 1개) → 기상청 공공데이터포털. `sg-app` 아웃바운드 443은 SI §2.2가 이미 허용(목적지 IP 가변 SaaS 예외 문서화) — SG 변경 0. U6 아웃바운드 목적지 문서화:

| 목적지 | 어댑터(포트 · 소유) | 용도 |
|---|---|---|
| **기상청 공공데이터포털**(단기예보·기상특보, D10) | `WeatherPort` · M11 | Plan-B 트리거 (a) 계열(강수확률·특보) — **P3 신청** |
| (재사용) TourAPI·카카오 지도 | `TourContentPort` 등 · M7(U3) | J2 휴무·영업시간 재조회(정기 변경만 G192) — U3 어댑터 재사용(신규 아웃바운드 아님) |
| 외부 지도 앱 딥링크 | 딥링크 빌더(외부 호출 없음) | URL 조립만 — 아웃바운드 미발생(G66) |

- 시크릿(SI §6 프레임): 기상청 API 키를 Secrets Manager에 신규 시크릿 항목으로 등록 — **`external/kma`**(기상청 서비스 키). ECS 태스크 정의 `secrets` ARN 참조 주입 — 코드·이미지·Terraform state 평문 0. 로테이션은 공공데이터포털 키 갱신 주기 준수(P3 후 확정).
- 어댑터 타임아웃·서킷·격자 변환은 앱 소관(Resilience4j·LCC DFS — U6-W1) — 인프라는 SI §8.2 A12(어댑터 실패율·서킷 open)·A11(기상청 쿼터 80%) 알람을 제공(§7.6). 카카오모빌리티 도로 거리(재계획 이동시간)는 C2 소유(U5) — U6 미호출, 실패 시 직선거리×우회계수(G106) 폴백.

### 7.3 서버 배치 폴링 잡 — 기존 ShedLock 스케줄러 재사용 (신규 리소스 0)

U6 폴링 잡은 SI §1.2 확정 모델(앱 프로세스 내 Spring `@Scheduled` + PostgreSQL ShedLock 분산 락)을 재사용한다 — 별도 워커 서비스·EventBridge 없음(진행 중 여행 소량·저빈도).

| 잡 | 소유 | 주기 (원격 구성 G195) | 내용 | 근거 |
|---|---|---|---|---|
| J1 날씨·특보 폴링 | M9 (M11 경유) | **1시간 · 원격 구성** | 진행 중 여행 당일~익일 방문 예정지 좌표(격자 변환·중복 제거) → 날씨 캐시 갱신 + 트리거 평가 → `TriggerFired` | services.md §4 J1, D10 |
| J2 휴무·영업시간 재조회 | M9 (M7 경유) | **당일 아침 1회(기본 07:00) · 원격 구성** | 당일 방문 예정 POI → TourAPI·지도 재조회(정기 변경만 G192) → 변경 감지 시 `TriggerFired` | services.md §4 J2, G192 |
| J3 여행 자동 종료·일자 경계 | M18 | **일 1회 자정(KST)** | 종료일 경과 여행 → `TripEnded` / 일자 경계 → `DayClosed`(당일 회고 트리거 U7) | services.md §4 J3, D19 |

- 중복 실행 방지: ShedLock 분산 락으로 태스크 2개 중복 실행 배제. 폴링 커넥션 풀은 실행 허브 API 처리 풀과 분리(U1 PAT-PERF-02 벌크헤드 상속 — 배치가 여행 중 실시간 요청 지연 방지).
- 원격 구성(G195): 폴링 주기·트리거 상한(시간당 2회/하루 8회)·민감도·폴백 순서는 전부 remote config — 코드 재배포 없이 조정.
- 기상청 무응답 처리(J1): 즉시 1회 재시도 후 트리거 침묵(허위 알림 금지) + 실패율 계측(A12) — 잡 자체 실패는 다음 주기 자연 복구.
- 멱등성: J1·J2는 상태 기반 조회 + 트리거 상한(G58)이 중복 발화 흡수, J3은 상태 기반 + 조건부 전이 = 자연 멱등.
- 전환 트리거: 폴링 대상·기상청 호출량이 태스크·쿼터를 상시 압박하면 EventBridge Scheduler + ECS RunTask 분리 재평가. 그 전까지 별도 워커 미도입(과설계 금지).

### 7.4 GPS 발자취·날씨 캐시 저장 — RDS 스키마 확장 + 위치 법정 로그 개시 (Flyway)

- 저장소: SI §3의 기존 RDS PostgreSQL(단일 `trippilot` DB·`public` 스키마) 재사용 — 신규 DB 인스턴스·클러스터 없음. U1 Flyway 파이프라인으로 U6 마이그레이션 적용.
- U6 신규 테이블(~8~9개): 실행 상태(방문 전이·체류), 여행 실행 상태(활성·휴식·종료), 트리거 이력·억제 상태, 민감도 설정, 재계획 세션, 대안 후보, 미배치 목록(C10), 날씨 캐시(격자 nx·ny), **GPS 폴리라인**(단순화만·원시 파기 G73).
- 위치정보 법정 로그 — U1 append-only 테이블 재사용, U6 기록 개시(N2·SI §5.3):
  - 테이블 자체는 U1 생성(위치정보 수집·이용 사실확인자료 append-only 테이블, `app_user` UPDATE/DELETE REVOKE + IAM `s3:DeleteObject`·`logs:Delete*` Deny 2중 강제). **U6이 이 테이블에 처음 기록을 개시.**
  - GPS 이벤트와 동일 트랜잭션 기록(유실 0). 앱 역할은 자기 로그 삭제 권한 없음.
  - 월 1회 스냅샷 잡 개시: 전월분 법정 로그를 `trippilot-{env}-log-archive` 버킷으로 내보내기(SSE-KMS·별도 프리픽스) — U6 기능 활성 시점부터 가동.
  - 계정 삭제 시: GPS 폴리라인·위치 파생 데이터는 즉시 파기(D34), 법정 로그는 분리 보관 유지(6개월+, N2).
- GPS 옵트인 게이트: GPS 폴리라인 저장·법정 로그 기록은 옵트인(3층 동의 3층) 전제(D34) + P1 신고 완료 전 비활성 플래그.
- 볼륨: DAU 1천·활성 여행 ≤1/사용자(D21)·저빈도(1~5분) 수집 → GPS 폴리라인·법정 로그 일 수만 행 수준 — SI §3 gp3 20GB(오토스케일 100GB 상한) 내 충분. 날씨 캐시는 격자 단위 소량(인메모리 캐시 병행). 트리거 이력·실행 상태는 여행별 인덱스.
- 소유권·권한: U6 일반 테이블(실행 상태·트리거·폴리라인)은 `app_user` 표준 DML(accountId 스코핑). 위치 법정 로그만 append-only REVOKE 대상(U1 롤 모델 재사용).

### 7.5 트리거·푸시 경계 — M14(U8) 발행/구독 분리 (U6는 발행만)

U6의 트리거 처리는 아웃박스 발행까지이며, 실제 FCM 푸시 발송은 M14([U8](./u8-notification.md)) 소관이다.

- U6 소유(발행): M9가 트리거 상한·억제 필터(G58) 통과분을 TX 트리거 기록 + outbox `TriggerFired`. 재계획 확정은 current 갱신 + changelog + outbox `ItineraryChanged`(PAT-U5-04 아웃박스 재사용). 여행 종료·일자 경계는 `TripEnded`·`DayClosed` 발행(J3).
- M14(U8) 소유(구독·푸시): `TriggerFired` 구독 → 심각(severe)만 FCM 푸시, 경미(minor)는 인앱 칩. FCM 아웃바운드·SNS/알림 스케줄링은 U8 인프라. **U6은 FCM 인프라를 만들지 않는다.**
- 아웃박스 인프라: 전역 아웃박스(PostgreSQL 테이블 + J10 릴레이, SI §4)는 U1 산출 — U6은 신규 아웃박스 리소스 없이 이벤트 타입만 추가(at-least-once·구독자 멱등). 아웃박스 적체는 A10 알람으로 관측.

### 7.6 외부 알람 · 관측 (SI §8.2 구체화)

외부 API 알람(U6가 기상청의 첫 소비자):

| 알람(SI 프레임) | U6 소스 | 임계 | 단계 |
|---|---|---|---|
| A11 외부 쿼터 80% | **기상청** 호출량 vs 문서화 쿼터(P3) | 80% | P2 |
| A12 어댑터 실패율·서킷 open | **기상청** 어댑터 | 실패율 >20%(5분) 또는 서킷 open | P2 |
| A10 잡·큐 적체 | 폴링 잡·아웃박스(TriggerFired) 지연 | > 15분 | P2 |

- 알람 라우팅은 SNS `trippilot-{env}-alerts` → OPS-02 프로세스. 기상청 쿼터 한도는 P3 API 활용 신청 후 문서화. 커스텀 메트릭은 SI §7.1 태스크 역할 `cloudwatch:PutMetricData` 허용 내.
- 트리거 침묵 관측(NFR-U6-RES-01): 기상청 무응답으로 트리거 (a) 계열이 침묵 전환되면 자동 알림은 조용하되 실패율·침묵 전환은 계측(침묵 실패 금지 관측) — A12·커스텀 메트릭으로 대시보드 노출. GPS·위치 처리 로그는 PII·정밀 좌표 마스킹(PAT-OBS-01 상속), 법정 로그와 운영 로그 분리.

### 7.7 SI 대비 델타 표

| 계층 (SI 절) | 신규 AWS 리소스 | 변경 |
|---|---|---|
| 컴퓨트 ECS (SI §1) | **0** | 0 — 폴링·재계획·실행 API는 기존 태스크 2개 흡수(진행 중 여행 소량·저빈도) |
| 네트워크 VPC·NAT·ALB (SI §2) | **0** | 0 — 기상청 NAT 아웃바운드·`sg-app` 443·`/api/*` 재사용. 아웃바운드 허용 목록 문서화만(기상청 추가) |
| 데이터베이스 RDS (SI §3) | **0** | **테이블 ~8~9개** — 기존 RDS·Flyway 확장 |
| 위치 법정 로그 (SI §5.3) | **0** | **U1 append-only 테이블에 기록 개시** + **월 1회 스냅샷 잡 가동 개시**(log-archive) — 테이블·버킷은 기존 |
| 캐시 (신규 계층) | **0** | 인메모리 Caffeine(격자 날씨 캐시 — U3 재사용) — ElastiCache 미도입 |
| 시크릿·KMS (SI §6) | **0** | Secrets Manager 항목 1개 추가(`external/kma`) — SI §6 프레임 내 |
| 관측성 CloudWatch (SI §8) | **0** | 기상청 A11·A12·A10 소스 편입·트리거 침묵 커스텀 메트릭·대시보드 위젯 — 기존 프레임 |
| 메시징·비동기 (SI §4) | **0** | 0 — 서버 폴링은 기존 ShedLock, TriggerFired/ItineraryChanged는 기존 아웃박스(이벤트 타입만 추가) |
| 스토리지 S3·CloudFront (SI §5) | **0** | 0 — U6는 사진 없음(사진 U7). log-archive 버킷은 §5.3 스냅샷 대상(기존) |

**총계: 신규 AWS 리소스 0 / 변경 = RDS 스키마 확장(테이블 ~8~9개) + Secrets Manager 항목 1개(`external/kma`) + 위치 법정 로그 기록·월 스냅샷 잡 개시 + 기상청 알람/메트릭 활성화 + 폴링 잡 3종(기존 스케줄러).** U6는 실시간·위치 유닛이지만 인프라는 SI가 예약한 프레임(NAT·스케줄러·시크릿·법정 로그·아웃박스) 내에서 종결된다 — 재계획 연산은 U5 재사용, 신규 외부는 기상청 아웃바운드 1종이라 신규 인프라 표면이 없다.

### 7.8 배포 — shared 파이프라인 재사용

U6는 별도 배포 아키텍처 문서를 만들지 않는다 — 전역 배포 파이프라인 정본(U1 스캐폴드 생성)을 재사용한다.

- 서버(M18·M9·M10·M11 모듈 + 실행/트리거/재계획/GPS 마이그레이션): `server/**` 경로이므로 `server-ci.yml`·`server-deploy.yml` 수정 없이 커버(유닛별 모듈 추가는 워크플로 수정 불요). 테이블 추가는 Flyway forward-only(신규 테이블 = N-1 호환 자유, OPS-01). 롤백=버전 고정 재배포(GD-4)·롤링(GD-5) 상속. **기상청 시크릿(`external/kma`)은 배포 전 Secrets Manager 등록.** 폴링 잡은 기존 ShedLock 스케줄러 흡수(신규 워크플로 없음).
- 모바일(`features/execution`·`features/planb`·`shared/location`): `apps/mobile/**` 경로 — `mobile-ci.yml`(tsc·ESLint·Jest+fast-check) 커버. 화면(활성 허브·도착 프롬프트·재계획 비교·계획 vs 실제 경로 지도)은 대부분 순수 JS/TS로 OTA 반영 가능. 단 **`shared/location`(expo-location)은 위치 권한 문자열을 config plugin으로 주입하는 네이티브 모듈**이다 — U1('내 주변' 프리프롬프트)·U3(카카오 지도 SDK) 시점에 expo-location·권한 문자열이 이미 도입됐으면 순수 JS OTA, 여행 중 포그라운드 위치 권한 문자열을 신규 추가하면 EAS Build 재빌드 델타(OTA 불가 — U3 지도 SDK와 동일 성격). config plugin·권한 상태를 U6 초기 스파이크로 확인. 지도(계획 vs 실제 경로)는 U3 `shared/map` 상속.
- 환경: dev(자동)·prod(승인 게이트) 승격 상속. 폴링 주기·트리거 상한·민감도·폴백 순서·기상청 키는 remote config·시크릿으로 환경별 독립(G195) — P3 확정 후 값 주입(코드 재배포 없이 조정). **위치 기능은 P1(위치정보사업 신고) 완료 전 비활성 플래그(remote config) 운영** — 신고 완료 시 플래그 활성.

**U6 배포 델타**: 서버는 기존 워크플로 흡수(0 델타). 모바일은 expo-location 위치 권한 config plugin으로 인한 네이티브 재빌드 가능성(기존 권한 재사용이면 OTA)이 유일한 델타. 유일한 배포 전 조치는 기상청 시크릿 등록(P3 후) + 위치 기능 비활성 플래그(P1 게이트)이며, 인프라 파이프라인 변경은 없다.

---

> 관련 문서: [기획 개요](../overview.md) · [페르소나](../personas.md) · [시나리오](../scenarios.md) · [에픽](../epics.md) · [유저 스토리](../user-stories.md) · [범위](../scope.md) · [아키텍처](../architecture.md) · [도메인 모델](../domain.md) · [플로우](../flows.md) · [핵심 결정/ADR](../decisions.md) · [NFR 기준](../nfr.md) · [인프라](../infrastructure.md) · [개발 순서](../units.md) · [용어집](../glossary.md) · 유닛: [U1 기반](./u1-foundation.md) · [U2 앱셸](./u2-appshell.md) · [U3 장소·숙소](./u3-place-stay.md) · [U4 여행](./u4-trip.md) · [U5 일정](./u5-itinerary.md) · [U7 기록·회고](./u7-archive.md) · [U8 알림](./u8-notification.md)
