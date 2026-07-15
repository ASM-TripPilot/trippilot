# 유닛 U7 상세 설계 — 기록·회고

> 출처: aidlc-docs/construction/u7-archive/functional-design/{domain-entities,business-rules,business-logic-model,frontend-components}.md, aidlc-docs/construction/u7-archive/nfr-requirements/{nfr-requirements,tech-stack-decisions}.md, aidlc-docs/construction/u7-archive/nfr-design/nfr-design-patterns.md, aidlc-docs/construction/u7-archive/infrastructure-design/infrastructure-design.md, aidlc-docs/construction/plans/u7-archive-{functional-design,nfr-design}-plan.md, aidlc-docs/inception/application-design/unit-of-work.md(§U7) · aidlc-docs에서 2026-07-05 추출 · 이후 본 문서가 정본이다.

## 1. 개요

### 1.1 이 유닛의 한 줄 정의

U7은 **여행의 산출을 자산으로 바꾸는 유닛**이다. 여행이 끝나도 남는 것(plan/actual/changelog 3계열 대조·사진·회고)을 만든다. 확정 일정(plan, U5 산출)에 대해 실제로 일어난 방문(actual)과 변경 이력(changelog)을 소유·보관하고, 사진 파이프라인·오프라인 입력 동기화를 완성하며, LLM 회고·전체 요약·스타일 분석·공유 카드를 생산한다. 담당 서버 모듈은 **M12 Travel Archive**(actual·사진·메모·changelog·GPS·오프라인 동기화 정본)·**M13 AI Reflection**(회고·요약·분석·공유 카드) 2종이고, 여기에 U5가 완성한 **C1 LLM Gateway(상위 티어)를 재사용**한다(신규 LLM 벤더·인프라 표면 0).

### 1.2 유닛 범위 — 에픽·스토리·모듈

| 구분 | 내용 |
|---|---|
| 소유 에픽·스토리 | **Epic 8(US-E8-01~14) = 14 스토리**. actual·changelog 3계열 대조·사진 파이프라인·오프라인 동기화·LLM 회고·스타일 분석·공유 카드 |
| 서버 모듈 | **M12 Travel Archive**, **M13 AI Reflection** (+ C1 LLM Gateway 재사용 계약 수준) |
| 서버 산출물 | `modules/archive`, `modules/reflection` |
| 클라이언트 features | `features/archive`(기록·회고·공유 카드), `shared/storage`(오프라인 입력 로컬 큐 — 기록 입력 Δ6, U7 신규 클라이언트 자산) |
| DB 마이그레이션 | 약 7개 테이블 — actual 방문 기록·사진 메타(스토리지 키·썸네일)·changelog(통합 diff)·회고(초안/수정본·유형)·스타일 분석 결과·동기화 버전(레코드 단위)·이동 거리 집계 |
| 외부 연동 | **S3 호환 오브젝트 스토리지 + CDN**(사진, G168 — 프로젝트 최초 사진 스토리지) — LLM은 C1 재사용 |
| 스케줄러 잡 | 없음(당일 회고·전체 요약은 U6의 DayClosed·TripEnded 이벤트 구동) |

### 1.3 포함·명시적 제외

**포함**

- M12 아카이브: 방문 기록(actual — U6 `VisitChecked` 소비)·수동 체크·실제 체류, 사진·메모 첨부(장소당 20장·클라 압축 5MB/2048px·서버 썸네일 G75/G145), 즉석 방문 입력(POI 검색 + 자유 텍스트 G77), changelog 통합 diff 스키마 **보관·열람**(행위자·출처·사유·전/후 값 — Plan-B·공동편집·어시스턴트 공용 G57/G132), 계획·실제·변경 3계열 구분 저장(US-E8-04), 숙소·날짜 기준 귀속, 오프라인 입력 로컬 큐·동기화·충돌 해소(레코드 버전 + 항목별 선택·사진/메모 합집합 G74/Δ6), 이동 거리 혼합 합산(G72)·걸음 수 추정(G59)
- M13 회고: 당일 회고 초안 자동 생성(`DayClosed` 트리거)·수정·재생성(덮어쓰기 경고 G78), 여행 종료 후 전체 요약(`TripEnded` 트리거, S4), 스타일 분석(방문 10곳 게이트·취향 7종 축 택소노미 G76), 실패 시 기본 카드 폴백, 다음 여행 개인화 신호(US-E8-10), 종료 후 편집·수동 재생성(C11)
- 공유 카드: SNS 공유 이미지 구성·내보내기(US-E8-13), 캘린더 탐색(US-E8-14), 기록 탭·마이페이지 열람(US-E8-11 — 마이페이지 통합 최종은 U8)
- GPS 발자취의 기록 귀속·옵트인 철회 시 파기 연동(수집은 U6, 동의 모델은 U1)

**명시적 제외**

- 커뮤니티 게시(U10) — 공유 카드는 이미지 내보내기까지(EXIF 처리 G185는 U10 게시 시)
- 회고 알림 **발송**(U8 — `ReflectionReady` 이벤트 발행까지가 U7)
- 사진 전체 아카이브 내보내기 — 텍스트 JSON만 1차(G101, U8 소관)

### 1.4 선행·후행 유닛 (계약 포인트)

U7은 **CP4(U6→U7)의 소비자이자 CP5(U7→U8)의 공급자**다. 방문 체크·여행 종료·changelog diff·GPS 폴리라인을 U6에서 소비해 actual·회고·기록을 생산하고, 회고 완료(`ReflectionReady`)를 U8 알림에 공급한다.

| 관계 | 계약 | 방향 | 내용 |
|---|---|---|---|
| 선행 | **CP4** | [U6 상세](./u6-execution.md) → U7 | `VisitChecked`(start/complete/skip)·`DayClosed`·`TripEnded`·changelog diff(G132)·GPS 폴리라인 소비 |
| 선행 | **CP3** | U5/M8 → U7 | plan(불변 스냅샷)·current(가변) 참조·소비(회고 대조·changelog 재구성 대조용, 재정의 금지) |
| 선행 | **C1 재사용** | [U5 상세](./u5-itinerary.md) → U7 | C1 LLM Gateway(상위 티어)를 회고·요약·스타일 서술 생성에 재사용(중복 재구현 금지) |
| 선행 | 지도 | U3/U5/U6 → U7 | `shared/map`(카카오 SDK 브리지)·U5 지도 뷰·U6 `PlanVsActualMapScreen` 레이어 재사용(U7은 새 브리지 미생성) |
| 후행 | **CP5** | U7 → [U8 상세](./u8-notification.md) | `ReflectionReady`(회고 완료 알림 트리거)·3계열 대조 데이터 공급 |
| 후행 | changelog 공용 | U7 → U9·U10·U11 | changelog 통합 diff 스키마(G132)는 어시스턴트(U9)·공개 이력(U10)·공동편집 이력(U11)의 참조 정본 |

### 1.5 완료 기준(DoD) 요지

- **기능**: E8 14개 스토리 수용 기준 충족. 사진 업로드 실패 시 큐·재시도(침묵 실패 금지), 회고 LLM 실패 시 기본 카드 폴백.
- **하드 제약(D37)**: 계정 무결성(기록·사진·회고의 소유권 격리, 회고 LLM 입력의 서버 재조회 D31) 테스트 100%. changelog 스키마 무결성(전/후 값·행위자 필수) 검증.
- **PBT(속성 기반 테스트)**: changelog diff 누적 재구성 = 스냅샷 동등성(G132), 오프라인 병합(임의 순서 수렴·사진/메모 합집합·충돌 무손실), plan/actual 대조 함수, 직렬화 왕복(오프라인 큐 페이로드), 이동 거리 혼합 합산(구간 분할 불변).
- **확장 규칙**: SECURITY-05(업로드 파일 검증·크기 제한)·SECURITY-01(사진 스토리지 암호화)·RESILIENCY-01(M12 입력 로컬 큐 보존 High)·N2(GPS 데이터 파기 연동) 정합.
- **계약 포인트**: CP4 소비자 측(VisitChecked·TripEnded·DayClosed·changelog diff) + CP5 공급자 일부(ReflectionReady) 계약 테스트. U6 changelog 생산분의 재생 테스트를 CP4 통합 시나리오에 포함.

### 1.6 소유 경계 — plan/actual/changelog/current 4계열 (D14·ADR-0013, FD-U7-02)

| 계열 | 소유 모듈 | 성질 | U7 관여 |
|---|---|---|---|
| plan(불변 스냅샷) | M8(U5) | 확정 시 동결·바이트 불변 | **참조·소비만**(회고 대조 기준 — plan⊗actual) |
| current(가변 현재본) | M8·M10(U5·U6) | 재계획 시 갱신 | 참조·소비만(changelog 재구성 대조) |
| **actual(실제 방문 기록)** | **M12(U7)** | 방문 체크·사진·메모·체류 | **소유 정본** — CP4 VisitChecked 생산 |
| **changelog(변경 이력)** | **M12(U7)** | 항목 단위 diff·append-only | **소유 정본** — 보관·열람·재생(G132) |

### 1.7 핵심 설계 결정 (FD-U7-xx)

정본 문서(components.md·component-methods.md·services.md S4·S8·PRD 09·requirements.md)가 결정을 이미 확정한 상태이며, 아래는 Functional Design 단계에서 정본을 인터페이스 계약·불변식 수준으로 상세화하며 내린 판단이다(질문 없이 결정).

| ID | 결정 | 근거·정본 |
|---|---|---|
| FD-U7-01 | **actual 영속 정본은 M12(U7) VisitRecord**이며 M18(U6) VisitState(실행 중 상태 머신)와 경계 분리. U7은 CP4 `VisitChecked`를 구독해 actual을 생산·보관, 방문 상태 전이 강제는 U6 소유(재정의 금지). 종료 후 기록 편집은 M12 허용하되 상태 재전이 아님(C11) | CP4, components §3.3, M18·M12, U6 INV-VISIT5 |
| FD-U7-02 | **plan/actual/changelog 3계열 대조(D14)** — plan(불변, U5/M8·CP3 파생), current(가변, M8·M10), **actual·changelog는 M12(U7) 소유 정본**. 회고·비교는 plan⊗actual 대조, changelog는 current 재구성 원장. plan/current는 참조·소비만 | D14, ADR-0013, CP3, CP4 |
| FD-U7-03 | **changelog 통합 diff 스키마(G132)는 M12(U7)가 보관·열람·재생하는 정본** — U6(Plan-B)·(후속) M17(공동편집)·M16(어시스턴트) 공용. 출처 유형 enum에 CoEdit·Assistant를 예약하고 스키마 버전 필드로 전방 호환. 핵심 속성: **diff 누적 재구성 = current 스냅샷 동등성** | G57/G132, CP4, U9~U11 공용 |
| FD-U7-04 | **오프라인 동기화는 레코드 단위 독립 커밋**(배치 전체 원자성 의도적 부재, S8) — recordId(클라 UUID) 멱등, 사진·메모 **추가는 합집합 자동 병합**(충돌 아님), **상태 필드(완료/스킵·시각)만 충돌 대상**·사용자 항목별 선택. 어떤 경로도 무손실 | G74, D24/Δ6, services S8 |
| FD-U7-05 | **사진 파이프라인은 방문 체크·메모와 부분 실패 격리** — 클라 압축(5MB/2048px)·서버 썸네일·원본 기기 보관, uploadState 머신(LOCAL→QUEUED→RETRYING(≤3)→FAILED/DONE), **EXIF(위치 포함) 클라 압축 시 제거**(위치는 GPS 옵트인 경로로만 별도 관리 D34). 커뮤니티 게시 시 추가 EXIF GPS 제거는 U10(G185) 소관 | G75/G145, PRD 09-2, D34 |
| FD-U7-06 | **회고·요약·분석 LLM 호출은 전부 C1(U5 자산·상위 티어) 재사용** — 실패·타임아웃 시 **대체 산출 소유자는 M13**(기본 카드 폴백·통계만). 침묵 실패 금지: '데이터 없음'/누락 항목 명시. 재구현 0 | D11, ADR-0011, components M13·C1 |
| FD-U7-07 | **회고 수정본은 원본 초안과 별도 저장**(editedContent), 수정본이 최종 표시본. 재생성은 수정본 존재 시 **덮어쓰기 경고 후 확인 시에만 교체**(G78). 종료 후 편집분 반영은 수동 '다시 생성'만(C11 — 자동 갱신 없음) | G78, C11, PRD 09-7 |
| FD-U7-08 | **스타일 분석 게이트는 누적 방문 장소 수 ≥ 10곳 단일 기준**(완료 여행 수 아님 — 충돌 시 방문 수 우선). 미달 시 온보딩 취향 기반 **임시 미리보기**(정식 아님 명시) + 진행 게이지. 게이트는 방문 수에 단조(비축소) | G76, PRD 09-9 |
| FD-U7-09 | **이동 거리는 혼합 산출(G72)** — GPS 동의 구간=실측 폴리라인 합산 + 미동의 구간=장소 간 거리 추정, 걸음 수=거리 환산 추정(추가 권한 없음 G59). 전부 **추정 표기 강제**. 구간 분할·순서 불변에 결정적 | G72, G59, ADR-0009 |
| FD-U7-10 | **GPS 발자취 영속 정본은 M12(U7)** — 수집·단순화는 U6, U7은 CP4 폴리라인을 귀속·보관·경로 비교 데이터화. **옵트인 철회·탈퇴 시 즉시 파기**(`purgeLocationData`, 30일 유예 없음), 법정 로그는 분리 보관 유지 | D34/N2, CP4, G55/G73, S6.2 |
| FD-U7-11 | **CP5 공급은 `ReflectionReady` 이벤트까지**(회고 완료 알림 — 발송은 U8). 마이페이지 통합·알림 발송·전체 아카이브 내보내기는 U8 소관 | CP5, unit-of-work §U7 제외 |
| FD-U7-12 | **추적 ID 체계**: 엔티티 불변식 `INV-{도메인}`(REC/IMP/MEDIA/CLOG/REFL/SUM/STYLE/SHARE/SYNC/GPS), 규칙 `BR-U7-xx`, 속성 `U7-Pxx`, data-testid `archive-{screen}-{role}` | U6 관례 승계 |

### 1.8 핵심 리스크와 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| changelog 스키마가 후속 3유닛(U9~U11) 공용 — 초기 설계 실수 시 파급 최대 | 후속 유닛 재작업 | Functional Design에서 U10·U11 사용 시나리오(공개 스냅샷·공동편집 이력)까지 검토 범위 포함, 스키마 버전 필드 예약, diff 재생 PBT(U7-P1)를 회귀 안전망으로 |
| 오프라인 충돌 해소 UX 복잡도(G74) | 데이터 유실 인상 | 자동 병합(합집합) 범위 최대화, 사용자 선택은 레코드 단위 최소화, 어떤 경로도 무손실(양쪽 보존)을 PBT(U7-P3)로 강제 |
| 사진 파이프라인 비용·실패(대용량·불안정 네트워크) | 업로드 이탈 | 클라 압축 선행(5MB/2048px)·백그라운드 큐·지수 백오프 재시도, 원본 기기 보관으로 서버 부담 축소 |
| LLM 회고 품질 편차·비용 | 회고 가치 하락 | 상위 티어 라우팅(D11) + 구조화 프롬프트, 10곳 게이트로 빈약 입력 차단, 실패·저품질 시 기본 카드 폴백(수용 기준화) |

관련 크로스커팅 문서: [아키텍처](../architecture.md) · [도메인 모델](../domain.md) · [주요 흐름](../flows.md) · [핵심 결정/ADR](../decisions.md) · [NFR 기준](../nfr.md) · [인프라](../infrastructure.md) · [개발 순서](../units.md) · [용어집](../glossary.md).

## 2. 도메인 엔티티

> 소유 모듈: M12 Travel Archive, M13 AI Reflection (+ C1 재사용 계약 수준). 표기 — `필수`=NULL 불가, `선택`=NULL 허용(NULL 의미 명기), `유니크`=제약 범위 내 유일, `불변`=생성 후 변경 불가, `추가전용`=append-only, `파생`=저장 안 함(조회 시점 계산). 기술 중립 — 저장 기술·오브젝트 스토리지·CDN·LLM 티어·remote config 수치(사진 상한·재시도 횟수·게이트 임계·보존 기간)는 NFR/Infrastructure 소유.

### 2.1 엔티티 지도

```text
[M12 Travel Archive — actual·사진·메모·changelog·GPS·오프라인 동기화 정본]
Trip 1 ──── * VisitRecord            (실제 방문 기록 actual — CP4 VisitChecked 소비·D23·D14)
VisitRecord ◁── ImpromptuVisit       (즉석 방문 특수화 — slotRef=NULL·좌표/카테고리 없음 '기타' G77)
VisitRecord 1 ──── 0..* MediaAttachment  (사진·메모 — 장소당 20장·클라 압축·오프라인 큐·부분 실패 격리 G75/G145)
Trip 1 ──── * ChangeLogEntry         (통합 diff 스키마 G132 — Plan-B·(후속)공동편집·어시스턴트 공용·append-only)
Trip 1 ──── 0..* GpsTrack            (날짜별 단순화 폴리라인 — 수집 U6·영속 M12·옵트인 D34/N2)
OfflineSyncRecord                    (오프라인 입력 동기화 봉투 — 레코드 단위 버전·충돌 G74·Δ6)

[M13 AI Reflection — 회고·요약·분석·공유 카드]
Trip 1 ──── 0..* Reflection          (당일 회고 — 초안/수정본 G78·부분 데이터·폴백)
Trip 1 ──── 0..1 TripSummary         (전체 여행 요약 — 지도 히어로·G72 혼합 이동거리)
Account 1 ──── 0..1 TravelStyleAnalysis  (스타일 분석 — 10곳 게이트 G76·정식/임시 미리보기)
(TripSummaryRef | DailyReflectionRef) ──── ShareCard  (SNS 공유 카드 — 3포맷·사진 유/무)

[CP4 입력 — U6 소유(본 유닛은 구독·소비)]
VisitChecked(start/complete/skip) · DayClosed · TripEnded · changelog diff(G132) · GPS 폴리라인

[CP3 참조 입력 — U5/M8 소유(회고 대조용·재정의 금지)]
Itinerary(plan 불변 스냅샷 / current 가변) + Slot(canonicalPoiId·계획 체류·시각)

[CP5 출력 — U8 M14 소비]
ReflectionReady(당일/전체 요약/스타일 분석)
```

### 2.2 VisitRecord — 실제 방문 기록 (M12, actual 영속 정본)

일정 슬롯 1건(또는 즉석 방문 1건)의 **실제 방문 기록(actual)**. M18(U6) VisitState가 발행하는 `VisitChecked` 이벤트를 소비해 생산·보관하며, 방문 시각·실제 체류·좌표를 계획(plan) 체류와 함께 저장한다. **상태 머신·전이 강제는 U6(M18) 소유**이고 본 엔티티는 **영속·수정·대조**만 소유한다(FD-U7-01·U6 INV-VISIT5). 도착 확정은 항상 사용자 탭 결과(자동 기록 없음 D23).

**속성**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| visitId | 식별자 | 필수 · 유니크 | — |
| tripId | 식별자(Trip 참조) | 필수 | 귀속 여행 |
| slotRef | 식별자(ItinerarySlot 참조) | 선택 | 대상 계획 슬롯. **NULL=즉석 방문**(§2.3) [G77] |
| poiSnapshotRef | 식별자(POI 스냅샷 참조) | 선택 | 방문 장소 정본 스냅샷. NULL=자유 텍스트 즉석 방문 [D13, G77] |
| freeText | 문자열 | 선택 | 즉석 자유 입력 장소명(좌표·카테고리 없음 → 분석 '기타'). NULL=POI 참조 기록 [G77] |
| visitStatus | 열거 {DONE, SKIPPED} | 필수 | 방문 완료/방문 안 함(스킵·취소) — CP4 전이 유형 파생 [D23] |
| arrivedAt | 시각(기기 시각) | 선택 | 도착(방문 시작) 시각 — 사용자 탭·**직접 수정 가능**. NULL=미도착 [D23] |
| departedAt | 시각 | 선택 | 방문 종료 시각. NULL=미완료. 다음 장소 체크로 추정 시 estimatedFlag=true [D23] |
| departedEstimatedFlag | 불리언 | 필수 · 기본 false | departedAt이 다음 장소 체크로 추정된 값인지(허위 정확성 방지) [D23] |
| actualStay | Duration | 파생 | `departedAt − arrivedAt`(둘 다 존재 시) — 계획 체류와 함께 보관·대조 [D23, D14] |
| coord | 좌표 | 선택 | 방문 좌표. **NULL=위치 미동의·GPS 불가**(좌표 없는 기록 정상 생성) [D34, PRD 09-3] |
| baseAttribution | 구조체 {stayRef?, date} | 필수 | 귀속 기준(날짜별 기준 숙소 참조·숙소 없는 날은 날짜만) [PRD 09-5] |
| syncState | 열거 {LOCAL, PENDING, SYNCED, CONFLICT} | 필수 · 기본 SYNCED | 오프라인 동기화 상태(§2.10) — LOCAL/PENDING은 클라 큐 [G74, Δ6] |
| recordVersion | 정수 | 필수 · 기본 1 | 레코드 단위 버전(충돌 비교 키·멱등) [G74] |
| recordedAt | 시각 | 필수 · 불변 | 원 발생 시각(오프라인 입력 시 클라 생성·보존 — 늦은 동기화 정합) [S8] |

**파생값(저장 안 함)**

| 파생값 | 계산 | 근거 |
|---|---|---|
| plannedStay | slotRef→계획 슬롯 체류(plan 파생) | actualStay 대조 기준(plan⊗actual) [D14] |
| diffKind | plan 대비 {MATCHED, SKIPPED(미방문), ADDED(추가·즉석), REORDERED(순서 변경)} | 계획-실제 비교 뷰 라벨(3계열 대조 US-E8-04) [D14, PRD 09-4] |
| categoryForStyle | poiSnapshot 카테고리(즉석 자유 입력은 '기타') | 스타일 분석 카테고리 분포 입력 [G76, G77] |

**불변식**

- **INV-REC1 (actual 영속 경계 — CP4)**: VisitRecord는 M18(U6) `VisitChecked` 이벤트로만 생산되며(사용자 탭 결과·자동 기록 없음 D23), 방문 상태 전이 강제는 U6 소유 — U7은 영속·수정·대조만. 종료 후 편집(`updateVisitRecord`)은 허용하되 **상태 재전이가 아니라 기록 편집**이다(C11) [FD-U7-01, U6 INV-VISIT5].
- **INV-REC2 (체류 결정성·추정 전파)**: actualStay = departedAt − arrivedAt은 동일 (arrivedAt, departedAt) 입력에 결정적 산출 — departedAt이 다음 장소 체크 추정이면 departedEstimatedFlag=true로 전파(허위 정확성 금지). arrivedAt 부재 시 actualStay 미산출(NULL) [D23, U6 INV-VISIT3, PBT U7-P2].
- **INV-REC3 (plan/actual 분리 보관 — D14)**: actual(실제)과 plan(계획 스냅샷·U5 소유)은 **별개 계열로 저장**되고 회고·비교는 plan⊗actual 대조로만 산출 — actual 기록이 plan 스냅샷을 변형하지 않는다(plan 불변, U5 INV-PLAN1 소비) [D14, ADR-0013, FD-U7-02].
- **INV-REC4 (수정 가능·감사)**: arrivedAt·visitStatus 등 사용자 수정은 항상 허용(자동 기록값 포함)되며, 일정을 변경하는 편집은 없으므로 changelog 대상 아님 — 방문 기록 수정은 actual 계열 내 갱신이다 [D23, PRD 09-1].
- **INV-REC5 (좌표 선택성)**: coord는 GPS 옵트인·권한 충족 시에만 채워지며, 부재 시에도 방문 기록은 정상 생성 — 위치 미동의가 기록 생성을 막지 않는다(수동 체크인 기본 수단) [D34, PRD 09-3].

### 2.3 ImpromptuVisit — 즉석 방문 (M12, VisitRecord 특수화 G77)

계획에 없던 장소의 즉석 방문 기록. VisitRecord의 특수화로 `slotRef=NULL`이며 POI 검색(좌표·카테고리 있는 스냅샷) 또는 자유 텍스트(좌표·카테고리 없음) 두 경로를 허용한다. 별도 테이블이 아니라 VisitRecord의 변형(slotRef·poiSnapshotRef·freeText 조합)으로 표현한다.

| 변형 | slotRef | poiSnapshotRef | freeText | 스타일 분석 카테고리 |
|---|---|---|---|---|
| 계획 방문 | 필수 | 필수(슬롯 POI) | NULL | POI 카테고리 |
| 즉석 방문(POI 검색) | NULL | 필수(검색 POI) | NULL | POI 카테고리 |
| 즉석 방문(자유 텍스트) | NULL | NULL | 필수 | **'기타'**(좌표·카테고리 없음) |

**불변식**

- **INV-IMP1 (즉석 방문 슬롯 부재)**: ImpromptuVisit는 slotRef=NULL로만 존재하며 plan 대비 `diffKind=ADDED`로 대조에 노출 — 계획에 없던 방문이 침묵 누락되지 않는다 [G77, PRD 09-1·4].
- **INV-IMP2 (자유 입력 좌표·카테고리 부재)**: freeText 즉석 방문은 좌표·카테고리 없이 저장되고 스타일 분석에서 **'기타'로 처리** — 자유 입력에 허위 좌표·카테고리를 조작하지 않는다 [G77].
- **INV-IMP3 (동일 파이프라인)**: 즉석 방문도 사진·메모·오프라인 큐·귀속에서 계획 방문과 동일 규칙 — 특수화는 슬롯 부재만 [G77].

### 2.4 MediaAttachment — 사진·메모 첨부 (M12, 부분 실패 격리)

방문 기록에 첨부되는 사진(Photo)·메모(Memo). 사진은 클라이언트 압축 후 업로드하고 서버 썸네일을 생성하며 원본은 기기에 보관한다. **사진 업로드는 방문 체크·메모와 부분 실패 격리**(사진 실패가 메모·체크 저장을 막지 않음).

**Photo — 사진**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| photoId | 식별자 | 필수 · 유니크 | — |
| visitId | 식별자(VisitRecord 참조) | 필수 | 귀속 방문(장소당 **최대 20장** — remote config) [G75/G145] |
| storageKey | 문자열 | 선택 | 오브젝트 스토리지 키. NULL=업로드 미완료(로컬 보관) [G168] |
| thumbnailKey | 문자열 | 선택 | 서버 생성 썸네일 키. NULL=업로드 미완료 [G75] |
| takenAt | 시각 | 필수 | 촬영/저장 시각(장소와 함께 저장) [PRD 09-2] |
| sizeMeta | 구조체 {width, height, bytes} | 필수 | 압축 결과 메타(**클라 압축 장당 5MB·긴 변 2048px**) [G75/G145] |
| exifStripped | 불리언 | 필수 · 기본 true | **클라 압축 시 EXIF(위치 포함) 제거 완료** 여부 [G75/G145, D34] |
| uploadState | 열거 {LOCAL, QUEUED, RETRYING, FAILED, DONE} | 필수 · 기본 LOCAL | 업로드 생애 — 재시도 ≤3회 [PRD 09-2 예외] |
| retryCount | 정수 | 필수 · 기본 0 | 재시도 누적(상한 3 — 초과 시 FAILED) [PRD 09-2] |

**Memo — 메모**

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| memoId | 식별자 | 필수 · 유니크 | — |
| visitId | 식별자(VisitRecord 참조) | 필수 | 귀속 방문 |
| text | 문자열 | 필수 | 자유 텍스트 메모 [PRD 09-2] |
| editedAt | 시각 | 필수 | 최종 편집 시각 |
| syncState | 열거 {LOCAL, PENDING, SYNCED, CONFLICT} | 필수 · 기본 SYNCED | 오프라인 동기화 상태(추가는 합집합 병합) [G74] |

**사진 업로드 상태 머신 (uploadState)**

```text
   LOCAL(기기 보관·압축 완료·EXIF 제거)
     │ 네트워크 가용 → 업로드 시도
     ▼
   QUEUED ──(업로드 성공)──▶ DONE(storageKey·thumbnailKey 확정)
     │  └──(실패)──▶ RETRYING(retryCount++·지수 백오프)
     ▼                          │
   RETRYING ──(성공)──▶ DONE     │ retryCount > 3
     └──────────────────────────▶ FAILED('업로드 실패, 다시 시도' 버튼·수동 재시도)
   FAILED ──(사용자 수동 재시도)──▶ QUEUED
```

**불변식**

- **INV-MEDIA1 (부분 실패 격리)**: 사진 업로드 실패는 **메모·방문 체크 저장을 막지 않는다** — 사진은 로컬 보관 + 큐 잔류('업로드 대기'), 메모·체크는 독립 저장 [PRD 09-2 예외, PBT U7-P4].
- **INV-MEDIA2 (재시도 멱등·상한)**: 동일 사진 재시도는 최대 3회까지 자동, 각 재시도는 멱등(중복 업로드·중복 레코드 0)이며 3회 초과 시 FAILED(수동 재시도 버튼) — 성공 시 DONE 종결 [PRD 09-2, PBT U7-P4].
- **INV-MEDIA3 (EXIF 제거 — 위치 경계)**: 사진은 클라 압축 시 EXIF(위치 포함) 제거 후 업로드(exifStripped=true) — 위치 데이터는 GPS 옵트인 경로(§2.9)로만 별도 관리(사진 메타에 위치 은닉 금지 D34). 커뮤니티 게시 시 추가 EXIF GPS 제거는 U10(G185) 소관 [G75/G145, D34, FD-U7-05].
- **INV-MEDIA4 (장소당 상한)**: 한 방문(visitId)당 사진은 최대 20장(remote config) — 초과 첨부는 차단(사유 안내) [G75/G145].
- **INV-MEDIA5 (원본 기기 보관)**: 서버는 압축본·썸네일만 보존하고 원본은 기기에 보관 — 서버 부담 축소·원본 재업로드는 사용자 기기에서만 [G75/G145].

### 2.5 ChangeLogEntry — 변경 이력 통합 diff (M12, G132 보관 정본)

여행의 **일정 변경 이력**을 항목 단위 diff로 보관하는 **통합 스키마(G132)의 정본**. Plan-B(U6)·(후속) 공동편집(M17)·어시스턴트(M16)가 발행하는 모든 일정 변경을 하나의 스키마로 수용한다. **append-only**이며 스냅샷은 diff 누적 재구성으로 산출한다(current 대조 원장). U7이 보관·열람·재생을 소유하고, U6은 CP4로 diff를 **생산**(보관·열람 아님).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| changeLogId | 식별자 | 필수 · 유니크 | — |
| tripId | 식별자(Trip 참조) | 필수 | 귀속 여행 |
| targetRef | 식별자(ItinerarySlot 참조) | 필수 | 변경 대상 슬롯(항목 단위 diff) [G132] |
| actor | 구조체 {kind, ref} | 필수 · kind∈{USER, SYSTEM} | 행위자(변경자 닉네임·시스템) [G132, PRD 07-9] |
| sourceType | 열거 {PLAN_B, MANUAL, CO_EDIT, ASSISTANT} | 필수 | 출처 유형 — **PLAN_B·MANUAL은 1차, CO_EDIT·ASSISTANT는 후속 예약 enum**(스키마 변경 없이 편입) [G132, INV-CLOG3] |
| reason | 문자열 | 선택 | 변경 사유(휴무·날씨·이동 지연 등). NULL=사유 없음 [PRD 07-9, PRD 09-4] |
| beforeValue | 구조체 {poiInternalId?, time?, order?} | 선택 | 변경 전 값(POI는 **내부 ID 참조** — 스냅샷 아님). NULL=신규 추가 [G132] |
| afterValue | 구조체 {poiInternalId?, time?, order?} | 선택 | 변경 후 값. NULL=삭제 [G132] |
| at | 시각 | 필수 · 불변 | 발생 시각(순서 재구성 키) [G132] |
| schemaVersion | 정수 | 필수 | 스키마 버전(전방 호환 — U7 리스크 완화분) [CP4, G132] |
| causeMessageRef | 식별자(대화 메시지 참조) | 선택 | (후속 G13) 유발 어시스턴트 메시지 단방향 참조. 1차 NULL [G13] |

**파생값**: `reconstructedSnapshot` = 확정 시점 기준 + at 오름차순 diff 누적 적용 → current 대조·회고 변경 요약(재구성 = current 스냅샷 동등, INV-CLOG1).

**불변식**

- **INV-CLOG1 (diff 누적 재구성 = current 동등성 — 1급 속성)**: 확정 시점 기준(plan)에 changelog diff 시퀀스를 at 오름차순으로 누적 적용한 재구성 결과는 **current 스냅샷과 일치**한다 — 임의 변경 시퀀스에 대해 재생 결과 = current(라운드트립). CP4로 U6이 생산한 실데이터로 통합 검증한다 [G132, CP4 시나리오 3, PBT U7-P1].
- **INV-CLOG2 (append-only·불변)**: ChangeLogEntry는 추가 전용 — 기존 항목의 수정·삭제 없음. at·beforeValue·afterValue는 생성 후 불변(감사 무결성) [G132, SECURITY-14 정합].
- **INV-CLOG3 (출처 유형 전방 호환)**: sourceType enum은 CO_EDIT·ASSISTANT를 **예약**하고 schemaVersion으로 전방 호환 — U9(어시스턴트)·U11(공동편집) 편입 시 스키마 변경 0(U10 공개 이력 공용) [G132, CP4 계약 변경 통제].
- **INV-CLOG4 (POI 내부 ID 참조)**: before/afterValue의 POI는 내부 ID 참조로 저장(스냅샷 복제 아님) — 재구성 시 POI 정본을 조회해 해석(공개 스냅샷·마스킹은 U10 소관) [G132, PRD 09-4].
- **INV-CLOG5 (생산·보관 경계 — CP4)**: U6(M18·M10)이 CP4로 diff를 **생산**하고, U7(M12)이 보관·열람·재생을 소유 — 이 분업이 CP4의 핵심(U6 재계획 확정 TX에서 발행, U7이 구독·영속) [CP4, U6 INV-REPLAN2].

### 2.6 Reflection — 회고 (M13, 초안/수정본 G78)

**당일 회고**(DayClosed 트리거)의 초안·수정본. 방문·사진·메모·changelog를 근거로 C1(상위 티어)이 초안을 생성하고, 사용자가 수정하면 수정본을 원본과 **별도 저장**해 최종 표시본으로 사용한다. LLM 실패 시 기본 카드로 폴백한다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| reflectionId | 식별자 | 필수 · 유니크 | — |
| tripId | 식별자(Trip 참조) | 필수 | 귀속 여행 |
| date | 날짜 | 필수 · 유니크(여행 내) | 대상 일자(당일 회고 1일 1건) [PRD 09-6] |
| draftContent | 텍스트 | 선택 | AI 생성 **원본 초안**. NULL=생성 실패·폴백 상태 [PRD 09-6] |
| editedContent | 텍스트 | 선택 | 사용자 **수정본**(원본과 별도). NULL=미수정 — 존재 시 최종 표시본(INV-REFL1) [G78] |
| basis | 구조체 {visitCount, distanceKm, photoCount, majorChanges, missingItems} | 필수 | 입력 데이터 요약 + **누락 명시**('사진 없음'·'위치 기록 없음') [PRD 09-6 예외] |
| status | 열거 {GENERATED, FALLBACK_CARD, EDITED, NO_ACTIVITY} | 필수 | 회고 상태 [ADR-0011] |

**파생값**: `displayContent` = editedContent 존재 시 editedContent, 아니면 draftContent, 둘 다 NULL이면 기본 카드(basis) — 최종 표시본 선택(수정본 우선 INV-REFL1).

**회고 상태 전이 (status)**

```text
   [DayClosed 트리거 → M13.generateDailyReflection]
     │
     ├─ 기록 0건 ──▶ NO_ACTIVITY('오늘 기록된 활동이 없습니다'·수동 기록 유도)
     ├─ C1 성공 ──▶ GENERATED(draftContent·basis)
     └─ C1 실패/타임아웃 ──▶ FALLBACK_CARD(통계만·basis·LLM 문구 없음)
   GENERATED / FALLBACK_CARD ──(사용자 편집 editReflection)──▶ EDITED(editedContent 별도 저장)
   GENERATED / EDITED ──(regenerateReflection)──▶ [수정본 존재 시 OverwriteWarning → 확인 후에만 교체 G78]
```

**불변식**

- **INV-REFL1 (수정본 별도·우선 보존)**: editedContent는 draftContent와 **별도 저장**되고 존재 시 최종 표시본이다 — 재생성이 수정본을 덮어쓰려면 `overwriteConfirmed`(덮어쓰기 경고 확인)가 필수(G78). 확인 없는 재생성은 수정본을 보존한다 [G78, PBT U7-P8].
- **INV-REFL2 (폴백 침묵 금지)**: C1 실패·타임아웃 시 빈 화면 대신 **기본 카드('방문 N곳·이동 Nkm·사진 N장')**를 제공하고, 사용자는 기본 카드 위에 직접 작성할 수 있다(status=FALLBACK_CARD→EDITED) [ADR-0011, PRD 09-6·7].
- **INV-REFL3 (부분 데이터 누락 명시)**: 가용 데이터만으로 생성하고 생성 불가 항목(사진 0장→사진 하이라이트·위치 없음→지도 경로)은 제외하되 basis.missingItems에 **누락을 명시**('사진 없음'·'위치 기록 없음') — 누락을 침묵하지 않는다 [PRD 09-6 예외].
- **INV-REFL4 (오프라인 생성 보류)**: 오프라인 구간에서는 당일 회고 자동 생성을 보류하고 복구 후 생성하거나 기본 카드로 대체 — 생성은 온라인 전제 [Δ6, PRD 09-12 예외].
- **INV-REFL5 (종료 후 수동 재생성만 — C11)**: 여행 종료 후 기록 편집분의 회고 반영은 사용자 수동 '다시 생성'으로만 갱신되고 자동 갱신은 없다 [C11, INV-REFL1].

### 2.7 TripSummary — 전체 여행 요약 (M13, TripEnded 트리거)

여행 종료(`TripEnded`) 시 생성되는 **전체 요약**. 지도 히어로(방문 순서 핀·날짜별 동선·기준 숙소 마커)를 중심으로 총계와 날짜별 하이라이트를 구성한다. 이동 거리는 GPS 동의 구간 실측 + 미동의 구간 추정을 혼합 합산한다(G72).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip 참조) | 필수 · 유니크 | 귀속 여행(여행당 1건) |
| stats | 구조체 {visitCount, totalDistanceKm, photoCount} | 필수 | 총 방문 수·**총 이동 거리(G72 혼합·추정 표기)**·총 사진 수 [PRD 09-8, G72] |
| dailyHighlights | 목록<{date, highlight}> | 필수 | 날짜별 하이라이트 [PRD 09-8] |
| mapHeroSpec | 구조체 {orderedPins, dailyRoutes, stayMarkers, routeMode} | 필수 | 지도 히어로 스펙 — routeMode∈{GPS_ACTUAL, MANUAL_LINKED} 구간별(동의=실측·미동의=체크인 연결) [PRD 09-8, D34] |
| status | 열거 {GENERATED, FALLBACK, MAP_UNAVAILABLE} | 필수 | 생성/폴백(날짜별 기본 카드 모음)/지도 대체(방문 목록) [ADR-0011] |

**불변식**

- **INV-SUM1 (종료 트리거 유일·멱등)**: TripSummary는 `TripEnded`(자동 익일 00:00·수동 버튼 D19/Δ4)로만 생성되며, M13의 (tripId, kind) 핸들러는 기존 요약 존재 시 skip(이벤트 중복 수신 안전) [D19/Δ4, services S4].
- **INV-SUM2 (이동 거리 혼합·추정 표기)**: totalDistanceKm은 GPS 동의 구간 실측 폴리라인 합산 + 미동의 구간 장소 간 거리 추정의 혼합 합산이며 **추정치임을 표기**한다(구간 분할·순서 불변에 결정적) [G72, G59, PBT U7-P5].
- **INV-SUM3 (지도·폴백 계단)**: 위치 데이터 전무 시 지도 대신 방문 목록(순서·날짜)으로 대체(MAP_UNAVAILABLE)하고, 요약 생성 실패 시 날짜별 기본 카드 모음 폴백(FALLBACK) — 어떤 경로도 빈 화면 없음 [PRD 09-8 예외, ADR-0011].
- **INV-SUM4 (종료 후 수동 재생성 — C11)**: 종료 후 기록 편집분 반영은 `regenerateTripSummary` 수동 재생성으로만(자동 갱신 없음) [C11].

### 2.8 TravelStyleAnalysis — 여행 스타일 분석 (M13, 10곳 게이트 G76)

계정 누적 방문 패턴 기반 **스타일 분석**. **누적 방문 장소 수 ≥ 10곳 단일 게이트**로 판정하며, 미달 시 온보딩 취향 기반 임시 미리보기(정식 아님 명시) + 진행 게이지를 노출한다. 분류는 온보딩 취향 7종 축 매핑 자체 택소노미.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| accountId | 식별자(Account 참조) | 필수 · 유니크 | 귀속 계정(계정 단위 누적 분석) |
| metrics | 구조체 {categoryDistribution, avgStay, travelRadius, activityDensity} | 선택 | 카테고리 분포·평균 체류·이동 반경·활동 밀도. NULL=게이트 미달(임시 미리보기) [PRD 09-9] |
| basedOnVisitCount | 정수 | 필수 | 근거 누적 방문 장소 수(게이트 판정 카운트) [PRD 09-9] |
| mode | 열거 {OFFICIAL, PREVIEW} | 필수 | OFFICIAL(≥10곳 정식)·PREVIEW(<10곳 온보딩 취향 기반 임시) [G76] |
| taxonomyAxis | 열거<취향 7종 축> | 필수 | 온보딩 취향 7종 축 매핑(임시 미리보기와 스키마 공유) [G76] |
| updatedAt | 시각 | 필수 | 최종 분석 시점 |

**불변식**

- **INV-STYLE1 (10곳 단일 게이트·단조)**: 정식 분석(mode=OFFICIAL)은 basedOnVisitCount ≥ 10에서만 생성되고, 미달 시 PREVIEW(임시 미리보기·정식 아님 명시) + 진행 게이지('N/10곳')를 반환한다. 게이트는 방문 수에 대해 **단조**(방문 수 증가가 게이트 통과를 뒤집지 않음) [PRD 09-9, G76, PBT U7-P7].
- **INV-STYLE2 (방문 수 기준 우선)**: '완료 여행 N건' 표현은 안내용 환산일 뿐이며, 실제 트리거 조건은 항상 누적 방문 장소 수 기준이다(충돌 시 방문 수 우선) [PRD 09-9, FD-U7-08].
- **INV-STYLE3 (근거 동반·자체 택소노미)**: 분석은 구체 수치·카테고리로 제시하고 근거 방문 데이터를 동반하며, 분류는 취향 7종 축 매핑 자체 택소노미(임시 미리보기와 스키마 공유)를 사용한다 — 즉석 자유 입력은 '기타' [PRD 09-9, G76, G77].

### 2.9 GpsTrack — GPS 발자취 (M12, 영속 정본·수집 U6)

계획 동선 vs 실제 경로 비교의 원천. **수집·단순화는 U6**(포그라운드 저빈도·원시 좌표 파기), **기록 귀속·영속·경로 비교 데이터는 M12(U7)**(CP4 소비). GPS 기록 옵트인 전제이며 철회·탈퇴 시 즉시 파기한다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip 참조) | 필수 | 귀속 여행 |
| date | 날짜 | 필수 · 유니크(여행 내) | 수집 일자(날짜별 귀속) |
| simplifiedPolyline | 폴리라인(단순화) | 필수 · 불변 | **단순화 폴리라인만 보존**(원시 좌표 파기 후 — 수집 U6) [G55/G73] |
| consentRef | 식별자(ConsentRecord 참조) | 필수 | GPS 기록 옵트인 동의 참조 — 미동의 귀속 불가 [D34/N2] |

**파생 표시값**: cumulativeDistance(누적 실제 이동 거리·추정), estimatedSteps(걸음 수=GPS 거리 환산 추정 G59) — 둘 다 **추정 표기 강제**.

**불변식**

- **INV-GPS1 (영속·귀속 경계 — CP4)**: U6은 수집·폴리라인 생산까지, **기록 귀속·경로 비교·영속 정본은 M12(U7)** — CP4로 공급된 폴리라인을 날짜·여행에 귀속한다 [CP4, U6 INV-GPS5, FD-U7-10].
- **INV-GPS2 (옵트인 철회 즉시 파기 — N2)**: 옵트인 철회·계정 탈퇴 시 GpsTrack·위치 파생 데이터는 **즉시 파기**(30일 유예 없음 D34, `purgeLocationData`) — 단 법정 로그(수집·이용 사실)는 분리 보관 유지(앱은 자기 로그 삭제 권한 없음) [D34/N2, S6.2].
- **INV-GPS3 (경로 비교 폴백)**: 옵트인/권한 없는 구간은 실제 경로 레이어 `disabled(reason)`로 계획 동선만 제공하고, 위치 데이터 전무 시 방문 목록으로 대체(INV-SUM3 정합) — 미동의 구간은 수동 체크인 장소 순서 연결 [D34, PRD 09-8].

### 2.10 OfflineSyncRecord — 오프라인 동기화 봉투 (M12, 충돌 G74)

여행 중 오프라인 상태에서 기기 로컬에 저장된 **기록 입력**(방문 체크·사진 메타·메모·수동 체크인)의 동기화 봉투. 레코드 단위 버전 비교로 충돌을 판정하며, **배치 전체 원자성은 의도적으로 없다**(레코드별 독립 커밋·부분 성공 허용). 사진·메모 추가는 합집합 병합(충돌 아님), 상태 필드만 충돌 대상.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| recordId | 식별자(클라 생성 UUID) | 필수 · 유니크 | 레코드 멱등 키(이미 적용된 레코드 skip) [S8] |
| kind | 열거 {VISIT_CHECK, PHOTO_META, MEMO, MANUAL_CHECKIN} | 필수 | 입력 유형 [PRD 09-12] |
| recordedAt | 시각 | 필수 · 불변 | 원 발생 시각(늦은 동기화 시 M9 트리거 평가 제외 임계) [S8] |
| baseVersion | 정수 | 필수 | 기준 서버 버전(충돌 비교) [G74] |
| syncState | 열거 {LOCAL, PENDING, SYNCED, CONFLICT} | 필수 · 기본 LOCAL | 동기화 생애 [Δ6] |
| payload | 구조체 | 필수 | 유형별 입력 페이로드(직렬화 왕복 대상) [S8] |

**충돌 판정·해소**

| 상황 | 처리 | 근거 |
|---|---|---|
| recordId 이미 적용 | skip(멱등) | INV-SYNC1 [S8] |
| 서버 측 변경 없음 | 적용 + `VisitChecked`(syncedFromOffline=true, recordedAt 원 시각 보존) | S8 3단계 |
| 서버 측 변경 존재(상태·시각 충돌) | conflict 목록 반환 → 사용자 항목별 선택(KeepLocal/KeepServer) | G74 [PRD 09-12] |
| 사진·메모 **추가** | 합집합 자동 병합(충돌 아님) | INV-SYNC2 [G74] |

**동기화 상태 (syncState)**

```text
   LOCAL(오프라인 로컬 큐·'동기화 대기') ──재연결──▶ PENDING(배치 업로드)
     PENDING ──(충돌 없음·멱등 적용)──▶ SYNCED
     PENDING ──(상태·시각 충돌)──▶ CONFLICT ──(사용자 항목별 선택·재제출)──▶ SYNCED
```

**불변식**

- **INV-SYNC1 (레코드 멱등·독립 커밋)**: recordId 기준 이미 적용된 레코드는 skip(멱등)되고, 배치는 레코드별 독립 TX로 부분 성공을 허용한다(전체 원자성 의도적 부재) — 응답에 per-record 결과(applied/conflict/failed) [S8, PBT U7-P3].
- **INV-SYNC2 (합집합 병합·무손실)**: 사진·메모 **추가**는 충돌 없이 합집합 병합되고, 상태 필드(완료/스킵·시각)만 충돌 대상이다 — 어떤 해소 경로도 데이터 무손실(양쪽 보존·임의 폐기 금지) [G74, PBT U7-P3].
- **INV-SYNC3 (해소 결정성·교환법칙)**: 동일 충돌 집합에 대해 사용자 선택(KeepLocal/KeepServer)이 같으면 결과가 결정적이고, 독립 레코드의 동기화 순서를 바꿔도 최종 수렴 상태가 동일하다(병합 교환법칙) [G74, PBT U7-P3].
- **INV-SYNC4 (입력 한정·조회 미보장)**: 오프라인 보장은 기록 '입력'에 한정한다 — 일정 '조회'는 온라인 전제(D24)로 오류·재시도 안내만. 조회 오프라인 캐시 없음 [D24/Δ6, PRD 09-12].
- **INV-SYNC5 (늦은 동기화 오발화 방지)**: recordedAt이 현재 시각 임계를 초과한(뒤늦은) 동기화는 `VisitChecked` 발행 시 M9 트리거 평가에서 제외한다(과거 기록의 재계획 오발화 방지) [S8, U6 INV-TRIG 정합].

### 2.11 ShareCard — SNS 공유 카드 (M13, 3포맷)

전체 요약·당일 회고를 **SNS 공유용 정적 이미지 카드**로 구성한다. 대표 사진·제목·기간·핵심 통계·동선·워터마크를 자동 구성하며 3포맷을 지원하고 사진 0장 시 지도·통계 레이아웃으로 대체한다. **외부 SNS로 내보내는 정적 이미지 채널**(커뮤니티 앱 내부 동선 공개와 병렬·별개).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| source | 참조 {TripSummaryRef \| DailyReflectionRef} | 필수 | 공유 원천(전체 요약 또는 당일 회고) [PRD 09-13] |
| format | 열거 {STORY_9_16, SQUARE_1_1, FEED_4_5} | 필수 | 카드 포맷 [PRD 09-13] |
| caption | 문자열 | 선택 | 캡션(편집 가능·금칙어 검증 C3) [PRD 09-13, C3] |
| hashtags | 목록<문자열> | 선택 | 해시태그(편집 가능) [PRD 09-13] |
| layoutVariant | 열거 {WITH_PHOTO, NO_PHOTO} | 필수 | 사진 유/무 레이아웃 — 사진 0장은 지도·통계 기반 [PRD 09-13 예외] |

**불변식**

- **INV-SHARE1 (생성 전제)**: 공유 카드는 여행 종료·요약 생성 후에만 진입 가능 — 미종료/요약 미생성이면 진입점 비활성(`PreconditionFailed`) [PRD 09-13 예외].
- **INV-SHARE2 (사진 0장 폴백)**: 대표 사진이 없으면(사진 0장) 지도 경로·통계 기반 '사진 없는 카드' 레이아웃으로 자동 대체(NO_PHOTO) — 빈 카드 없음 [PRD 09-13 예외].
- **INV-SHARE3 (외부 채널 경계·통계만)**: 공유 카드는 외부 SNS 내보내기용 정적 이미지이며 거리 통계만 표기(소요시간 없음 D25) — 앱 내부 동선 공개(커뮤니티 U10)와 별개 채널. 캡션은 금칙어 검증 [PRD 09-13, D25, C3].

### 2.12 CP4 소비 참조 계약 (U6 → U7 입력) — actual·changelog·GPS

U7은 U6(M18·M10)이 CP4로 발행하는 이벤트·객체를 구독해 actual·회고·기록을 생산한다(스키마 정본은 U6, 본 유닛 재정의 금지). `common/core` 이벤트 버스(U1 계약) 위에서 동작한다.

| 입력 이벤트/객체(U6 소유) | U7 소비 용도 | 소비 시 처리 |
|---|---|---|
| `VisitChecked`(start/complete/skip·slotRef·canonicalPoiId·도착 시각·전이 유형·실제 체류·departedEstimatedFlag) | actual 방문 기록(VisitRecord) 생산·보관·plan 대조 | 멱등 생산(syncedFromOffline 정합)·체류 결정성 승계(INV-REC1·2) [CP4, D23] |
| `DayClosed`(여행·일자·당일 방문 요약) | 당일 회고 초안 자동 생성 트리거(M13) | (tripId, date) 멱등 생성·오프라인 보류(INV-REFL4) [CP4] |
| `TripEnded`(여행·종료 방식·종료 시각) | 전체 요약·스타일 분석 트리거 | (tripId, kind) 멱등 skip·자동/수동 각각 도달(INV-SUM1) [CP4, D19/Δ4] |
| changelog diff(G132 통합 스키마) | changelog 보관·열람·재생(재구성 대조) | append-only 영속·재구성=current 동등(INV-CLOG1·5) [CP4, G132] |
| GPS 폴리라인(단순화·원시 파기·consentRef) | GpsTrack 귀속·경로 비교 데이터 | 날짜·여행 귀속·철회 시 파기 연동(INV-GPS1·2) [CP4, D34] |

**검증 방법 — 통합 테스트 시나리오(CP4)**

1. **actual 생산 파이프라인**: 방문 완료 체크(U6) → `VisitChecked` 발행 → U7 actual 방문 기록 생성 → plan/actual/changelog 3계열 대조(US-E8-04) 정확 표시.
2. **회고 트리거 연쇄**: `TripEnded`(자동·수동 각각) 수신 시 전체 요약 생성 기동, LLM 실패 시 기본 카드 폴백까지 도달(침묵 실패 금지).
3. **changelog 재생 동등성**: U6 재계획 생산 changelog diff 시퀀스를 U7이 순서대로 재생한 결과가 current 스냅샷과 일치(U7 PBT 1급 속성 U7-P1을 U6 실생산 데이터로 통합 검증).

> **계약 변경 통제**: changelog 통합 스키마(G132)는 후속 3유닛(U9·U10·U11) 공용 — schemaVersion 필드로 전방 호환, diff 재생 PBT(U7-P1)를 회귀 안전망으로.

### 2.13 CP5 공급 계약 (U7 → U8 출력) — 회고 완료 이벤트

U7 산출(회고·요약·분석)의 완료를 U8 알림이 소비한다. U7(M13)이 발행하고 U8(M14·S5)이 단일 구독·스케줄링한다.

| 이벤트/객체 | 필드(개요) | 경계 무결성 |
|---|---|---|
| `ReflectionReady` | 회고 유형(DAILY/TRIP_SUMMARY/STYLE_ANALYSIS), 여행·일자 참조, 대상 계정 — 회고 완료 알림 트리거 | INV-REFL2, INV-SUM1 |
| plan/actual/changelog 3계열 대조 데이터 | getTripTimeline(라벨 구분·차이 하이라이트) — U8 마이페이지·(후속)U10 공개 스냅샷의 소스 | INV-REC3, INV-CLOG1 |

> **제외(U8 소관)**: 회고 완료 알림 **발송**·마이페이지 통합·전체 아카이브 내보내기는 U8 소유. U7은 `ReflectionReady` 발행까지(FD-U7-11).

### 2.14 C1 재사용 계약 (U5 자산 — 계약 수준)

U7(M13)의 회고·요약·스타일 분석 LLM 호출은 전부 U5가 완성한 **C1 LLM Gateway(상위 티어)를 재사용**한다(중복 재구현 금지, FD-U7-06).

| 자산 | U7 재사용 용도 | 재사용 계약(입출력) | 폴백 소유 |
|---|---|---|---|
| C1 LLM Gateway | 당일 회고·전체 요약·(스타일 분석 서술) 생성 | `C1.call(reflection, serverContext)` 상위 티어(D11) · 서버 재조회 컨텍스트 주입(D31) · 출력 스키마 검증 | 실패·타임아웃 시 **M13 기본 카드 폴백**(통계만·침묵 실패 금지, ADR-0011) |

> **재사용 원칙(FD-U7-06)**: U7은 C1의 계약 인터페이스만 소비하고 LLM 게이트웨이·closed-set·계정 무결성(D31 서버 재조회)을 재구현하지 않는다 — 회고 LLM 입력은 서버 재조회로 요청자 권한 밖 데이터 구조적 미포함(U5 INV-SCORE4·SECURITY-11 재사용) [D11, D31, SECURITY-11].

### 2.15 엔티티-스토리 추적 요약

| 엔티티 | 주 근거 스토리 | 주 결정 |
|---|---|---|
| VisitRecord | US-E8-01, US-E8-04·05, US-E6-01 | D23, D14, CP4, C11 |
| ImpromptuVisit | US-E8-01 | G77 |
| MediaAttachment(Photo·Memo) | US-E8-02 | G75/G145, G168, D34 |
| ChangeLogEntry | US-E8-04, US-E7-09 | G57/G132, G13, CP4 |
| Reflection | US-E8-06·07·12 | G78, C11, ADR-0011, D11 |
| TripSummary | US-E8-08 | D19/Δ4, G72, D34, C11 |
| TravelStyleAnalysis | US-E8-09·10 | G76, G77 |
| GpsTrack | US-E8-03, US-E7-13 | G55/G73, D34/N2, G59, G72 |
| OfflineSyncRecord | US-E8-12 | G74, D24/Δ6, S8 |
| ShareCard | US-E8-13 | D25, C3 |

## 3. 비즈니스 규칙 (BR-U7-01 ~ 28)

> 규칙 ID `BR-U7-xx`는 본 유닛 전역 유일(코드·테스트·리뷰 추적 키). 각 규칙은 조건(언제 평가)/동작(무엇을)/위반 시 처리/근거로 구성한다. **소유 경계 표기**: actual·changelog는 M12(U7) 소유 정본, plan/current는 U5/M8 소유 참조 — `[소유 경계]`. changelog 재구성 정합(G132)은 `[하드 계열]`(회고 대조 무결성).

| 그룹 | 규칙 |
|---|---|
| A. 방문 기록·즉석 방문·귀속 | BR-U7-01 ~ 04 |
| B. changelog 통합 보관·재구성 | BR-U7-05 ~ 07 |
| C. 사진·미디어 파이프라인 | BR-U7-08 ~ 11 |
| D. 오프라인 동기화·충돌 해소 | BR-U7-12 ~ 14 |
| E. 회고 생성·수정·재생성 | BR-U7-15 ~ 19 |
| F. 전체 요약·스타일 분석·이동거리·개인화 | BR-U7-20 ~ 24 |
| G. 공유 카드·GPS 귀속·파기·캘린더 | BR-U7-25 ~ 28 |

### A. 방문 기록·즉석 방문·귀속

**BR-U7-01 방문 기록 생산·actual 영속 — CP4 소비·수정 가능 [소유 경계]**
- **조건**: U6 `VisitChecked`(start/complete/skip) 이벤트 수신 시.
- **동작**: 방문 체크 이벤트를 소비해 **actual 방문 기록(VisitRecord)을 생산·영속**한다(실제 시각 자동 기록·기기 시각). 실제 체류 시간 = 방문 완료 체크 시각 ~ 다음 장소 체크 시각으로 산출해 **계획(plan) 체류와 함께 보관**(plan/actual 구분 D14)한다. 방문 종료 시각이 다음 장소 체크로 추정되면 departedEstimatedFlag=true(허위 정확성 방지). 사용자는 자동 기록된 방문 시각을 **직접 수정**할 수 있다. **방문 상태 머신·전이 강제는 U6(M18) 소유**이며 U7은 영속·수정·대조만 소유한다(INV-REC1).
- **위반 시 처리**: U7이 방문 상태를 자동 확정(자동 기록 없음 D23 위반)·추정 종료 시각을 실측 위장·plan/actual 혼합 저장은 결함.
- **근거**: US-E8-01, US-E8-04, US-E6-01, PRD 09-1·4, D23, D14, CP4.

**BR-U7-02 실제 체류 시간·체류 초과 연결 [소유 경계]**
- **조건**: 방문 완료 기록(visitStatus=DONE) 저장 시.
- **동작**: actualStay(=departedAt−arrivedAt)를 결정적으로 산출해 계획 체류와 대조 보관하고, **체류 초과 판정 신호를 M9(U6)로 공급**한다(체류 초과·이동 지연 Plan-B 트리거 입력, Epic 7 일관). arrivedAt 부재 시 actualStay 미산출(NULL).
- **위반 시 처리**: 체류 측정 누락·체류 초과 신호 미공급은 결함(트리거 입력 누락).
- **근거**: US-E8-01, PRD 09-1, D23, INV-REC2.

**BR-U7-03 즉석 방문 입력 — POI 검색 + 자유 텍스트 (G77)**
- **조건**: 계획에 없던 장소를 즉석 방문으로 추가(`addImpromptuVisit`) 시.
- **동작**: 즉석 방문을 방문 기록에 저장한다 — **POI 검색**(좌표·카테고리 있는 스냅샷) 또는 **자유 텍스트**(좌표·카테고리 없이 저장) 두 경로 허용. 자유 입력 즉석 방문은 스타일 분석에서 **'기타'로 처리**한다(INV-IMP2). 즉석 방문은 slotRef=NULL로 저장되고 plan 대비 `diffKind=ADDED`로 대조에 노출된다.
- **위반 시 처리**: 자유 입력에 허위 좌표·카테고리 조작·즉석 방문 침묵 누락은 결함.
- **근거**: US-E8-01, PRD 09-1, G77.

**BR-U7-04 숙소·날짜 기준 기록 귀속**
- **조건**: 방문 기록 귀속(`getTripRecords`·저장) 시.
- **동작**: 등록 숙소(외부 예약 또는 앱 저장 후 등록)의 위치·체크인/체크아웃 날짜를 기준점으로 **그날의 방문 기록을 해당 숙소·날짜에 귀속**한다. 등록 숙소가 여러 곳(이동 숙박)이면 날짜별 기준 숙소를 구분해 귀속하고(M4.getBaseTimeline 기준), **숙소 없는 날(당일치기·이동일)은 숙소 없이 날짜만**을 기준으로 저장한다.
- **위반 시 처리**: 다중 숙소 날짜별 미구분·숙소 없는 날 귀속 실패는 결함.
- **근거**: US-E8-05, PRD 09-5, D15, G41.

### B. changelog 통합 보관·재구성

**BR-U7-05 changelog 통합 diff 스키마 보관 — append-only [하드 계열]**
- **조건**: U6/후속 유닛이 일정 변경 이력(`appendChangeLog`)을 발행 시.
- **동작**: 일정 변경을 **통합 diff 스키마(G132)**로 보관한다 — 항목 단위(대상 슬롯·행위자·**출처 유형**·사유·전/후 값·발생 시각·스키마 버전). POI는 **내부 ID 참조**(스냅샷 아님). **append-only**(기존 항목 수정·삭제 없음). 출처 유형 enum은 PLAN_B·MANUAL(1차) + CO_EDIT·ASSISTANT(후속 예약)를 수용하고 schemaVersion으로 전방 호환한다. U7이 **보관·열람·재생을 소유**하고 U6은 CP4로 diff를 **생산**만 한다(INV-CLOG5).
- **위반 시 처리**: 스키마 파편화(유형별 상이 스키마)·항목 사후 수정·전/후 값 누락·행위자 누락은 결함(감사 무결성).
- **근거**: US-E8-04, US-E7-09, PRD 07-9·09-4, G57/G132, CP4.

**BR-U7-06 changelog 재구성 = current 동등성 [하드 계열]**
- **조건**: 변경 이력 대조·회고 변경 요약 산출 시.
- **동작**: 확정 시점 기준(plan)에 changelog diff 시퀀스를 발생 시각 오름차순으로 누적 적용한 **재구성 결과가 current 스냅샷과 일치**해야 한다(INV-CLOG1). 이 동등성은 회고 대조(plan⊗actual⊗변경)의 무결성 전제이며, U6 재계획 생산분(CP4)으로 통합 검증한다.
- **위반 시 처리**: 재구성 불일치(재생 결과 ≠ current)는 **하드 결함**(회고 대조 무결성 붕괴) [PBT U7-P1].
- **근거**: US-E8-04, US-E7-09, G57/G132, CP4 시나리오 3, D14.

**BR-U7-07 changelog 출처 유형 전방 호환 — 후속 유닛 공용**
- **조건**: 출처 유형 enum 확장·스키마 진화 시.
- **동작**: sourceType enum에 CO_EDIT(공동편집)·ASSISTANT(어시스턴트)를 **예약**하고 schemaVersion 필드로 전방 호환을 확보한다 — U9(어시스턴트 변경)·U10(공개 이력)·U11(공동편집 이력)이 스키마 변경 없이 공용한다. (후속 G13) 유발 대화 메시지 ID는 단방향 참조 필드(causeMessageRef)로 예약.
- **위반 시 처리**: 유형 추가 시 파괴적 스키마 변경(버전 필드 미사용)은 결함(후속 3유닛 재작업 유발).
- **근거**: US-E8-04, G57/G132, G13, CP4 계약 변경 통제.

### C. 사진·미디어 파이프라인

**BR-U7-08 사진 첨부·클라 압축·EXIF 제거 (G75/G145)**
- **조건**: 방문 장소에 사진·메모 첨부(`attachMedia`) 시.
- **동작**: 한 장소에 사진 **여러 장(장소당 최대 20장)**과 자유 텍스트 메모를 함께 첨부한다. 사진은 **클라이언트에서 압축(장당 5MB·긴 변 2048px)**해 업로드하고 **서버 썸네일**을 생성하며 **원본은 기기에 보관**한다. 압축 시 **EXIF(위치 포함)를 제거**한다(exifStripped — 위치는 GPS 옵트인 경로로만 별도 관리 D34). 촬영/저장 시각과 첨부 장소를 함께 저장한다.
- **위반 시 처리**: 장소당 20장 초과 허용·원본 서버 저장·EXIF 위치 은닉·압축 누락은 결함(비용·법적 리스크).
- **근거**: US-E8-02, PRD 09-2, G75/G145, G168, D34.

**BR-U7-09 사진 업로드 실패·큐·재시도 3회 (부분 실패 격리)**
- **조건**: 사진 업로드가 네트워크/서버 오류로 실패 시.
- **동작**: 실패 사진을 **기기 로컬에 보관하고 '업로드 대기'로 표시**한 뒤 네트워크 복구 시 **자동 재시도(최대 3회·지수 백오프)**한다. 3회 실패 시 **'업로드 실패, 다시 시도' 버튼**을 노출한다. 각 재시도는 멱등(중복 업로드·중복 레코드 0), 성공 시 DONE으로 종결. **메모·방문 체크는 사진 업로드 실패와 무관하게 저장**한다(부분 실패 격리 INV-MEDIA1).
- **위반 시 처리**: 사진 실패로 메모·체크 저장 차단·재시도 미멱등(중복 업로드)·수동 재시도 미제공은 결함.
- **근거**: US-E8-02, PRD 09-2 예외, G75/G145, INV-MEDIA1·2.

**BR-U7-10 장소당 사진 상한·부분 첨부**
- **조건**: 사진 첨부 개수 검증 시.
- **동작**: 방문(visitId)당 사진 상한(기본 20장·remote config)을 강제하고 초과 첨부는 사유 안내와 함께 차단한다. `attachMedia` 결과는 `MediaResult{accepted, pending, rejected}`로 부분 결과를 명시(수용/대기/거부 구분)한다.
- **위반 시 처리**: 상한 미강제·부분 결과 침묵(전체 성공 위장)은 결함.
- **근거**: US-E8-02, G75/G145, INV-MEDIA4.

**BR-U7-11 메모 작성·독립 저장**
- **조건**: 자유 텍스트 메모 작성·수정 시.
- **동작**: 방문 장소에 자유 텍스트 메모를 작성·수정할 수 있고, 메모는 사진 업로드 상태와 **독립 저장**된다(부분 실패 격리). 메모 추가는 오프라인 동기화에서 합집합 병합 대상(BR-U7-13).
- **위반 시 처리**: 메모를 사진 실패에 종속 저장하는 것은 결함.
- **근거**: US-E8-02, PRD 09-2, G74.

### D. 오프라인 동기화·충돌 해소

**BR-U7-12 오프라인 입력 로컬 큐·입력 한정 (D24/Δ6)**
- **조건**: 여행 중 오프라인 상태에서 기록 입력(방문 체크·사진·메모·수동 체크인) 시.
- **동작**: 오프라인 상태에서도 방문 체크·사진 첨부·메모 작성·수동 체크인을 **기기 로컬 큐(shared/storage)에 저장**하고 '동기화 대기'로 표시한다. 레코드마다 클라 생성 UUID(recordId) + 원 발생 시각(recordedAt) + 베이스 버전을 부여한다. 네트워크 복구 시 서버와 자동 동기화(`syncOfflineRecords`)한다. **오프라인 보장은 기록 '입력'에 한정**하고 일정 '조회'는 온라인 전제(D24 — 오류·재시도 안내만, 조회 오프라인 캐시 없음).
- **위반 시 처리**: 오프라인 입력 유실·조회 오프라인 보장 오해(캐시 제공)는 결함.
- **근거**: US-E8-12, PRD 09-12, D24, Δ6, G74.

**BR-U7-13 충돌 해소 — 레코드 단위 버전·합집합 병합·무손실 (G74)**
- **조건**: 오프라인 입력과 서버 데이터 동기화 시.
- **동작**: 서버 병합은 **레코드 단위 독립 커밋**(배치 전체 원자성 의도적 부재)이며 recordId 기준 이미 적용된 레코드는 **skip(멱등)**한다. **버전 비교** — 충돌 없음이면 적용(`VisitChecked` syncedFromOffline=true·recordedAt 원 시각 보존), 서버 측 변경 존재(상태·시각 충돌)면 해당 레코드만 conflict 목록으로 반환한다. **사진·메모 추가는 합집합 자동 병합**(충돌 아님), **상태 필드(완료/스킵·시각)만 충돌 대상**. 충돌은 **두 버전을 사용자에게 제시해 항목별 선택**(KeepLocal/KeepServer)으로만 해소하며 **데이터 임의 폐기 금지**(어떤 경로도 무손실).
- **위반 시 처리**: 침묵 덮어쓰기·데이터 폐기·사진/메모 충돌 처리(합집합 아님)·비멱등 재적용은 결함 [PBT U7-P3].
- **근거**: US-E8-12, PRD 09-12, G74, D24/Δ6, S8.

**BR-U7-14 늦은 동기화 오발화 방지**
- **조건**: 오프라인 큐의 뒤늦은 레코드 동기화 시.
- **동작**: recordedAt이 현재 시각 임계를 초과한(과거) 레코드는 동기화 시 `VisitChecked`를 발행하되 **M9 트리거 평가에서 제외**한다 — 뒤늦은 동기화로 인한 재계획 오발화를 방지한다. actual 타임라인 반영은 원 시각(recordedAt)으로 유지한다.
- **위반 시 처리**: 과거 기록 동기화가 실시간 트리거를 오발화시키는 것은 결함.
- **근거**: US-E8-12, S8, INV-SYNC5.

### E. 회고 생성·수정·재생성

**BR-U7-15 당일 회고 초안 자동 생성 — DayClosed 트리거·C1 경유**
- **조건**: 일자 경계(`DayClosed`) 수신 시.
- **동작**: 방문 장소·사진·메모·변경 이력을 근거로 **당일 회고 초안을 자동 생성**(C1 상위 티어 경유)한다 — 방문 장소 수·이동 거리·첨부 사진 수·주요 변경 이력을 포함한다. 생성 완료 시 **`ReflectionReady` 발행**(M14 인앱 카드/푸시 알림 — 발송은 U8). (tripId, date) 멱등 생성.
- **위반 시 처리**: 일자 경계에 회고 미트리거·완료 알림 미발행은 결함.
- **근거**: US-E8-06, PRD 09-6, D11, CP4, CP5.

**BR-U7-16 회고 생성 실패·기본 카드 폴백 (ADR-0011)**
- **조건**: 회고 생성(C1 호출)이 실패·타임아웃 시.
- **동작**: 빈 화면 대신 **'방문 N곳·이동 Nkm·사진 N장' 기본 카드**(통계만·LLM 문구 없음, status=FALLBACK_CARD)를 제공한다. 사용자는 기본 카드 위에 **직접 회고를 작성**할 수 있다(침묵 실패 금지). 대체 산출의 소유자는 M13(C1은 실패를 명시적 타입으로 반환).
- **위반 시 처리**: 실패 시 빈 화면 방치·직접 작성 불가는 결함.
- **근거**: US-E8-06 예외, US-E8-07, PRD 09-6·7, ADR-0011, INV-REFL2.

**BR-U7-17 부분 데이터 회고 — 누락 명시**
- **조건**: 사진·위치 등 일부만 존재하는 부분 데이터로 회고 생성 시.
- **동작**: 가용 데이터(메모·방문 체크 기록)만으로 회고를 생성하고, 데이터가 없어 생성할 수 없는 항목(사진 0장→사진 하이라이트, 위치 없음→지도 경로)은 제외하되 **'사진 없음'·'위치 기록 없음'처럼 누락을 회고에 명시**한다. 당일 기록이 전혀 없으면 **'오늘 기록된 활동이 없습니다' 안내와 수동 기록 추가 버튼**(status=NO_ACTIVITY)을 노출한다.
- **위반 시 처리**: 누락 항목 침묵·데이터 전무 시 빈 화면은 결함.
- **근거**: US-E8-06 예외, PRD 09-6 예외, INV-REFL3.

**BR-U7-18 회고 수정·수정본 별도 저장 (G78)**
- **조건**: AI 회고 초안 수정·삭제·메모 덧붙임(`editReflection`) 시.
- **동작**: 사용자가 회고 초안 문구를 직접 수정·삭제하고 본인 메모를 덧붙일 수 있다. **수정한 회고는 원본 초안과 별도(editedContent) 저장**하고 **수정본을 최종 표시본**으로 사용한다(INV-REFL1). 폴백 카드 위 직접 작성도 허용한다.
- **위반 시 처리**: 수정본이 원본을 덮어쓰거나(별도 저장 아님) 수정본 미표시는 결함.
- **근거**: US-E8-07, PRD 09-7, G78.

**BR-U7-19 회고 재생성 — 덮어쓰기 경고 (G78) [하드 계열]**
- **조건**: 회고 재생성(`regenerateReflection`) 시.
- **동작**: 회고 재생성을 제공하되 **수정본이 존재하면 덮어쓰기 경고(`OverwriteWarning`)를 표시하고 사용자가 확인(`overwriteConfirmed`)한 경우에만 교체**한다(INV-REFL1). 확인 없는 재생성은 수정본을 보존한다. **여행 종료 후 기록 편집분의 회고 반영은 수동 '다시 생성'으로만**(자동 갱신 없음 C11).
- **위반 시 처리**: 수정본 무단 덮어쓰기·종료 후 자동 갱신은 결함(사용자 기록 유실) [PBT U7-P8].
- **근거**: US-E8-07, US-E8-11, PRD 09-7, G78, C11.

### F. 전체 요약·스타일 분석·이동거리·개인화

**BR-U7-20 전체 여행 요약 생성 — TripEnded 트리거·지도 히어로**
- **조건**: 여행 종료(`TripEnded`) 수신 시.
- **동작**: 날짜별 여행 기록·지도 기반 이동 경로·**전체 요약**을 생성한다 — 총 방문 장소 수·총 이동 거리·총 사진 수·날짜별 하이라이트를 포함하고 **지도 히어로(방문 순서 핀·날짜별 동선·기준 숙소 마커)** 중심으로 구성하며, 방문지마다 첨부 사진을 지도 핀 미리보기로 노출한다. 위치정보 동의 구간은 GPS 경로로, 미동의 구간은 수동 체크인 장소를 순서대로 연결한 경로로 표시한다. (tripId, kind) 멱등 skip(자동/수동 종료 각각 도달).
- **위반 시 처리**: 종료 트리거 외 생성·중복 요약·지도 히어로 미구성은 결함.
- **근거**: US-E8-08, PRD 09-8, D19/Δ4, D34, INV-SUM1.

**BR-U7-21 전체 요약 폴백 계단 — 지도 대체·기본 카드**
- **조건**: 위치 데이터 전무·요약 생성 실패 시.
- **동작**: 지도 경로에 필요한 위치 데이터가 전무하면 **지도 대신 방문 장소 목록(순서·날짜 포함)**으로 대체하고, 전체 요약 생성이 실패하면 **날짜별 기본 카드(방문 N곳·이동 Nkm·사진 N장) 모음 폴백**을 제공한다(빈 화면 없음).
- **위반 시 처리**: 위치 없음/생성 실패를 빈 화면으로 방치하는 것은 결함.
- **근거**: US-E8-08 예외, PRD 09-8 예외, ADR-0011, INV-SUM3.

**BR-U7-22 이동 거리 혼합 산출 (G72) — 추정 표기**
- **조건**: 총 이동 거리·걸음 수 산출 시.
- **동작**: 총 이동 거리는 **GPS 동의 구간=실측 폴리라인 합산 + 미동의 구간=장소 간 거리 추정**의 혼합 합산이다. **걸음 수는 GPS 이동 거리 환산 추정만**(추가 권한 없음 G59). 이동 거리·걸음 수 모두 **추정치임을 표기**한다(GPS 정확도·실내 구간 한계). 산출은 구간 분할·순서 불변에 결정적이다(INV-SUM2).
- **위반 시 처리**: 추정 미표기·혼합 산출 누락·비결정적 합산은 결함.
- **근거**: US-E8-08, PRD 09-8, G72, G59, ADR-0009.

**BR-U7-23 스타일 분석 10곳 게이트 (G76) — 임시 미리보기**
- **조건**: 여행 스타일 분석(`analyzeTravelStyle`) 조회 시.
- **동작**: 방문 카테고리 분포·평균 체류 시간·이동 반경·활동 밀도를 기반으로 스타일 분석을 생성한다. 분석 가능 임계치는 **누적 방문 장소 수 ≥ 10곳 단일 기준**('완료 여행 N건'은 안내용 환산일 뿐 — 충돌 시 방문 수 우선). 결과는 구체 수치·카테고리로 제시하고(예: '카페 비중 40%') 근거 방문 데이터를 동반하며, 분류는 **온보딩 취향 7종 축 매핑 자체 택소노미**(임시 미리보기와 스키마 공유)를 사용한다. 미달 시 **온보딩 취향 기반 임시 미리보기(정식 분석 아님 명시) + 진행 게이지('N/10곳')**를 노출한다. 게이트는 방문 수에 단조(비축소).
- **위반 시 처리**: 10곳 미달에 정식 분석 생성·임시 미리보기 미노출·완료 여행 수 기준 오적용은 결함.
- **근거**: US-E8-09, PRD 09-9, G76, INV-STYLE1·2.

**BR-U7-24 여행 기록 기반 개인화 — 동의 게이트**
- **조건**: 다음 여행 일정 생성·장소 추천 개인화 입력 활용 시.
- **동작**: 누적 여행 기록 데이터(방문 카테고리·선호 지역·체류 패턴)를 다음 여행의 개인화 입력으로 활용하고, 개인화에 사용하는 기록 데이터 항목·활용 목적을 **설정 화면에서 안내**한다. **사용자가 개인화 활용에 동의하지 않으면 과거 기록을 추천 입력에서 제외하고 기본 추천만** 제공한다. 개인화 우선순위는 사용자 직접 설정 값 > M13 자동 스타일 분석.
- **위반 시 처리**: 미동의 시 기록 활용·활용 목적 미안내는 결함.
- **근거**: US-E8-10, PRD 09-10, PRD 12-10.

### G. 공유 카드·GPS 귀속·파기·캘린더

**BR-U7-25 SNS 공유 카드 — 3포맷·사진 0장 폴백**
- **조건**: 전체 요약·당일 회고 화면에서 '공유'(`buildShareCard`) 시.
- **동작**: 전체 여행 요약(US-E8-08) 또는 당일 회고(US-E8-06) 화면의 '공유'에서 공유 카드로 진입해 **대표 사진·여행 제목·기간·핵심 통계(방문 수·총 이동 거리·사진 수)·주요 동선/하이라이트·TripPilot 워터마크**를 담은 카드를 자동 구성한다. **3포맷(9:16/1:1/4:5)**을 선택하고 캡션·해시태그를 편집(금칙어 검증 C3)할 수 있다. 카드를 기기 이미지 저장 또는 OS 공유 시트로 외부 SNS·메신저에 공유한다(외부 SNS 정적 이미지 채널 — 커뮤니티 앱 내부 동선 공개와 별개). **대표 사진이 없으면(사진 0장) 지도 경로·통계 기반 '사진 없는 카드'** 레이아웃으로 대체한다. **여행 미종료/요약 미생성이면 진입점 비활성/미노출**.
- **위반 시 처리**: 미종료 여행 공유 진입 허용·사진 0장 빈 카드·통계에 소요시간 표기(D25 위반)·캡션 금칙어 미검증은 결함.
- **근거**: US-E8-13, PRD 09-13, D25, C3, INV-SHARE1·2·3.

**BR-U7-26 GPS 발자취 귀속·경로 비교 — 추정 표기 [소유 경계]**
- **조건**: GPS 폴리라인(CP4) 수신·계획 vs 실제 경로 비교(`getRouteComparison`) 시.
- **동작**: U6이 CP4로 공급한 단순화 폴리라인을 **날짜·여행에 귀속**(영속 정본 M12)하고, 계획 동선 vs 실제 GPS 경로 비교 데이터를 제공한다 — **누적 실제 이동 거리·걸음 수(환산 추정)를 추정 표기**한다(G59). **옵트인/권한 없으면 실제 경로 레이어 `disabled(reason)`**(계획 동선만). 위치 데이터 전무 시 방문 목록으로 대체.
- **위반 시 처리**: 추정 미표기·권한 없음에 실제 레이어 강제 노출·귀속 누락은 결함.
- **근거**: US-E7-13, US-E8-03, PRD 09-8, G55, G59, G72, D34.

**BR-U7-27 GPS 옵트인 철회·탈퇴 시 즉시 파기 (D34/N2)**
- **조건**: GPS 기록 옵트인 철회·계정 탈퇴 시.
- **동작**: 옵트인 철회·탈퇴 시 **GpsTrack·위치 파생 데이터를 즉시 파기**(`purgeLocationData`, 30일 유예 없음)한다 — 그 시점 이후 GPS 수집도 즉시 중단(U6 연동). 단 **위치정보 수집·이용 법정 로그(append-only)는 분리 보관 유지**(앱은 자기 로그 삭제 권한 없음, N2). 계정 삭제 연쇄(S6)에서도 위치 데이터는 즉시 파기 대상(법정 로그 제외).
- **위반 시 처리**: 철회 후 미파기·30일 유예 적용·법정 로그 삭제는 결함(법적 리스크).
- **근거**: US-E8-03, US-E1-17, US-E09-11, D34/N2, S6.2.

**BR-U7-28 여행 캘린더·기록 열람 — 종료 후 편집 (C11)**
- **조건**: 마이페이지/기록 탭에서 지난 여행 기록 열람·캘린더 탐색 시.
- **동작**: 저장 기록을 **여행 단위로 목록화**하고 날짜별 기록·사진·메모·회고·이동 경로·스타일 분석을 다시 확인하게 한다 — 각 여행에서 **계획·실제·변경 3종 데이터를 구분**(라벨·색상·아이콘)해 표시한다. **월 캘린더에 여행 기간(체크인~체크아웃)을 마킹**(여행 겹침 차단 D21로 비중첩)하고 '기록' 탭·마이페이지 양쪽에서 진입 가능하며 월 이동을 지원한다. **여행 종료 후에도 기록(방문 체크·사진·메모) 편집을 허용**하되 회고·스타일 분석은 자동 갱신하지 않고 **수동 '다시 생성'으로만** 갱신한다(C11). 기록 0건이면 빈 목록/빈 캘린더 대신 '아직 기록된 여행이 없습니다' 안내와 새 여행 생성 진입점을 노출한다.
- **위반 시 처리**: 3종 미구분·종료 후 편집 차단·종료 후 회고 자동 갱신·0건 빈 화면은 결함.
- **근거**: US-E8-11, US-E8-14, PRD 09-11·14, C11, D14, D21.

## 4. 비즈니스 로직 / 플로우

> 핵심 프로세스 플로우 5종 + Testable Properties(PBT-01). 플로우 ID `FLOW-x`, 단계 `Sx`, 분기 `Bx`, 예외 `Ex`. 서비스 정본 S4(여행 종료→회고)·S8(오프라인 기록 동기화). **재사용 원칙(FD-U7-06)**: 회고·요약·스타일 서술 LLM 호출은 U5 C1(상위 티어)을 그대로 재사용하고, 실패 폴백 소유자는 M13(기본 카드)이다 — U7은 actual·changelog 영속·오프라인 동기화·회고 오케스트레이션만 신규.

### FLOW-1 방문 기록 → 사진·메모 (CP4 소비 · 오프라인 큐)

**진입**: U6 `VisitChecked`(start/complete/skip) 수신 ∨ 사용자 사진·메모 첨부 → `M12.checkVisit`(구독) / `M12.attachMedia` / `M12.addImpromptuVisit`. **관련**: US-E8-01·02·05 · BR-U7-01~04·08~11 · D23, D14, G77, G75/G145, CP4.

```text
S1 actual 방문 기록 생산 [BR-U7-01] — CP4 VisitChecked 소비
   VisitChecked(start) → VisitRecord{arrivedAt(사용자 탭·수정 가능)} · VisitChecked(complete) → departedAt·actualStay 산출
   actualStay = departedAt − arrivedAt(결정적·INV-REC2) → 계획 체류와 함께 보관(plan/actual 구분 D14)
   departedAt이 다음 장소 체크 추정이면 departedEstimatedFlag=true(허위 정확성 0)
   → 체류 초과분 M9 신호 공급(체류 초과 트리거 입력) [BR-U7-02]
   ├─ B1 즉석 방문(계획 밖) → M12.addImpromptuVisit(POI 검색 ∨ 자유 텍스트 — 자유는 좌표/카테고리 없음 '기타' INV-IMP2) [BR-U7-03]
   └─ B2 스킵/취소 → visitStatus=SKIPPED(diffKind=SKIPPED 대조 노출)
S2 귀속 [BR-U7-04]
   숙소·날짜 기준 귀속(다중 숙소=날짜별 기준 숙소·숙소 없는 날=날짜만 M4.getBaseTimeline)
S3 사진·메모 첨부 — M12.attachMedia [BR-U7-08~11]
   사진: 클라 압축(5MB/2048px)·EXIF 제거(exifStripped)·서버 썸네일·원본 기기 보관·장소당 ≤20장
   uploadState LOCAL→QUEUED→(성공)DONE / (실패)RETRYING(≤3회 지수 백오프)→FAILED('다시 시도' 버튼)
   MediaResult{accepted, pending, rejected} — 부분 결과 명시
   ├─ E1 사진 업로드 실패 → 로컬 보관·'업로드 대기' · 메모·방문 체크는 독립 저장(부분 실패 격리 INV-MEDIA1) [BR-U7-09]
   └─ B3 오프라인 → shared/storage 로컬 큐 적재('동기화 대기') → FLOW-3 [BR-U7-12]
S4 3계열 대조 반영 [BR-U7-28]
   plan(불변·U5)/actual(M12)/changelog(M12) 구분 저장 → getTripTimeline 대조 뷰(라벨·차이 하이라이트)
```

**사후 조건**: actual은 CP4 이벤트로만 생산(자동 기록 0·INV-REC1), 체류 결정적(INV-REC2), 사진 실패가 메모·체크를 막지 않음(INV-MEDIA1), plan/actual 분리(INV-REC3).

### FLOW-2 당일 회고 · 전체 요약 생성 (여행 종료 S4 · C1 · 폴백)

**진입**: `DayClosed`(일자 경계) ∨ `TripEnded`(자동 익일 00:00 ∨ 수동) → `M13.generateDailyReflection` / `M13.generateTripSummary`(정본 서비스 S4). **관련**: US-E8-06·07·08 · BR-U7-15~21 · D19/Δ4, D11, G72, G78, C11, ADR-0011 · services S4.

```text
S1 트리거 수신 [BR-U7-15·20] — CP4 소비
   DayClosed(여행·일자·방문 요약) → 당일 회고 · TripEnded(종료 방식·시각) → 전체 요약·스타일 분석
   멱등: M13 (tripId, date|kind) 핸들러 — 기존 존재 시 skip(중복 수신 안전 INV-SUM1)
   └─ E1 오프라인 구간 → 당일 회고 생성 보류 → 복구 후 생성 ∨ 기본 카드(INV-REFL4) [BR-U7-16]
S2 입력 수집
   방문·사진·메모·changelog 대조(D14) · 이동 거리(GPS 동의 구간 실측 + 미동의 추정 혼합 G72·추정 표기) [BR-U7-22]
   └─ E2 기록 0건 → NoActivity('오늘 기록된 활동이 없습니다'·수동 기록 유도) [BR-U7-17]
S3 C1 생성 (상위 티어 D11) — U5 C1 재사용
   C1.call(reflection, serverContext) — 회고 문구·요약 서술
   ├─ E3 부분 데이터 → 가용분만 생성 + 누락 명시('사진 없음'·'위치 기록 없음' basis.missingItems INV-REFL3) [BR-U7-17]
   └─ E4 C1 실패/타임아웃 → FallbackCard{방문 N곳·이동 Nkm·사진 N장}(통계만·직접 작성 가능 INV-REFL2) [BR-U7-16]
S4 전체 요약 지도 히어로 [BR-U7-20·21]
   mapHeroSpec(방문 순서 핀·날짜별 동선·거점 마커·사진 미리보기) · routeMode 구간별(동의=GPS_ACTUAL·미동의=MANUAL_LINKED)
   ├─ E5 위치 데이터 전무 → 지도 대신 방문 목록(순서·날짜) 대체(MAP_UNAVAILABLE) [BR-U7-21]
   └─ E6 요약 생성 실패 → 날짜별 기본 카드 모음 폴백(FALLBACK) [BR-U7-21]
S5 저장·알림 [BR-U7-15]
   TX: 회고/요약 저장 + outbox ReflectionReady(유형: DAILY|TRIP_SUMMARY|STYLE_ANALYSIS) → M14(발송은 U8 CP5)
S6 수정·재생성 [BR-U7-18·19]
   editReflection → editedContent 별도 저장(최종 표시본 INV-REFL1)
   regenerateReflection → 수정본 존재 시 OverwriteWarning → overwriteConfirmed 후에만 교체(G78)
   종료 후 편집분 반영은 수동 regenerateTripSummary/regenerateReflection만(자동 갱신 없음 C11)
```

**멱등성**: `DayClosed`·`TripEnded` 핸들러는 (tripId, date|kind) 기준 중복 수신 안전. **사후 조건**: 회고 트리거는 CP4로만 개시, 실패는 기본 카드 폴백(빈 화면 0), 수정본 보존(INV-REFL1).

### FLOW-3 오프라인 동기화 · 충돌 해소 (레코드 단위 독립 커밋 S8)

**진입**: 재연결 감지 → `M12.syncOfflineRecords(batch)` → (충돌) `M12.resolveSyncConflict`. **관련**: US-E8-12 · BR-U7-12~14 · G74, D24/Δ6 · services S8.

```text
S1 오프라인 입력 (클라 storage) [BR-U7-12]
   방문 체크·사진 메타·메모·수동 체크인 → 로컬 큐(recordId UUID + recordedAt + baseVersion)·'동기화 대기'
   오프라인 보장은 '입력' 한정 — 조회는 온라인 전제(D24·오류·재시도 안내만 INV-SYNC4)
S2 재연결 → 배치 업로드 — M12.syncOfflineRecords [BR-U7-13]
   레코드 단위 독립 TX(배치 원자성 의도적 부재·부분 성공 허용 INV-SYNC1)
   recordId 이미 적용 → skip(멱등)
S3 병합 판정 [BR-U7-13]
   ├─ 충돌 없음 → 적용 + VisitChecked(syncedFromOffline=true·recordedAt 원 시각 보존)
   │     └─ E1 recordedAt 과거 임계 초과 → M9 트리거 평가 제외(오발화 방지 INV-SYNC5) [BR-U7-14]
   ├─ 사진·메모 추가 → 합집합 자동 병합(충돌 아님 INV-SYNC2)
   └─ 상태·시각 충돌(서버 측 변경 존재) → conflict 목록 반환(레코드별 local/server 2버전)
S4 충돌 해소 — M12.resolveSyncConflict [BR-U7-13]
   사용자 항목별 선택(KeepLocal/KeepServer) → 새 버전으로 적용(무손실·임의 폐기 금지)
   응답 per-record 결과(applied/conflict/failed)
S5 하류 전파
   VisitChecked 구독 → actual 타임라인 반영 · 오프라인 구간 당일 회고는 복구 후 생성(FLOW-2 E1)
```

**사후 조건**: recordId 멱등(재적용 0·INV-SYNC1), 합집합 무손실(INV-SYNC2), 해소 결정성·독립 레코드 순서 무관 수렴(INV-SYNC3), 조회 오프라인 미보장(INV-SYNC4).

### FLOW-4 스타일 분석 (10곳 게이트 · 임시 미리보기 · 개인화)

**진입**: 스타일 분석 조회 ∨ TripEnded 후 배치 → `M13.analyzeTravelStyle`. **관련**: US-E8-09·10 · BR-U7-23·24 · G76, PRD 09-9·12-10.

```text
S1 게이트 판정 [BR-U7-23]
   basedOnVisitCount = M12.getVisitStats 누적 방문 장소 수(즉석 자유 입력 포함·카테고리 '기타')
   ├─ < 10곳 → PendingGate{current:N, required:10, previewFromPreferences}
   │     → PREVIEW(온보딩 취향 기반 임시 미리보기·정식 아님 명시)+진행 게이지('N/10곳') INV-STYLE1
   └─ ≥ 10곳 → OFFICIAL 생성 진행
S2 분석 생성 [BR-U7-23]
   metrics{카테고리 분포·평균 체류·이동 반경·활동 밀도} · 취향 7종 축 매핑 자체 택소노미(임시와 스키마 공유)
   구체 수치·카테고리 제시 + 근거 방문 데이터 동반
S3 개인화 신호 [BR-U7-24]
   분석 결과 → M2 경유 다음 여행 추천 입력(직접 설정 우선 > 자동 분석)
   └─ B1 개인화 미동의 → 과거 기록 추천 입력 제외·기본 추천만
```

**사후 조건**: 게이트는 방문 수에 단조(비축소·INV-STYLE1), 방문 수 기준 우선(INV-STYLE2), 미달도 빈 칸 없음(임시 미리보기).

### FLOW-5 공유 카드 (진입 · 자동 구성 · 3포맷 · 사진 0장 폴백)

**진입**: 전체 요약(US-E8-08) ∨ 당일 회고(US-E8-06) 화면 '공유' → `M13.buildShareCard`. **관련**: US-E8-13 · BR-U7-25 · D25, C3.

```text
S1 진입 게이트 [BR-U7-25]
   여행 종료·요약 생성 후에만 진입 — 미종료/요약 미생성 → PreconditionFailed(진입점 비활성 INV-SHARE1)
S2 자동 구성 [BR-U7-25]
   대표 사진·제목·기간·핵심 통계(방문 수·총 이동 거리·사진 수 — 소요시간 없음 D25)·동선·워터마크
   ├─ E1 사진 0장 → 지도 경로·통계 기반 '사진 없는 카드'(NO_PHOTO 레이아웃 INV-SHARE2) [BR-U7-25]
S3 편집·내보내기 [BR-U7-25]
   포맷 선택(9:16/1:1/4:5) · 캡션·해시태그 편집(금칙어 검증 C3)
   → 기기 이미지 저장 ∨ OS 공유 시트(외부 SNS·메신저 — 정적 이미지 채널·커뮤니티와 별개 INV-SHARE3)
```

**사후 조건**: 미종료 여행 공유 진입 0(INV-SHARE1), 사진 0장도 빈 카드 없음(INV-SHARE2), 통계에 소요시간 없음(D25).

### 4.6 Testable Properties (PBT-01 — 속성 식별 정본)

> PBT 전체 강제(D05~07 확장, D37 계층 분리). 프레임워크: 서버=Kotest Property Testing, 클라이언트=fast-check. 시드 로깅·수축(shrinking) 필수. **데이터 정합성 로직(diff 재생·오프라인 병합·이동 거리 합산)이 U7 PBT 효용 최대 영역**이며, 외부(LLM·오브젝트 스토리지)만 어댑터 fake(D37). 아래 속성은 U7 Code Generation의 DoD 항목이다.

**M12 Travel Archive (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U7-P1 | changelog 재구성 동등성 (1급·하드 계열) | **diff 누적 재구성 = current 동등성**: (a) 라운드트립(plan→diff 누적→current 재구성=current), (b) append-only 순서 불변(동일 시퀀스 동일 재구성), (c) **CP4 오라클**: U6 재계획 실생산 diff 시퀀스로 통합 재실행(재구성=U6 current) — INV-CLOG1 | changelog diff 시퀀스 생성기(추가/삭제/시간 이동/순서 변경 혼합) + plan 기준 스냅샷 + U6 CP4 생산분 |
| U7-P2 | actual 기록 불변식 | **actual 결정성·분리**: (a) actualStay=departedAt−arrivedAt 결정적(clock 주입 INV-REC2), (b) departedAt 추정 시 departedEstimatedFlag=true 전파(허위 정확성 0), (c) arrivedAt 부재 시 미산출(NULL), (d) **plan/actual 분리** — actual 기록 시퀀스가 plan 스냅샷을 바이트 불변 유지(INV-REC3·U5 INV-PLAN1 소비) | 방문 시각 쌍 생성기(실측/추정 혼합) + plan 스냅샷 + 다음 장소 체크 시각 주입 |
| U7-P3 | 오프라인 병합 수렴 (하드 계열) | **충돌 해소 결정성·교환법칙·무손실**: (a) recordId 멱등(재적용 0 INV-SYNC1), (b) 사진·메모 추가 **합집합 병합**(어떤 순서에도 합집합 동일·무손실 INV-SYNC2), (c) 독립 레코드 순서 셔플에도 최종 수렴 상태 동일(**병합 교환법칙** INV-SYNC3), (d) 상태·시각 충돌은 사용자 선택으로만 해소·양쪽 보존(임의 폐기 0) | 오프라인 배치 생성기(방문 체크·사진·메모·수동 체크인 혼합) + 순서 셔플 + 서버 측 변경 주입 |
| U7-P4 | 사진 큐 재시도 멱등 | **사진 오프라인 큐 재시도 멱등**: (a) uploadState 머신 LOCAL→QUEUED→RETRYING(≤3)→FAILED/DONE 전이표만 성공, (b) 재시도 멱등(중복 업로드·중복 Photo 레코드 0), (c) 3회 초과 시 FAILED(수동 재시도만)·성공 시 DONE 종결, (d) **부분 실패 격리** — 사진 실패가 메모·방문 체크 저장을 막지 않음(INV-MEDIA1) | 네트워크 결과 시퀀스 생성기(실패/성공 분포) + 사진·메모·체크 동반 입력 |
| U7-P5 | 이동 거리 혼합 합산 결정성 | **이동거리 혼합 산출 결정성**: (a) 총 이동 거리=실측 폴리라인 합산+장소 간 거리 추정의 혼합이 **구간 분할·순서 불변에 결정적**(INV-SUM2), (b) 구간 재분할(동일 경로 다른 split)에도 합산 동일, (c) 걸음 수=거리 환산 추정 결정적(G59) | 경로 구간 생성기(GPS/미동의 혼합·split 변형) + 좌표열 주입 |
| U7-P(직렬화) | 오프라인 큐 페이로드 직렬화 왕복 | **직렬화 왕복**: 임의 오프라인 큐 레코드(방문 체크·사진 메타·메모·수동 체크인 payload)가 직렬화→역직렬화 라운드트립에서 동등(무손실) — recordId·recordedAt·baseVersion 보존 | 오프라인 레코드 생성기(유형·필드 분포) |

**M13 AI Reflection (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U7-P6 | 스타일 게이트 단조 | **10곳 게이트 단조성**: (a) OFFICIAL은 basedOnVisitCount ≥ 10에서만 생성(경계 정확), (b) 방문 수 증가가 게이트 통과를 뒤집지 않음(**단조·비축소** INV-STYLE1), (c) 미달은 PREVIEW+진행 게이지(빈 칸 0), (d) 방문 수 기준 우선(완료 여행 수 충돌 시 방문 수 INV-STYLE2) | 누적 방문 수 시퀀스 생성기(10 경계 분포) + 완료 여행 수 주입 |
| U7-P7 | 회고 수정본 보존 | **회고 수정본 보존**: (a) editedContent 존재 시 displayContent=editedContent(수정본 우선 INV-REFL1), (b) 재생성이 수정본 덮어쓰려면 overwriteConfirmed 필수(미확인 시 보존 G78), (c) 폴백 카드 위 직접 작성 보존(FALLBACK_CARD→EDITED), (d) 종료 후 자동 갱신 0(수동 재생성만 C11) | 회고 상태 전이 시퀀스 생성기(생성/편집/재생성/확인 혼합) |

**속성 없는 컴포넌트 (No PBT properties identified)**

| 컴포넌트 | 사유 |
|---|---|
| M13 회고·요약 LLM 생성(generateDailyReflection·generateTripSummary 본문) | LLM 서술 생성은 비결정·품질 편차 — 폴백 계단(기본 카드·지도 대체·NoActivity)은 예시 기반 통합 테스트, C1은 어댑터 fake(D37). 검증 속성은 폴백 도달(침묵 실패 금지)·멱등(U7-P7 인접) |
| M13 공유 카드 구성(buildShareCard) | 이미지 레이아웃 조립·진입 게이트 — 사진 0장 폴백·미종료 차단은 예시 기반. 캡션 금칙어는 C3 계약 테스트 |
| M12 대조 뷰 조립(getTripTimeline·getTripRecords) | 읽기 모델 집약·귀속(M4 기준) — diff 재구성 핵심은 U7-P1로 분해, 나머지 예시 기반 |
| M12 캘린더·목록(getRecordCalendar·listArchivedTrips) | 월 마킹·목록 집약(겹침 없음은 D21 상류 보장) — 0건 빈 상태는 예시 기반 |
| M12 GPS 파기(purgeLocationData) | 파기 실행·법정 로그 분리 보관 — 삭제 연쇄(S6) 계약 테스트+테이블 주도. 잔존=법정 집합 검증은 U8 삭제 연쇄 PBT와 연동 |

**커버리지 대조 (U7 DoD → 속성)**

| U7 DoD 명시 속성 | 대응 |
|---|---|
| (a) changelog diff 누적 재구성 = 스냅샷 동등성 | **U7-P1(CP4 오라클·라운드트립)** |
| (b) 오프라인 병합(임의 순서 수렴·사진/메모 합집합·충돌 무손실) | U7-P3 |
| (c) plan/actual 대조 함수 | U7-P2(d) |
| (d) 직렬화 왕복(오프라인 큐 페이로드) | U7-P(직렬화) |
| (e) 이동 거리 혼합 합산(구간 분할 불변) | U7-P5 |
| (설계 확장) actual 기록 불변식(체류 결정성·추정 전파) | U7-P2 |
| (설계 확장) 사진 오프라인 큐 재시도 멱등·부분 실패 격리 | U7-P4 |
| (설계 확장) 스타일 분석 10곳 게이트 단조성 | U7-P6 |
| (설계 확장) 회고 수정본 보존 | U7-P7 |

**속성 합계: 8개**(M12: 6[P1·P2·P3·P4·P5·직렬화] · M13: 2[P6·P7]) — 프롬프트 필수 7속성 전부 포함 + 직렬화 왕복 확장.

**하드 제약(D37) 대조 — U7은 계정 무결성·changelog 무결성 소관**

| 하드 제약 | U7 방어 속성·불변식 |
|---|---|
| **계정 무결성**(기록·사진·회고 소유권 격리·회고 LLM 입력 서버 재조회 D31) | SECURITY-08(소유권)·U5 INV-SCORE4 재사용·삭제 연쇄(S6) |
| **changelog 무결성**(전/후 값·행위자 필수·재구성 정합) | **U7-P1** · INV-CLOG1·2·4 · BR-U7-05·06 |
| **회고 대조 무결성**(plan 불변·actual 분리) | U7-P2(d) · INV-REC3 · U5 INV-PLAN1 소비 |
| **위치 데이터 파기**(옵트인 철회·탈퇴 즉시 파기 N2) | INV-GPS2 · BR-U7-27 · S6.2(법정 로그 분리) |

## 5. 프론트엔드 컴포넌트

> 클라이언트 feature: `features/archive`(기록 타임라인·방문 편집·즉석 방문·사진·회고·전체 요약·스타일 분석·공유 카드·캘린더) + `shared/storage`(오프라인 입력 로컬 큐 Δ6). **지도 렌더링은 U3 `shared/map`(카카오 지도 SDK 브리지) 재사용 + U5 지도 뷰·U6 PlanVsActualMapScreen 레이어 재사용** — U7은 새 지도 브리지를 만들지 않는다(FD-U7-10). data-testid 규약: `archive-{screen}-{role}`. 판정 정본은 항상 서버(회고·요약·분석은 M13, changelog 재구성·오프라인 병합은 M12).

### 5.1 기록·회고 화면 플로우

```text
[여행 중 방문 체크(U6) → CP4 VisitChecked → M12 actual] · [여행 종료 TripEnded → M13 회고]
        │
        ▼
┌─ RecordTabScreen ('기록' 탭 — 여행별 기록 목록 + 캘린더 진입) ──────────────────────────┐
│   여행 단위 목록(예정/진행/종료) · RecordCalendar(월 마킹·겹침 없음 D21) · 0건 빈 상태     │
└──────────────────────────────────────────────────────────────────────────────────────┘
   │ 여행 선택
   ▼
┌─ TripRecordDetailScreen (날짜별 기록 상세 — plan/actual/changelog 3계열 대조 D14) ───────┐
│   ThreeSeriesTimeline(계획·실제·변경 라벨·색상·아이콘 구분) · 미방문/추가/순서 변경 하이라이트 │
│   SyncStatusBanner(동기화 대기·충돌 배지)                                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
   │ 방문 편집          │ 사진·메모        │ 즉석 방문           │ 회고               │ 전체 요약/공유
   ▼                   ▼                 ▼                    ▼                   ▼
VisitRecordEditor   MediaAttachSheet  ImpromptuVisitSheet  DailyReflectionCard  TripSummaryScreen
(시각·상태 수정 D23) (사진 큐·메모 G75)  (POI 검색/자유 G77)   (초안·수정·재생성 G78) (지도 히어로·통계)
                          │ 업로드 실패/대기                                      │ '공유'
                          ▼                                                      ▼
                    UploadQueueStatus                                      ShareCardEditor
                    (재시도 3회·수동 재시도)                                 (3포맷·사진 0장 폴백)
   │ 계획 vs 실제 경로 / 스타일 분석
   ▼                              ▼
RouteComparisonView          TravelStyleScreen
(U3/U5/U6 map 재사용·발자취)   (10곳 게이트·임시 미리보기·게이지)
        │ 오프라인 충돌
        ▼
SyncConflictResolver (레코드 단위 두 버전·항목별 선택 G74)
```

**전역 규칙**

- 기록·회고 화면군은 5탭 셸(U2) 내 '기록' 탭 스택 + 마이페이지(U8) 진입에서 접근한다(마이페이지 통합 최종은 U8). 여행 단위 목록·캘린더 양쪽 진입(BR-U7-28).
- **계획(plan)·실제(actual)·변경(changelog) 3계열은 항상 라벨·색상·아이콘으로 시각 구분**해 렌더한다(D14·US-E8-04). plan은 U5 불변 스냅샷 참조, actual·changelog는 M12 소유.
- **사진 업로드 실패는 메모·방문 체크와 격리** — 사진은 '업로드 대기'·재시도 3회·수동 재시도, 메모·체크는 독립 저장(BR-U7-09).
- **오프라인 입력은 shared/storage 로컬 큐**('동기화 대기')로 저장하고 복구 시 자동 동기화 — **조회는 온라인 전제**(오프라인 캐시 없음·오류·재시도 안내 D24).
- **회고 수정본은 최종 표시본** — 재생성 시 수정본 존재하면 덮어쓰기 경고(BR-U7-19). 실패 시 기본 카드·직접 작성(BR-U7-16).
- **모든 통계·거리는 추정 표기**('약 Nkm 추정'·걸음 수 추정)이며 **소요시간 필드는 어떤 화면에도 없다**(D25 승계). 공유 카드도 거리 통계만.
- **GPS·실제 경로 레이어는 옵트인/권한에 게이트** — 미동의 시 disabled+사유 표기(계획 동선/방문 목록 폴백 BR-U7-26).

### 5.2 컴포넌트 계층

```text
features/archive
├─ ArchiveNavigator                        — 기록 스택('기록' 탭·마이페이지 진입 — 통합 U8)
│  ├─ RecordTabScreen                       — 여행별 기록 목록(예정/진행/종료)·0건 빈 상태
│  │  ├─ ArchivedTripCard                   — 여행 카드(제목·기간·방문 수·대표 사진)
│  │  └─ RecordCalendar                     — 월 캘린더(여행 기간 마킹·겹침 없음 D21·월 이동)
│  ├─ TripRecordDetailScreen                — 날짜별 기록 상세(3계열 대조)
│  │  ├─ ThreeSeriesTimeline                — plan/actual/changelog 라벨·색상·아이콘 구분(D14)
│  │  │  ├─ PlanActualDiffRow               — 미방문/추가/순서 변경 하이라이트(diffKind)
│  │  │  └─ ChangeLogItem                   — 변경 이력(시각·전/후 장소·사유·행위자 G132)
│  │  ├─ SyncStatusBanner                   — 동기화 대기·충돌 배지(오프라인 상태)
│  │  └─ BaseAttributionHeader              — 날짜별 기준 숙소·귀속(숙소 없는 날=날짜만 D15)
│  ├─ VisitRecordEditor                     — 방문 기록 편집(도착/종료 시각·상태 수정 D23)
│  │  ├─ VisitTimeEditRow                   — 자동 기록 시각 직접 수정(수정 가능)
│  │  └─ VisitStatusToggle                  — 방문 완료/방문 안 함·취소(undo)
│  ├─ ImpromptuVisitSheet                   — 즉석 방문 추가(POI 검색 ∨ 자유 텍스트 G77)
│  │  ├─ PoiSearchInput                     — POI 검색(좌표·카테고리 있는 스냅샷)
│  │  └─ FreeTextPlaceInput                 — 자유 입력(좌표·카테고리 없음 → 분석 '기타')
│  ├─ MediaAttachSheet                      — 사진·메모 첨부(장소당 20장·클라 압축 G75/G145)
│  │  ├─ PhotoPicker                        — 사진 선택·압축(5MB/2048px·EXIF 제거)
│  │  ├─ UploadQueueStatus                  — 업로드 대기/재시도(≤3)/실패·수동 재시도 버튼
│  │  └─ MemoEditor                         — 자유 텍스트 메모(사진 실패와 독립 저장)
│  ├─ DailyReflectionCard                   — 당일 회고(초안·수정·재생성 G78)
│  │  ├─ ReflectionContentView              — 회고 문구(수정본 우선 표시 INV-REFL1)
│  │  ├─ ReflectionEditControls             — 수정·메모 덧붙임(수정본 별도 저장)
│  │  ├─ RegenerateButton                   — 재생성(수정본 존재 시 OverwriteWarning 다이얼로그)
│  │  └─ FallbackReflectionCard             — 기본 카드(방문 N곳·이동 Nkm·사진 N장·직접 작성)
│  ├─ TripSummaryScreen                     — 전체 여행 요약(지도 히어로·통계·하이라이트)
│  │  ├─ MapHeroView                        — 방문 순서 핀·날짜별 동선·거점 마커·사진 미리보기(U3/U5 map)
│  │  ├─ SummaryStatsBar                    — 총 방문·총 이동 거리(G72 추정)·총 사진 수
│  │  ├─ DailyHighlightList                 — 날짜별 하이라이트
│  │  └─ SummaryFallbackView                — 지도 대체(방문 목록)·기본 카드 모음 폴백
│  ├─ RouteComparisonView                   — 계획 vs 실제 경로(U6 PlanVsActualMap 재사용·발자취)
│  │  ├─ PlannedRouteLayer / ActualTrailLayer — 계획 동선·GPS 발자취(옵트인 게이트)
│  │  └─ TrailStatsBar                      — 누적 실제 거리·걸음 수(추정 표기 G59)
│  ├─ TravelStyleScreen                     — 스타일 분석(10곳 게이트 G76)
│  │  ├─ StyleMetricsChart                  — 카테고리 분포 막대·이동 반경 원·분포점(지도)
│  │  ├─ StylePreviewCard                   — 임시 미리보기(정식 아님 명시·온보딩 취향 기반)
│  │  └─ GateProgressGauge                  — 진행 게이지('N/10곳')
│  ├─ ShareCardEditor                       — SNS 공유 카드(3포맷·캡션·해시태그)
│  │  ├─ CardFormatSelector                 — 9:16 / 1:1 / 4:5
│  │  ├─ CardCaptionInput                   — 캡션·해시태그 편집(금칙어 검증 C3)
│  │  └─ NoPhotoCardLayout                  — 사진 0장 폴백(지도·통계 기반)
│  └─ SyncConflictResolver                  — 오프라인 충돌 해소(레코드 단위 두 버전·항목별 선택 G74)
└─ shared/storage                           — 오프라인 입력 로컬 큐(U7 신규 클라이언트 자산, Δ6)
   ├─ OfflineRecordQueue                    — 방문 체크·사진 메타·메모·수동 체크인 로컬 큐(recordId·recordedAt)
   ├─ SyncOrchestrator                      — 재연결 감지·배치 동기화·per-record 결과 반영
   └─ PhotoUploadWorker                     — 사진 업로드 큐·압축·재시도 3회·부분 실패 격리
```

### 5.3 기록 화면군 (features/archive) 상세

각 화면의 props·state·서버 규칙 대응·상호작용(서버 능력)·data-testid를 정리한다.

**RecordTabScreen + RecordCalendar (기록 목록·캘린더)** — `accountId` / state: 여행별 기록 목록(예정/진행/종료), 캘린더 월·마킹. 저장 기록을 여행 단위로 목록화(BR-U7-28). 월 캘린더에 여행 기간(체크인~체크아웃) 마킹 — **여행 겹침 차단(D21)으로 비중첩**. '기록' 탭·마이페이지 양쪽 진입·월 이동. **0건이면 '아직 기록된 여행이 없습니다'+새 여행 생성 진입점**. 서버 능력: `M12.listArchivedTrips`·`M12.getRecordCalendar(month)`. data-testid: `archive-recordtab-list`·`archive-recordtab-empty`·`archive-calendar-month`·`archive-calendar-mark`.

**TripRecordDetailScreen + ThreeSeriesTimeline (3계열 대조)** — `tripId` / state: 날짜별 기록 묶음, plan/actual/changelog 대조 데이터, 동기화 상태. **계획·실제·변경 3종을 라벨·색상·아이콘으로 시각 구분**(D14·US-E8-04). 계획-실제 차이(미방문·추가·순서 변경)를 한눈에 비교(PlanActualDiffRow diffKind). 각 변경 이력 항목은 **변경 시각·전/후 장소·사유·행위자**(G132) 포함. 날짜별 기준 숙소 귀속(숙소 없는 날=날짜만 BR-U7-04). 동기화 대기·충돌 배지. 서버 능력: `M12.getTripTimeline`(plan/current/actual/changelog 4종)·`M12.getTripRecords`·`M4.getBaseTimeline`(귀속 기준). data-testid: `archive-detail-timeline`·`archive-detail-planactual`·`archive-detail-changelog`·`archive-detail-syncbanner`.

**VisitRecordEditor + ImpromptuVisitSheet (방문 편집·즉석 방문)** — `tripId`, `visitId?` / state: 방문 기록(시각·상태), 즉석 입력(POI/자유). 자동 기록된 방문 시각 **직접 수정 가능**(D23). 방문 완료/안 함·취소(undo). **여행 종료 후에도 편집 허용**하되 회고·분석 자동 갱신 없음(수동 재생성 C11). 즉석 방문은 **POI 검색 또는 자유 텍스트(→ 분석 '기타')**(BR-U7-03, G77). 상태 전이 강제는 서버(U6) — 편집은 actual 기록 갱신. 서버 능력: `M12.updateVisitRecord(patch)`·`M12.addImpromptuVisit(PoiRef | FreeText)`. data-testid: `archive-visit-timeedit`·`archive-visit-statustoggle`·`archive-impromptu-poisearch`·`archive-impromptu-freetext`.

**MediaAttachSheet + UploadQueueStatus (사진·메모)** — `visitId` / state: 사진 목록·업로드 상태, 메모, 큐. **사진 여러 장(≤20장)+메모**(BR-U7-08·10). **클라 압축(5MB/2048px)·EXIF 제거** 후 업로드·서버 썸네일·원본 기기 보관. 업로드 실패 시 **'업로드 대기'·자동 재시도 3회·'다시 시도' 버튼**(BR-U7-09). **메모·방문 체크는 사진 실패와 무관하게 저장**(부분 실패 격리). 촬영/저장 시각·장소 함께 저장. 서버 능력: `M12.attachMedia(photos, memo)` → `MediaResult{accepted, pending, rejected}`. 업로드 워커는 `shared/storage` PhotoUploadWorker. data-testid: `archive-media-photopicker`·`archive-media-uploadqueue`·`archive-media-retry`·`archive-media-memo`.

**DailyReflectionCard (당일 회고)** — `tripId`, `date` / state: 회고(초안/수정본·status), 재생성 경고. 방문·사진·메모·변경 이력 기반 당일 회고 초안 표시(방문 수·이동 거리·사진 수·주요 변경 BR-U7-15). **수정본이 최종 표시본**(별도 저장 INV-REFL1). **재생성 시 수정본 존재하면 `OverwriteWarning` 다이얼로그**(확인 후에만 교체 G78). **C1 실패 시 기본 카드(통계만)+직접 작성**(BR-U7-16). **부분 데이터 누락 명시**('사진 없음'·'위치 기록 없음' BR-U7-17). 기록 0건이면 'NoActivity' 안내+수동 기록 버튼. 오프라인 구간 생성 보류. 서버 능력: `M13.generateDailyReflection`·`M13.editReflection`·`M13.regenerateReflection(overwriteConfirmed)`. data-testid: `archive-reflection-content`·`archive-reflection-edit`·`archive-reflection-regenerate`·`archive-reflection-overwritewarn`·`archive-reflection-fallback`.

**TripSummaryScreen + MapHeroView (전체 요약)** — `tripId` / state: 요약(통계·하이라이트·mapHeroSpec·status). 총 방문 수·**총 이동 거리(G72 혼합·추정 표기)**·총 사진 수·날짜별 하이라이트(BR-U7-20). **지도 히어로(방문 순서 핀·날짜별 동선·기준 숙소 마커)** 중심·방문지 사진 미리보기. 동의 구간=GPS 경로·미동의 구간=수동 체크인 연결 경로. **위치 전무 시 방문 목록 대체·생성 실패 시 기본 카드 모음 폴백**(BR-U7-21). 소요시간 없음(D25). 서버 능력: `M13.generateTripSummary`·`M13.regenerateTripSummary`(종료 후 편집분 C11)·`M12.getVisitStats`(G72 합산)·(U3)`shared/map`. data-testid: `archive-summary-maphero`·`archive-summary-stats`·`archive-summary-highlights`·`archive-summary-fallback`.

**RouteComparisonView (계획 vs 실제 경로 — U6/U3/U5 map 재사용)** — `tripId`, `date` / state: 계획 동선·실제 발자취 레이어, 누적 거리·걸음 수, 옵트인/권한 상태. 계획 동선+실제 GPS 발자취 함께/토글, **누적 실제 거리·걸음 수 추정 표기**(걸음 수=거리 환산 G59). **옵트인/권한 없으면 실제 레이어 disabled+사유 표기**(계획 동선만 BR-U7-26). 위치 데이터 전무 시 방문 목록 폴백. 서버 능력: `M12.getRouteComparison`·U6 `PlanVsActualMapScreen` 레이어·U3 `shared/map` 재사용. data-testid: `archive-route-planned`·`archive-route-actual`·`archive-route-stats`·`archive-route-disabled`.

**TravelStyleScreen (스타일 분석)** — `accountId` / state: 분석(metrics·mode·basedOnVisitCount), 게이트 진행. **누적 방문 10곳 게이트**(BR-U7-23). 정식(OFFICIAL)은 카테고리 분포 막대·이동 반경 원·분포점(지도)·구체 수치+근거 방문 데이터. **미달 시 임시 미리보기(정식 아님 명시)+진행 게이지('N/10곳')**. 분류는 취향 7종 축 자체 택소노미. 즉석 자유 입력은 '기타'. 서버 능력: `M13.analyzeTravelStyle` → `StyleAnalysis | PendingGate`·`M12.getVisitStats`(10곳 카운트)·(U8 연동)`M13.getStyleSummaryCard`. data-testid: `archive-style-chart`·`archive-style-preview`·`archive-style-gauge`.

**ShareCardEditor (SNS 공유 카드)** — `source`(TripSummaryRef | DailyReflectionRef) / state: 포맷·캡션·해시태그·레이아웃. 전체 요약·당일 회고 화면 '공유'에서 진입(BR-U7-25). **여행 미종료/요약 미생성이면 진입점 비활성**(INV-SHARE1). 대표 사진·제목·기간·통계(거리만·소요시간 없음 D25)·동선·워터마크 자동 구성. **3포맷(9:16/1:1/4:5)**·캡션·해시태그 편집(금칙어 C3). **사진 0장이면 '사진 없는 카드'(지도·통계)** 대체(INV-SHARE2). 기기 저장·OS 공유 시트(외부 SNS — 커뮤니티와 별개). 서버 능력: `M13.buildShareCard(source, format, caption)`. data-testid: `archive-share-format`·`archive-share-caption`·`archive-share-nophoto`·`archive-share-export`.

**SyncConflictResolver (오프라인 충돌 해소)** — `tripId` / state: 충돌 목록(레코드별 local/server 2버전), 선택. 오프라인 입력과 서버 충돌 시 **레코드 단위 두 버전을 제시해 항목별 선택**(KeepLocal/KeepServer BR-U7-13). **사진·메모 추가는 합집합 자동 병합**(충돌 아님)·상태 필드만 충돌. **어떤 경로도 무손실**(임의 폐기 금지). 서버 능력: `M12.syncOfflineRecords` → `SyncResult{applied, conflicts}`·`M12.resolveSyncConflict(resolution)`. data-testid: `archive-conflict-list`·`archive-conflict-keeplocal`·`archive-conflict-keepserver`.

### 5.4 shared/storage — 오프라인 입력 로컬 큐 (U7 신규, Δ6)

- **책임**: 여행 중 오프라인 상태의 **기록 입력**(방문 체크·사진 메타·메모·수동 체크인)을 기기 로컬 큐에 보존하고, 재연결 시 배치 동기화한다. 레코드마다 클라 생성 UUID(recordId) + 원 발생 시각(recordedAt) + 베이스 버전을 부여한다. **오프라인 보장은 '입력' 한정** — 일정 '조회'는 온라인 전제(오프라인 캐시 미제공 D24). **판정 정본은 서버**(충돌 판정·병합은 M12). 저장 구현체·암호화는 NFR/Code Generation 소유, 본 계층은 계약만 규정.
- **상호작용·폴백**:
  - `OfflineRecordQueue`: 오프라인 입력 → 로컬 큐 적재('동기화 대기'). recordId·recordedAt 부여.
  - `SyncOrchestrator`: 재연결 감지 → `M12.syncOfflineRecords(batch)` 배치 업로드 → per-record 결과(applied/conflict/failed) 반영. 충돌은 `SyncConflictResolver`로 위임.
  - `PhotoUploadWorker`: 사진 압축(5MB/2048px·EXIF 제거) → 업로드 큐 → 재시도 3회 지수 백오프 → 실패 시 수동 재시도 배지. **부분 실패 격리**(사진 실패가 메모·체크 저장 무영향).
  - 늦은 동기화(recordedAt 과거 임계 초과)는 서버가 M9 트리거 평가 제외(오발화 방지 — 클라는 원 시각 표시).
- **data-testid**: `archive-storage-queue`·`archive-storage-syncstatus`·`archive-storage-photoworker`. 서버 능력: `M12.syncOfflineRecords`·`M12.resolveSyncConflict`·`M12.attachMedia`.

### 5.5 shared/ 재사용·U7 완성분

| 계층 | U7 범위 | 근거 |
|---|---|---|
| shared/map (U3 소유) | **재사용** — 전체 요약 지도 히어로·계획 vs 실제 경로·순서 핀·발자취 레이어(카카오 브리지). 신규 지도 브리지 미생성 | components §6.1, U3 shared/map, FD-U7-10 |
| U5 일정 지도 뷰·U6 PlanVsActualMap | **재사용** — 순서 핀·계획 동선·GPS 발자취 레이어(경로 비교) | U5 MapView·U6 PlanVsActualMapScreen |
| shared/storage | **신규** — 오프라인 입력 로컬 큐·동기화 오케스트레이터·사진 업로드 워커 | Δ6, D24, G74, G75 |
| shared/api | 회고 생성 진행·폴백 고지(침묵 실패 금지)·업로드 큐·동기화 충돌·오프라인 조회 미보장 오류 안내 | ADR-0011, D24 |
| shared/ui | 3계열 라벨·색상·아이콘 구분·'추정' 표기·업로드 상태 배지·전후 diff·공유 카드 레이아웃(3포맷) | D14, D25, PRD 09-4·13 |

### 5.6 화면-스토리-서버 능력 추적 매트릭스

| 컴포넌트 | 스토리 | 서버 능력(M12·M13) |
|---|---|---|
| RecordTabScreen + RecordCalendar | US-E8-11, US-E8-14 | M12.listArchivedTrips · getRecordCalendar |
| TripRecordDetailScreen + ThreeSeriesTimeline | US-E8-04·05·11 | M12.getTripTimeline · getTripRecords · (U3)M4.getBaseTimeline |
| VisitRecordEditor + ImpromptuVisitSheet | US-E8-01 | M12.updateVisitRecord · addImpromptuVisit · (U6)M12.checkVisit |
| MediaAttachSheet + UploadQueueStatus | US-E8-02 | M12.attachMedia |
| DailyReflectionCard | US-E8-06·07 | M13.generateDailyReflection · editReflection · regenerateReflection |
| TripSummaryScreen + MapHeroView | US-E8-08 | M13.generateTripSummary · regenerateTripSummary · M12.getVisitStats · (U3)shared/map |
| RouteComparisonView | US-E7-13, US-E8-03·08 | M12.getRouteComparison · (U3)shared/map |
| TravelStyleScreen | US-E8-09·10 | M13.analyzeTravelStyle · M12.getVisitStats · M13.getStyleSummaryCard |
| ShareCardEditor | US-E8-13 | M13.buildShareCard |
| SyncConflictResolver | US-E8-12 | M12.syncOfflineRecords · resolveSyncConflict |
| shared/storage | US-E8-02·12 | M12.syncOfflineRecords · resolveSyncConflict · attachMedia · (U6)M12.appendGpsTrack |

## 6. NFR — 요구·기술 스택·설계 패턴

> 시스템 전역 NFR 정본은 requirements.md §6이며, 본 절은 U7 관점 전개다. U7은 **사진 저장(S3+CloudFront)이 프로젝트 최초로 등장하는 유닛**이므로 스토리지·미디어·오프라인 축은 유닛 증분을 확정하고, 인프라·플랫폼·회고 연산은 **전역 정본 상속(재정의 금지)**한다. 회고 연산은 U5 C1 자산 재사용(신규 LLM 벤더·인프라 표면 0).

### 6.1 U7 NFR 프로필 — 3대 축

1. **오프라인 우선 입력(핵심)** — 산간·해외 로밍에서도 기록 입력이 유실되지 않아야 한다(US-E8-12). 입력만 보장(조회는 온라인 전제 D24/Δ6), 로컬 큐·재접속 자동 동기화·충돌 무손실 병합(G74)이 본질.
2. **스토리지·미디어(핵심 · 프로젝트 최초)** — 사진 파이프라인을 U7이 처음 도입한다. 클라 압축(5MB/2048px)·서버 썸네일·S3+CloudFront 서빙·EXIF GPS 프라이버시(G75/G145/G168). **U1~U6에 없던 신규 AWS 리소스(S3 버킷·CloudFront)가 실제 생긴다**(SI §5.2·§5.4 예약분 활성화).
3. **데이터 정합 + 복원력** — changelog diff 누적 재구성=스냅샷 동등성(G132), plan/actual 대조, 업로드 실패 큐, 회고 LLM 실패 기본 카드 폴백.

**워크로드 중요도(requirements.md §6.3)**

| 컴포넌트 | 중요도 | 불가용 시 영향 | U7 대응 |
|---|---|---|---|
| 기록 입력(M12 actual·사진·메모) | **High** | 입력은 로컬 큐로 보존, 조회·생성만 지연 | 오프라인 로컬 큐 — 서버 순단에도 입력 무손실 |
| 회고·요약·스타일 분석(M13) | **High** | 생성만 지연(로컬 큐 보존 후 재평가) | 비동기 이벤트 구동 + LLM 실패 시 기본 카드 폴백 |
| 사진 서빙(S3+CloudFront) | Medium | 이미지 로딩 실패 — 썸네일 CDN·재시도, 메모/기록 텍스트는 정상 | CDN 캐시·서명 URL, 이미지 실패가 기록 열람 차단하지 않음 |

Critical(여행 중 일정 접근 M18·M6·M8)은 U6 이하 소관이며, 기록·회고의 조회 지연은 수용 가능하나 **입력 유실은 불가**(로컬 큐가 가용성 보완).

### 6.2 오프라인 우선 입력 (Δ6/D24·G74, RESILIENCY-01)

**오프라인 보장 경계(D24/Δ6 — 입력만)**

| 대상 | 오프라인 | 근거 |
|---|---|---|
| 방문 체크·수동 체크인·사진 첨부·메모 작성 | **로컬 저장 보장** — 네트워크 무관 기기 로컬 큐 적재 | US-E8-12, RESILIENCY-01 M12 High |
| 일정·기록 **조회** | **온라인 전제** — 실패 시 오류·재시도 안내만 | D24/Δ6 |
| 당일 회고 자동 생성 | 오프라인 중 **보류**, 복구 후 생성 또는 기본 카드 대체 | US-E8-12 |

- **NFR-U7-OFF-01(로컬 큐 영속)**: 오프라인 입력은 앱 재시작·강제 종료에도 살아남는 **기기 영속 저장**(`shared/storage`)에 적재하고 '동기화 대기'로 표시. 메모리 큐 금지(전원/크래시 유실).
- **NFR-U7-OFF-02(재접속 자동 동기화)**: 네트워크 복구 감지 시 큐 항목 순차/재시도 동기화. 수동 개입 없이 진행하되 진행/실패 상태 표시(침묵 실패 금지 ADR-0011).
- **NFR-U7-OFF-03(멱등 동기화)**: 각 큐 항목에 클라 생성 ID(멱등 키) 부여 → **재시도로 중복 레코드가 생기지 않는다**. PBT 대상(직렬화 왕복·임의 재전송 순서 수렴).
- **NFR-U7-OFF-04(레코드 단위 버전 비교)**: 충돌 시 **방문 기록 레코드 단위 버전 비교** → 항목별로 사용자가 유지할 버전 선택.
- **NFR-U7-OFF-05(사진·메모 합집합 병합)**: 사진·메모 **추가**는 충돌 아닌 **합집합 병합**(양쪽 보존·무손실). 사용자 선택은 상충 필드(체류 시각 등)로 최소화.
- **NFR-U7-OFF-06(무손실 불변식 — PBT 1급)**: 임의 순서·임의 중복 동기화 시퀀스에 대해 **어떤 경로에서도 사용자 데이터가 소실되지 않는다**. 병합 수렴·데이터 무손실을 Kotest/fast-check 속성 테스트로 강제.

### 6.3 스토리지·미디어 (프로젝트 최초 · G75/G145/G168)

**사진 정책(G75/G145)**

| 항목 | 값 | 근거 |
|---|---|---|
| 장소당 최대 | **20장** | G75/G145, US-E8-02 |
| 클라이언트 압축 | **장당 ≤5MB · 긴 변 2048px** — 업로드 전 클라 압축 | G75/G145 |
| 원본 | **기기 보관**(서버 미전송) — 서버 부담·비용 축소 | G75 |
| 썸네일 | **서버 생성**(목록·지도 핀 미리보기용) | G75, US-E8-08 |
| 스토리지·서빙 | **S3 + CloudFront** | G168, tech-stack §2·§3, infra §1·§2 |
| 촬영/저장 시각·귀속 | 사진 EXIF 시각·첨부 장소 함께 저장 | US-E8-02 |

- **NFR-U7-MEDIA-01(클라 압축 선행)**: 업로드는 반드시 클라 압축(5MB/2048px) 후 수행 — 원본 업로드 경로가 **구조적으로 존재하지 않는다**.
- **NFR-U7-MEDIA-02(장당 20장 상한)**: 장소당 사진 수 서버 강제(21번째 거부). 클라도 사전 차단하되 정본은 서버.
- **NFR-U7-MEDIA-03(서버 썸네일)**: 업로드 완료된 압축 이미지로부터 서버가 썸네일 생성. 썸네일 실패는 원본(압축본) 표시 폴백 — 첨부 자체를 차단하지 않음.
- **NFR-U7-MEDIA-04(CDN 서빙)**: 사진·썸네일은 CloudFront 경유 서빙. 버킷 직접 접근 차단(OAC).
- **NFR-U7-MEDIA-05(EXIF GPS 기본 제거)**: 저장 사진의 EXIF GPS는 **기본 자동 제거**(G185). 커뮤니티 게시 시 EXIF 처리(G185 '정확 위치 공개')는 U10 소관.
- **NFR-U7-MEDIA-06(원본 GPS 기기 이탈 최소화 — G168 권고)**: **EXIF GPS 제거를 클라 전처리(압축 단계)에서 수행**해 원본 위치 정보가 서버에 도달하지 않게 하는 것이 프라이버시 최적. 서버는 **심층 방어로 재검증·재제거**.

### 6.4 성능 (§6.1)

U7은 실시간 UI 차단 경로가 얕다(사진 업로드=백그라운드, 회고 생성=비동기 이벤트 구동). 아래는 제안 목표(서버 처리 시간 기준, 네트워크 RTT 별도).

| # | 대상 | 목표 | 근거 |
|---|---|---|---|
| NFR-U7-PERF-01 | 사진 업로드(presigned URL 발급 API) | p95 **< 300ms** — 업로드 자체는 **비차단 백그라운드 큐**(방문 체크·메모는 독립 즉시 저장) | §6.1 화면 전환 300ms 준용 |
| NFR-U7-PERF-02 | 서버 썸네일 생성 | 첨부 확정 응답 내 **< 2초/장**(동기) 또는 비동기 — 실패 시 원본 표시 폴백 | NFR-U7-MEDIA-03 |
| NFR-U7-PERF-03 | 회고 생성(당일/전체/스타일) | **비동기**(DayClosed/TripEnded 구동). C1 상위 티어 호출 **타임아웃 예산(권고 25초)**, 초과·실패 시 기본 카드 폴백. 완료 시 인앱 카드/푸시(ReflectionReady) | US-E8-06, D11 |
| NFR-U7-PERF-04 | 기록·요약 조회 | 기록 상세/요약 조회 서버 p95 **< 500ms**, 화면 전환 300ms. 이미지는 CDN 캐시 히트 | §6.1, NFR-U7-MEDIA-04 |

- **NFR-U7-PERF-05(사진 로딩 = CDN)**: 기록/회고 화면 이미지 로딩은 CloudFront 캐시가 담당(목록=썸네일, 상세=압축 원본). 오리진(S3) 히트 최소화가 지연·비용 동시 최적.

### 6.5 복원력 (§6.2·§6.3, RESILIENCY-10, ADR-0011)

**사진 업로드 복원력(침묵 실패 금지)**

- **NFR-U7-RES-01(업로드 실패 로컬 큐·재시도)**: 사진 업로드 실패 시 로컬 큐 보존 + **지수 백오프 재시도 3회**. 최종 실패 시 상태 표시(동기화 대기·재시도 버튼).
- **NFR-U7-RES-02(입력 독립 저장)**: **메모·방문 체크는 사진 업로드 실패와 무관하게 저장**(US-E8-02). 사진은 사후 재동기화. 사진 첨부가 방문 기록 저장을 차단하지 않는다.
- **NFR-U7-RES-03(원본 기기 보관 = 재시도 소스)**: 원본이 기기에 남아 있으므로(G75) 업로드 실패는 언제든 재시도 가능 — 서버 상태와 무관한 무손실 복구 경로.

**회고 LLM 복원력(기본 카드 폴백)**

- **NFR-U7-RES-04(회고 LLM 폴백)**: C1 호출 실패·타임아웃 시 **빈 화면 대신 '방문 N곳·이동 Nkm·사진 N장' 기본 카드**. C1 서킷·타임아웃은 U5 자산 상속(인프라 A11·A12 알람은 SI §8.2, U5가 첫 소비자).
- **NFR-U7-RES-05(부분 데이터 명시)**: 사진 0장·GPS 미동의·메모만 등 부분 데이터 상태에서 가용 데이터만 회고 생성하고 **누락을 회고에 명시**('사진 없음'·'위치 기록 없음'). 생성 불가 항목은 제외하되 침묵하지 않음.
- **NFR-U7-RES-06(스타일 분석 게이트)**: 스타일 분석은 방문 10곳 게이트로 빈약 입력 차단(G76) — 미달 시 미제공 안내.
- **NFR-U7-RES-07(워크로드·가용성)**: M12·M13 = **High** — 입력은 로컬 큐 보존, 조회·생성만 지연. Multi-AZ·백업·헬스체크는 SI §1~3·§8 상속. 사진 스토리지 버저닝은 SI §5.2(이전 버전 30일)·RESILIENCY-12 상속.

### 6.6 보안·프라이버시 (Security Baseline 상속 — §6.4)

| # | 요구 | 규칙 | 처리 |
|---|---|---|---|
| NFR-U7-SEC-01 | 사진 스토리지 암호화 | SECURITY-01 | S3 **SSE-KMS**(SI §5.1) — TLS-only 버킷 정책 |
| NFR-U7-SEC-02 | 사진 접근 제어(소유권) | SECURITY-08 | 사진·기록·회고 = 인증 필수·accountId 스코핑(IDOR 차단). CloudFront **서명 URL**로 소유자만 접근 |
| NFR-U7-SEC-03 | 버킷 직접 접근 차단 | SECURITY-09 | 퍼블릭 액세스 전면 차단 + **OAC**(CloudFront만 오리진 접근) — 디렉터리 리스팅 불가 |
| NFR-U7-SEC-04 | 업로드 파일 검증 | SECURITY-05 | 크기(≤5MB)·MIME 타입·확장자 화이트리스트(이미지 한정)·매직 바이트 검증. presigned URL은 content-length/type 조건 |
| NFR-U7-SEC-05 | EXIF GPS 프라이버시 | §6.4·G185 | 기본 자동 제거 — 클라 제거 + 서버 재검증(심층 방어) |
| NFR-U7-SEC-06 | **GPS 데이터 파기(D34/N2)** | SECURITY-14·N2 | GPS 옵트인 **철회·탈퇴 시 위치 데이터(발자취 폴리라인·GPS 귀속) 즉시 파기**. 파기 연동은 U6 수집·U1 동의 모델 위에서 동작 |
| NFR-U7-SEC-07 | 위치정보 법정 로그 | N2·SECURITY-14 | **U1 append-only 법정 로그 테이블 재사용** — 앱 역할 삭제 불가(2중 강제). 파기(D34)와 법정 로그(6개월+ 보존)는 별개 — 로그는 잔존 |
| NFR-U7-SEC-08 | UGC(메모) 새니타이즈 | SECURITY-05 | 자유 텍스트 메모·회고 수정본·공유 카드 캡션 = 길이 제한·새니타이즈(금칙어는 C3) |
| NFR-U7-SEC-09 | 회고 LLM 경계 | SECURITY-11·D31 | C1 서버 재조회 상속(U5) — 타 사용자 데이터·내부 지표 LLM 미주입 |

- **GPS 파기 무결성**: 파기는 즉시·완전(발자취 원시는 U6에서 이미 파기 G73 — 폴리라인만 보존)이되, **법정 로그(수집·이용 사실)는 보존**(N2 6개월+·append-only). 파기 대상과 보존 대상을 명확히 분리한다.

### 6.7 규모 (§6.8 G142 — DAU 1천)

- **NFR-U7-SC-01(스토리지 증가율)**: DAU 1천 · 활성 여행 ≤1/사용자(D21) · 장소당 ≤20장 · 클라 압축 후 장당 ~1–2MB · 원본 기기 보관. MVP 규모 **월 누적 수십 GB 수준**. SI §5.1 버저닝 + 이전 버전 30일 파기(SI §5.2)로 무한 증가 억제.
- **NFR-U7-SC-02(비용 상한)**: 사진 S3 + CloudFront 증분은 **월 수 달러~십수 달러 수준**. **AWS Budgets 알람(SI §8.2 A15)**이 스토리지·CDN 급증(업로드 폭주·핫링크)을 감시. 별도 비용 통제 리소스 불요.
- **NFR-U7-SC-03(서버 부담 축소)**: 원본 기기 보관 + 클라 압축 선행으로 **오리진 저장·전송량을 구조적으로 축소**. 썸네일 생성만 서버 CPU 사용(저빈도 — 기존 ECS 태스크 흡수).
- **NFR-U7-SC-04(과설계 금지)**: DAU 1천에서 이미지 처리에 **Lambda·EventBridge·전용 트랜스코딩 파이프라인·ElastiCache 미도입**. 전환 트리거: 사진 처리량이 ECS API 지연에 간섭하거나 월 처리 수만 장 초과 시 Lambda 썸네일 분리 재평가.

### 6.8 회고 (C1 재사용 · 타임아웃)

- **NFR-U7-REF-01(C1 재사용)**: M13 회고·전체 요약·스타일 분석은 **U5 C1 LLM Gateway를 상위 티어(D11)로 재사용** — 신규 벤더·라우팅·시크릿 없음. 서버 재조회(D31)·rate-limit·비용 계측·출력 스키마 검증은 U5 자산 상속.
- **NFR-U7-REF-02(비동기 이벤트 구동)**: 당일 회고=DayClosed 트리거, 전체 요약=TripEnded 트리거. 사용자 대기 UI가 아니라 **완료 시 알림**(ReflectionReady, 발송은 U8 M14).
- **NFR-U7-REF-03(타임아웃·폴백)**: C1 회고 호출 타임아웃(권고 25초 예산) 초과·실패 시 기본 카드 폴백. LLM 비용·품질 편차는 U5 계측 대시보드(SI §8.2 LLM 슬롯) 상속.
- **NFR-U7-REF-04(재생성·덮어쓰기)**: 회고 재생성 시 **수정본 존재하면 덮어쓰기 경고 후 확인 시에만 교체**(G78). 종료 후 편집·수동 재생성만 갱신(C11).
- **NFR-U7-REF-05(개인화 신호)**: 스타일 분석 결과는 다음 여행 개인화 신호로 취향 7종 축 택소노미에 매핑(G76) — 스키마는 M2와 공유.

### 6.9 미결·선결 항목 (U7 신규 없음)

- **P6(LLM 벤더·비용·국외 이전)**: **U5에서 기완료** — 회고는 C1 재사용, 신규 벤더 계약·비용 산정 불요.
- **P1(위치기반서비스사업 신고)·P7(위치기반서비스 약관)**: **U6에서 기완료** — GPS 파기 연동(D34)은 U1 동의 모델·U6 수집 위에서 동작.
- **오브젝트 스토리지·CDN 선정**: **Infrastructure Design 결정 사항** — SI §5.2·§5.4 예약분(S3·CloudFront)을 활성화로 종결(비외부 선결·비차단).
- 벤더 종속 미결 없음 — 클라우드=AWS(GD-1)·스토리지=S3·CDN=CloudFront(SI §5 예약)·LLM=U5 벤더(D11) 전부 기확정.

### 6.10 기술 스택 결정 (Tech Stack Decisions)

> 스택 대분류(RN Expo + Spring Boot Kotlin + PostgreSQL, D02)와 U1 라이브러리 정본은 기확정. U7은 그 위에 6개 지점(① 이미지 스토리지 ② CDN ③ EXIF 제거 위치 ④ 썸네일 생성 위치 ⑤ 사진 업로드 파이프라인 ⑥ 오프라인 큐)만 구체화한다.

| # | 지점 | 결정 | 유형 | 대안(비채택) | 핵심 사유 |
|---|---|---|---|---|---|
| U7-S1 | 이미지 스토리지 | **Amazon S3**(SI §5.2 예약분 활성화) | 증분(신규 리소스) | S3 호환 자체 호스팅(MinIO)·타 클라우드 | SI 예약·클라우드 정합(GD-1)·버저닝/암호화/수명주기 관리형 |
| U7-S2 | CDN·서빙 | **CloudFront + 서명 URL + OAC**(SI §5.4 예약분 활성화) | 증분(신규 리소스) | 퍼블릭 버킷 URL·앱(ECS) 프록시 서빙 | 접근 제어(서명 URL)·캐시·오리진 부하 축소·SECURITY-09 정합 |
| U7-C1/S3 | EXIF GPS 제거 | **클라 전처리(압축 단계) 기본 + 서버 재검증(심층 방어)** | 증분 | 서버 단독 제거 / 미제거 | **G168 권고 — 원본 GPS 기기 이탈 방지(프라이버시 최적)**. 클라 우회 대비 서버 재제거 |
| U7-S4 | 썸네일 생성 | **앱(ECS) 동기 생성**(첨부 확정 시) | 증분 | 서버 Lambda / 클라 생성 | G75 서버 썸네일·저빈도(G142) → Lambda/EventBridge 미도입, 클라 신뢰 불가 |
| U7-C2/S5 | 업로드 파이프라인 | **서명 URL 직업로드(S3 presigned PUT) + attach 확정 API** | 증분 | 서버 경유 업로드(멀티파트→ECS) | ECS 대역폭 오프로드·재시도 내성·비용. 서버 검증은 attach·정책 조건으로 보완 |
| U7-C3 | 오프라인 큐 | **`shared/storage` 로컬 영속 큐 + 멱등 키 + 지수 백오프 재시도** | 증분(클라) | 메모리 큐 | 크래시·전원 유실 방지·재시도 멱등 |
| U7-S6 | 회고 연산 | **U5 C1 LLM Gateway 재사용**(상위 티어) | **재사용(신규 0)** | 신규 벤더·게이트웨이 | D11 단일 벤더·서버 재조회·비용 계측 U5 확정 자산 |

**상속(재결정 없음)**: 서버 프레임워크(Spring Boot Kotlin)·DB(PostgreSQL·JPA/JdbcTemplate)·마이그레이션(Flyway)·인증(Spring Security)·HTTP·상태 관리(RN)·PBT(Kotest·fast-check)는 U1 정본. 클라우드·시크릿·관측성은 SI 정본.

**EXIF GPS 제거 위치 트레이드오프(U7-C1/S3 — 프라이버시 결정)**: G168은 원본 GPS의 기기 이탈 최소화를 권고하고, G75는 원본을 기기 보관으로 확정했다. **채택 A(클라 전처리 기본 + 서버 재검증)** — 클라 압축 단계에서 EXIF GPS(및 불필요 메타) 제거 후 업로드, 서버는 저장 전 EXIF를 재검증·재제거(클라 우회·잔여 위치 태그 대비). 사진 촬영 시각 등 비위치 메타는 별도 필드로 보존. 클라 단독은 우회 리스크, 서버 단독은 원본 GPS 일시적 서버 도달 — **양쪽 결합(A)**이 "기기 이탈 방지 + 우회 방어"를 동시 충족한다. 커뮤니티 게시 EXIF 처리(G185)는 U10 소관.

**업로드 파이프라인 흐름(U7-C2/S5)**: ① 클라 압축·EXIF 제거 → ② 서버 **presigned PUT URL 발급**(장소당 20장 상한·content-length ≤5MB·content-type 이미지 조건) → ③ 클라가 S3에 직접 PUT(백그라운드 큐·재시도) → ④ 클라 **attach 확정 API** → ⑤ 서버 EXIF 재검증·매직 바이트 검증·썸네일 생성·메타 저장. ECS 대역폭 오프로드 + 클라 재시도 내성이 규모·복원력에 최적.

### 6.11 NFR 설계 패턴 (PAT-U7)

> U7 신규 패턴 6종(오프라인·미디어·데이터 정합 중심). 회고 연산(C1)·보안 기본·관측성의 전역 패턴은 상속표로 갈음(재기술 금지). `[U7]`=U7 코드가 구현 소유, `상속`=U1·U5·shared 정본 재사용.

**전역 상속 패턴 (U7 재정의 금지)**

| 상속 패턴 | 출처 | U7 적용 지점 |
|---|---|---|
| **회고 연산(C1 LLM Gateway) 전체** | U5 nfr-design·tech-stack | M13 회고·요약·스타일 분석 = C1 상위 티어 소비자(서버 재조회 D31·rate-limit·비용 계측·출력 스키마 검증·티어 라우팅 재사용). 신규 인프라·벤더 표면 0 |
| PAT-SEC-01 인증 필터 체인(deny-by-default) | U1 nfr-design | 기록·사진·회고 = 인증 필수·accountId 스코핑(IDOR 차단) |
| PAT-SEC-05 시크릿 관리(외부 주입·하드코딩 금지) | U1 nfr-design | **CloudFront 서명 URL 개인 키 = Secrets Manager 주입** — 코드·이미지·Terraform state 평문 0 |
| PAT-RES-01 외부 의존 격리 계약(4요소) | U1 nfr-design | 회고 C1 호출은 U5 서킷·타임아웃 계약 상속 — PAT-U7-05가 U7 폴백(기본 카드)만 소유 |
| PAT-RES-03 우아한 성능 저하(부분 장애 격리) | U1 nfr-design | 사진 실패가 방문 기록 저장을 차단하지 않음·이미지 실패가 텍스트 열람 차단하지 않음 |
| PAT-PERF-02 커넥션 풀·벌크헤드 | U1 nfr-design | 썸네일 생성·기록 조회 풀 정합(저빈도 — 기존 태스크 흡수) |
| PAT-OBS-01 구조화 로깅·PII 마스킹 | U1 nfr-design | 사진 메타·회고 로그도 동일 마스킹·상관 ID |
| PAT-OBS-03 메트릭·알람 대상 | U1 nfr-design | **사진 스토리지·CDN 비용은 A15(SI §8.2) 감시 편입**, 업로드 실패율·회고 폴백율 커스텀 메트릭 |

**U7 신규 패턴**

| ID | 패턴 | 범주 | 관련 규칙 |
|---|---|---|---|
| PAT-U7-01 | 오프라인 우선 입력 큐·재시도·충돌 해소(레코드 단위·합집합) | 오프라인·복원력 | G74, Δ6/D24, RESILIENCY-01 |
| PAT-U7-02 | 사진 업로드 파이프라인(클라 압축·EXIF 제거·서명 URL 직업로드) | 미디어·성능·프라이버시 | G75/G145, G168, SECURITY-05 |
| PAT-U7-03 | CDN 서명 URL 접근 제어(OAC·소유권·짧은 만료) | 보안 | SECURITY-08·09, G168 |
| PAT-U7-04 | changelog 통합 diff 보관·재구성(누적 재생=스냅샷 동등성) | 데이터 정합 | G132, D14 |
| PAT-U7-05 | 회고 폴백(C1 실패/타임아웃→기본 카드·부분 데이터 명시) | 복원력 | RESILIENCY-10, US-E8-06 |
| PAT-U7-06 | GPS 파기·법정 로그 분리(옵트인 철회·탈퇴 즉시 파기) | 보안·프라이버시 | D34, N2, SECURITY-14 |

- **PAT-U7-01 오프라인 우선 입력 큐·재시도·충돌 해소 `[U7]`**: 로컬 영속 큐(`shared/storage`)에 멱등 키와 함께 '동기화 대기' 적재(앱 재시작·크래시 생존). 재시도·부분 성공에도 중복 레코드 0. 충돌 해소 2계열 — 레코드 단위 버전 비교(상충 필드만 사용자 선택) + 사진·메모 추가 합집합 병합(양쪽 보존). 어떤 경로에서도 데이터 소실 0. **검증: PBT 1급**(임의 순서·중복 시퀀스에 수렴·무손실·멱등·직렬화 왕복). 병합 완료 후 M8 변경 배지 동기화(E17).
- **PAT-U7-02 사진 업로드 파이프라인 `[U7]`**: (1) 클라 압축(5MB/2048px) + EXIF GPS 제거(원본 GPS 기기 이탈 방지 G168, 원본 기기 보관 G75), (2) 서버 presigned PUT URL 발급(20장·크기·타입 조건 SECURITY-05), (3) 클라 S3 직업로드(백그라운드 큐·지수 백오프 3회 — ECS 대역폭 오프로드), (4) attach 확정 API → 서버 EXIF 재검증·매직 바이트·크기 재확인(심층 방어) → 썸네일 생성(앱 ECS 동기, Lambda 미도입) → 메타 저장, (5) 입력 독립(메모·방문 체크는 사진 실패와 무관 저장). **검증: SECURITY-05(2중 검증), G168, 재시도 테이블 주도, 저장 독립 계약**.
- **PAT-U7-03 CDN 서명 URL 접근 제어 `[U7]`**: OAC(CloudFront만 S3 오리진 접근·버킷 퍼블릭 전면 차단·디렉터리 리스팅 불가). 서명 URL(소유권 검증 후 짧은 만료 발급, 서명 개인 키는 Secrets Manager). 서명 URL 발급 자체가 accountId 스코핑 뒤. **검증: SECURITY-08(비소유자 발급 거부)·SECURITY-09(직접 GET 차단)·만료 URL 접근 거부**.
- **PAT-U7-04 changelog 통합 diff 보관·재구성 `[U7]`**: 통합 diff 스키마(G57/G132 — 행위자·출처 유형·사유·전/후 값, POI 내부 ID 참조, 스키마 버전 필드 예약). plan/current/actual/changelog 구분 저장(D14). current = plan + changelog diff 누적 재생(임의 시퀀스에 재생=current). 소비: U6 재계획 diff·U8 배지 동기화·U10 공개 스냅샷·U11 공동편집 이력 참조 정본. **검증: PBT 1급(재구성=스냅샷 동등성 G132)·plan/actual 대조·직렬화 왕복·전후 값·행위자 필수 하드 제약**.
- **PAT-U7-05 회고 폴백 `[U7]`**: C1 계약 상속(U5 서킷·타임아웃, 권고 25초). 기본 카드 폴백(실패·타임아웃 시 '방문 N곳·이동 Nkm·사진 N장', 위에 직접 작성 가능). 부분 데이터 명시(누락 침묵 금지). 10곳 게이트(빈약 입력 차단). 재생성·덮어쓰기(수정본 존재 시 경고 후 확인, 종료 후 자동 갱신 금지). 비동기 트리거(DayClosed/TripEnded → ReflectionReady 발행). **검증: RESILIENCY-10·회고 폴백율 커스텀 메트릭**.
- **PAT-U7-06 GPS 파기·법정 로그 분리 `[U7]`**: 파기 대상(발자취 폴리라인·GPS 귀속 — 원시 좌표는 U6에서 이미 파기 G73). 옵트인 철회·탈퇴 트리거 시 즉시 파기(D34). 보존 대상(위치 수집·이용 법정 로그 — U1 append-only 테이블 재사용, 6개월+ 보존, 앱 역할 삭제 불가 2중 강제). 파기 잡이 위치 데이터만 지우고 법정 로그는 미접근(권한·경로 분리). 파기 실행은 ShedLock 스케줄러 또는 철회 이벤트 즉시 처리. **검증: D34(잔존 0)·N2(법정 로그 append-only 잔존)·삭제 연쇄 후 잔존=법정 보존 집합 정확 일치 PBT(U8 연쇄 접속)**.

## 7. 인프라 (Infrastructure Design)

> 공유 인프라 정본은 shared-infrastructure.md(SI). **U7은 SI가 "U7 예약"으로 명시한 스토리지·CDN 자원(§5.2 사진 버킷·§5.4 CloudFront)을 실제 활성화한다** — U1~U6과 달리 **신규 AWS 리소스가 실질적으로 발생하는 첫 유닛**이다. 그 외 컴퓨트·네트워크·DB·시크릿·관측성·회고 연산(C1)은 SI·U1·U5 정본 재사용.

### 7.1 U7 인프라 증분 요약

U7 인프라 결정은 다섯 — **① S3 사진 버킷 활성화, ② CloudFront 배포(OAC·서명 URL), ③ 이미지 처리(클라 전처리 + 서버 썸네일), ④ 사진 메타·changelog·GPS 파기(RDS·U1 append-only 재사용), ⑤ 회고 LLM(U5 C1 재사용)**.

SI 예약분 활성화 정합 확인:
- SI §5.2 `trippilot-{env}-photos`(버저닝 + 이전 버전 30일 파기) → **활성화**(§7.2)
- SI §5.4 CloudFront + S3 OAC(서명 URL·TLS1.2+·표준 로깅·기본 루트 객체 없음) → **활성화**(§7.3)
- SI §6 "사진 버킷은 U7에서 CMK 필요성 재평가" → **재평가 완료: aws/s3 관리형 유지**(§7.6)
- SI §11.2 storage 모듈 "photos/CloudFront는 자리만 생성(U7 활성화)" → **Terraform storage 모듈 활성화**(§7.7)

### 7.2 S3 사진 버킷 활성화 (SI §5.2 예약분 · SECURITY-01)

버킷 `trippilot-{env}-photos`(SI §5.2 예약 — 이름·기준선 상속). U1 storage 모듈이 자리만 생성한 버킷의 **정책·수명주기·이벤트를 U7에서 확정**.

| 항목 | 값 | 근거 |
|---|---|---|
| 퍼블릭 액세스 | **전면 차단**(계정 레벨 Block Public Access ON) | SECURITY-09, NFR-U7-SEC-03 |
| 버저닝 | **ON** | SI §5.1·5.2, RESILIENCY-12(사진 버저닝 백업성) |
| 기본 암호화 | **SSE-KMS**(`aws/s3` 관리형 — CMK 재평가 결과) | SECURITY-01, NFR-U7-SEC-01 |
| 전송 암호화 | **TLS-only 버킷 정책**(`aws:SecureTransport=false` Deny) | SECURITY-01 |
| 오리진 접근 | **CloudFront OAC만 허용**(버킷 정책 — 직접 접근 차단) | SECURITY-09, §7.3 |
| 수명주기 | **버저닝 + 이전 버전 30일 파기**. 삭제 마커·미완료 멀티파트 업로드 7일 정리 | SI §5.2, NFR-U7-SC-01 |
| 접근 경로 | **S3 Gateway 엔드포인트**(SI §2.1 — NAT 요금 우회·프라이빗) | SECURITY-07 |

- **오브젝트 구조(프리픽스)**: `{accountId}/{tripId}/{placeId}/{photoId}`(원본 압축본) + `{...}/thumb/{photoId}`(썸네일). accountId 프리픽스로 IAM·소유권 경계. 태스크 역할 `s3:PutObject/GetObject`는 photos 프리픽스 한정(로그 버킷 아님 — photos는 이전 버전 30일 수명주기가 정리).
- **presigned PUT**: content-length ≤5MB·content-type 이미지 조건(SECURITY-05) + 짧은 만료 + 단일 객체 스코프. 원본은 기기 보관(G75)이므로 **원본 업로드 경로 없음**(압축본만).

### 7.3 CloudFront 배포 활성화 (SI §5.4 예약분 · SECURITY-02·08·09)

사진 서빙 CDN — `trippilot-{env}-photos` 오리진, **OAC**로 버킷 직접 접근 차단.

| 항목 | 값 | 근거 |
|---|---|---|
| 오리진 접근 | **OAC** — CloudFront만 S3 오리진 접근 | SECURITY-09, NFR-U7-SEC-03 |
| **접근 제어** | **서명 URL(Signed URL)** — 소유권 검증 후 짧은 만료 URL 발급(사진=사적 자산) | **SECURITY-08**, NFR-U7-SEC-02, PAT-U7-03 |
| viewer 프로토콜 | **HTTPS only, TLS 1.2+**(redirect-to-https) | SECURITY-01, SI §5.4 |
| 로깅 | **표준 로깅 활성**(S3 로그 프리픽스) | SECURITY-02, SI §5.4 |
| 기본 루트 객체 | **없음**(디렉터리 리스팅 불가) | SECURITY-09, SI §5.4 |
| 캐시 정책 | 썸네일·압축본 캐시(서명 URL 쿼리 파라미터 캐시 키 제외 표준 정책) | NFR-U7-PERF-04·05 |
| 서명 키 | **CloudFront 키 그룹**(퍼블릭 키 등록) + **개인 키 = Secrets Manager** | PAT-SEC-05, SI §6 |

**서명 URL 흐름**

```text
[클라] --조회 요청(인증)--> [ECS: 소유권 검증(accountId)] --발급--> [CloudFront 서명 URL(짧은 만료)]
                                                                          |
[클라] <-------------- 이미지(TLS) ---------------- [CloudFront(엣지 캐시)] --OAC--> [S3 photos(퍼블릭 차단)]
```

클라이언트가 인증된 조회 요청을 보내면 ECS가 accountId 소유권을 검증한 뒤 짧은 만료의 CloudFront 서명 URL을 발급한다. 클라는 그 URL로 CloudFront 엣지 캐시에서 이미지를 TLS로 받으며, CloudFront는 OAC로만 퍼블릭 차단된 S3 photos 오리진에 접근한다. 비소유자·만료 URL은 거부된다. 목록은 썸네일 URL, 상세는 압축 원본 URL.

### 7.4 이미지 처리 — 클라 전처리 기본 + 서버 썸네일 (신규 컴퓨트 0)

- **클라 전처리(기본)**: 압축(5MB/2048px) + EXIF GPS 제거(G168 원본 GPS 기기 이탈 방지). 원본 기기 보관(G75).
- **서버 썸네일(앱 ECS 동기)**: 클라가 압축본을 S3에 직업로드 후 **attach 확정 API** 호출 → 서버가 S3에서 압축본 읽어(S3 게이트웨이 엔드포인트) **EXIF 재검증·재제거(심층 방어)·매직 바이트·크기 검증** → 썸네일 생성·S3 업로드 → 메타 저장.
- **Lambda·EventBridge 미도입**(G142): 썸네일 트리거는 **attach API**(S3 이벤트 아님)이므로 서버리스 파이프라인 불요. 저빈도(DAU 1천·첨부 시점)로 기존 ECS 태스크 2개가 흡수 — 신규 컴퓨트 0.
- **전환 트리거**: 사진 처리량이 ECS API p95에 간섭하거나 월 처리 수만 장 초과 시 Lambda 썸네일 분리 재평가.

```text
[클라] 압축·EXIF제거 ─presigned PUT─> [S3 photos: 압축본]
   │                                        ▲(썸네일 write)
   └─ attach 확정 API ─> [ECS: EXIF 재검증·매직바이트·크기 → 썸네일 생성] ─┘
                              │
                              └─> [RDS: 사진 메타(스토리지 키·썸네일 키)]
```

### 7.5 사진 메타·changelog·GPS 파기 — RDS 스키마 확장 (U1 재사용)

- **저장소**: SI §3 **기존 RDS PostgreSQL**(단일 `trippilot` DB·`public` 스키마) 재사용 — **신규 DB 인스턴스·클러스터 없음**. U1 Flyway 파이프라인(배포 전 일회성 `app_migrate` 태스크)으로 U7 마이그레이션 적용.
- **U7 신규 테이블(~7개)**: actual 방문 기록·사진 메타(스토리지 키·썸네일 키·촬영 시각·귀속)·changelog(통합 diff G132)·회고(초안/수정본·유형)·스타일 분석 결과·동기화 버전(레코드 단위 G74)·이동 거리 집계(G72). 전부 `app_user` 표준 DML — append-only REVOKE 대상 아님(일반 CRUD).
- **위치정보 법정 로그 — U1 append-only 재사용**: GPS 처리 사실 로그는 U1이 생성한 append-only 테이블(`location_legal_log`)에 기록. `app_user` UPDATE/DELETE REVOKE·IAM 명시 Deny 2중 강제 유지(신규 테이블 아님).
- **GPS 파기(D34/N2·PAT-U7-06)**: GPS 옵트인 철회·탈퇴 시 위치 데이터(발자취 폴리라인·GPS 귀속) **즉시 파기**. 파기는 철회 이벤트 즉시 처리 또는 ShedLock 잡. **법정 로그는 파기 대상 아님**(6개월+ 보존·append-only 잔존 — 파기 잡 권한은 위치 데이터 테이블 한정). 계정 삭제 연쇄(D18)에서도 법정 보존 집합만 잔존(U8 연쇄 정합).
- **볼륨**: DAU 1천·활성 여행 ≤1/사용자(D21)로 기록·메타는 소량 — SI §3 gp3 20GB(오토스케일 100GB) 내 충분. 사진 바이너리는 S3, RDS는 메타·키만.

### 7.6 회고 LLM·시크릿·KMS (U5 재사용 + 증분 항목)

- **회고 LLM = U5 C1 재사용**(신규 인프라·벤더 0): M13 회고·요약·스타일 분석은 U5 C1 LLM Gateway를 상위 티어(D11)로 호출. **LLM API 키는 U5에서 등록한 Secrets Manager 항목** 재사용 — U7 신규 시크릿 없음. NAT 아웃바운드·A11·A12 알람도 U5 상속.
- **CloudFront 서명 키(신규 시크릿 항목)**: 서명 URL 개인 키를 **Secrets Manager 신규 항목** `cloudfront/photo-signing-key`로 보관. 퍼블릭 키는 CloudFront 키 그룹 등록. ECS 태스크 역할 `secretsmanager:GetSecretValue`(명시 ARN) 주입 — 코드·이미지·Terraform state 평문 0.
- **KMS — CMK 재평가 결과**: SI §6 "사진 버킷은 U7에서 CMK 필요성 재평가"를 종결. **재평가 결론: `aws/s3` 관리형 키 유지(CMK 미도입)**. 근거: 서명 URL·OAC 접근 제어가 CloudFront/S3 정책 계층에서 종결되어 KMS 키 정책 분리가 추가 통제를 주지 않고, CMK는 월 $1/키 + 운영 부담. **전환 트리거**: 사진 데이터에 크로스 계정 공유·키 정책 분리·규정 요구 발생 시 CMK 도입.

### 7.7 SI 대비 델타 표

| 계층 (SI 절) | 신규 AWS 리소스 | 변경 | 근거 |
|---|---|---|---|
| 컴퓨트 ECS (SI §1) | **0** | 0 — 썸네일 생성·기록 조회는 기존 태스크 2개 흡수(저빈도·attach 트리거) | §7.4, NFR-U7-SC-03, G142 |
| 네트워크 VPC·NAT·ALB (SI §2) | **0** | 0 — S3 게이트웨이 엔드포인트·`sg-app` 재사용. LLM NAT 아웃바운드 U5 상속 | §7.2·§7.6 |
| 데이터베이스 RDS (SI §3) | **0** | **테이블 ~7개**(actual·사진 메타·changelog·회고·스타일·동기화 버전·이동 거리) — 기존 RDS·Flyway 확장. 법정 로그 U1 재사용 | §7.5 |
| **스토리지 S3 (SI §5.2)** | **활성화 — `trippilot-{env}-photos` 버킷** | 버저닝·SSE-KMS·수명주기(30일)·OAC 정책·presigned | **§7.2, SI §5.2 예약 활성화** |
| **CDN CloudFront (SI §5.4)** | **활성화 — CloudFront 배포** | OAC·서명 URL·TLS1.2+·표준 로깅·키 그룹 | **§7.3, SI §5.4 예약 활성화** |
| 시크릿·KMS (SI §6) | **0**(서비스) | **Secrets Manager 항목 1개**(`cloudfront/photo-signing-key`) + **CMK 재평가=aws/s3 유지**. LLM 키 U5 재사용 | §7.6 |
| 관측성 CloudWatch (SI §8) | **0** | 사진 스토리지·CDN 비용 A15 편입·업로드 실패율·회고 폴백율 커스텀 메트릭·CloudFront 로깅 | PAT-OBS-03, SI §8.2 A15 |
| 회고 LLM (U5 C1) | **0** | 0 — U5 C1·LLM 키·NAT·A11/A12 전부 재사용 | §7.6, U5 |

**총계**: 신규 AWS 리소스 = **S3 photos 버킷 활성화 + CloudFront 배포 활성화**(SI §5.2·§5.4 예약분) / 그 외 = RDS 스키마 확장(~7 테이블) + Secrets Manager 항목 1개 + 관측성 편입. U7은 사진 스토리지·CDN이 실질 증분인 첫 유닛이나 SI가 예약해 둔 자리를 활성화하는 것이므로 아키텍처 이탈 없이 종결된다.

### 7.8 배포 — shared 파이프라인 재사용 + Terraform storage 모듈 활성화

U7은 별도 배포 아키텍처 문서를 만들지 않고 전역 배포 파이프라인 정본(deployment-architecture.md, U1 스캐폴드)을 재사용한다. 인프라 증분은 Terraform storage 모듈 활성화로 반영한다.

- **인프라(Terraform)**: SI §11.2 `modules/storage`의 "photos/CloudFront는 자리만 생성(U7 활성화)"를 **활성화** — S3 photos 버킷 정책·수명주기·CloudFront 배포·OAC·서명 키 그룹·Secrets Manager 항목을 storage/security 모듈에 추가. `terraform plan` diff가 PR 리뷰 산출물, apply는 수동 승인. 적용 순서: security(서명 키)→storage(버킷·CloudFront). 프로바이더·모듈 버전 고정(SECURITY-10 IaC).
- **서버(M12·M13 모듈 + 마이그레이션)**: `server/**` 경로 — `server-ci.yml`·`server-deploy.yml` **수정 없이** 커버. Flyway forward-only(신규 테이블 추가 = N-1 호환 "자유", OPS-01). 롤백=버전 고정 재배포(GD-4)·롤링(GD-5) 상속. 서명 키는 배포 전 Secrets Manager 등록.
- **모바일(U7 화면 + `shared/storage` 오프라인 큐 + 클라 이미지 압축/EXIF)**: `apps/mobile/**` 경로 — `mobile-ci.yml`(tsc·ESLint·Jest+fast-check) 커버. **클라 이미지 압축·EXIF strip 라이브러리가 네이티브 모듈이면 EAS Build 재빌드 필요**(순수 JS면 OTA 가능 — Code Generation 확정). `shared/storage` 로컬 큐 저장 엔진(SQLite/MMKV류)도 동일 판정.
- **환경**: dev(자동)·prod(승인 게이트) 승격 상속. dev photos 버킷·CloudFront는 축소 사양이나 **보안 기준선(퍼블릭 차단·SSE·서명 URL·OAC)은 양 환경 동일**(dev 완화 금지).

### 7.9 컴플라이언스 요약 (확장 규칙)

| 규칙 | 판정 | 근거 |
|---|---|---|
| SECURITY-01 암호화 | **준수(핵심)** | S3 SSE-KMS·TLS-only·CloudFront TLS1.2+ — 사진 스토리지 첫 도입분 |
| SECURITY-02 액세스 로깅 | 준수 | CloudFront 표준 로깅 활성 |
| SECURITY-05 입력 검증 | **준수(핵심)** | presigned 조건(크기·타입)·attach 재검증(매직 바이트·EXIF)·메모 새니타이즈 |
| SECURITY-08 접근 제어 | **준수(핵심)** | 서명 URL 소유권 스코핑(IDOR 차단)·accountId 프리픽스 IAM 경계 |
| SECURITY-09 하드닝 | **준수(핵심)** | 퍼블릭 전면 차단·OAC·기본 루트 객체 없음(디렉터리 리스팅 불가) |
| SECURITY-11 LLM 경계 | 준수(상속) | 회고 C1 서버 재조회·rate-limit U5 상속 |
| SECURITY-14 로깅·법정 로그 | **준수(핵심)** | GPS 파기(D34)·append-only 법정 로그 U1 재사용, 파기/보존 분리 |
| SECURITY-03·04·06·07·10·12·13·15 | 상속/준수 | 로깅·헤더·공급망·자격 증명(서명 키 Secrets Manager)·무결성·예외 처리 U1 스캐폴드 상속·S3 게이트웨이 엔드포인트(NAT 우회) |
| RESILIENCY-01 워크로드 분류 | **준수(핵심)** | M12·M13 High(오프라인 큐 입력 보존·회고 지연 폴백) |
| RESILIENCY-10 의존성 격리 | 준수(상속·증분) | 회고 C1 U5 서킷·타임아웃 상속·사진 업로드 재시도 |
| RESILIENCY-02·08·11·12 | 준수(증분)/상속 | 사진 버킷 버저닝(백업성 RESILIENCY-12)·Multi-AZ·오토스케일 SI 상속 — U7 신규 워크로드 없음 |
| RESILIENCY-05·07 | 준수(증분) | 사진 비용 A15·업로드 실패율·회고 폴백율 계측 편입 |
| RESILIENCY-03·04·14·15 | 상속 | 변경 관리·롤백·복원력 테스트 전역 결정(GD-2~7)·deployment-architecture.md 상속 |
| PBT-01~10 | 준수(핵심 · 현 단계분) | 오프라인 무손실 병합(PAT-U7-01)·changelog 재구성(PAT-U7-04, G132)이 U7 PBT 효용 최대 영역 — 실행은 Code Generation |

**차단 소견 없음.** U7은 사진 스토리지·CDN이 실질 인프라 증분인 첫 유닛이며, SI가 §5.2·§5.4에 예약한 자리(S3 photos 버킷·CloudFront)를 활성화해 아키텍처 이탈 없이 종결한다. CMK 재평가(=aws/s3 유지)로 SI §6 단서를 종결하고, 회고·컴퓨트·DB·LLM은 U5·U1·SI 정본을 재사용한다(과설계 금지 — Lambda·EventBridge·전용 트랜스코딩·ElastiCache 미도입).
