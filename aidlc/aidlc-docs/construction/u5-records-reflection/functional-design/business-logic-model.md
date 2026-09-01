# U5 Records & Reflection — Business Logic Model

> **유닛**: U5 — **C12 Travel Archive**(plan/actual/changelog 3계층 열람 책임 · 방문 실적·사진메타·메모 소유) · **C13 AI Reflection/Summary**(당일 회고·여행 요약·스타일 분석)
> **스토리**: US-REC-01~14 (14개) · **라이브 Figma 밴드 `j`** 17프레임(코드 7·결번 없음)
> **전제**: U0·U1·U2·U3·U4 설계 종료. **U4의 `visit_check`·`change_log_entry`·`actual_route_point` 결정이 직접 전제다**
> **답변(2026-08-22)**: Q1=A · **Q2=A+B 병행** · Q3=A · Q4=A · **Q5=B** · Q6=A · Q7=A · Q8=A · Q9=A
> **실장 우선**(사용자 지시): 리포 실물 > 패키지 계약 정본 > 라이브 Figma > 기존 aidlc 산출물 > 인셉션. 충돌 시 인셉션을 정정 상신 대상으로만 기록한다

---

## 0. 이 유닛이 특별한 이유 — 신설이 아니라 승계다

U3·U4는 백엔드가 통째 신규였다. U5는 아니다.

- `visit_check`(V2.21) 테이블 + 코드 4파일 + **openapi `/trips/{tripId}/visits*` 5경로**가 실재한다 → **US-REC-01은 백엔드 계약까지 이미 완료**다.
- V2.21 주석이 U5에 남긴 지시가 있다: *"이 테이블은 U5 C12 Travel Archive 로 이관 예정이고, 확장은 U5 가 승계한다. 여기서 미리 늘리면 이관 시 두 설계가 충돌한다"* — **사진·메모 컬럼을 일부러 만들지 않았다**(G-U4-5).
- `change_log_entry`(V2.11) + `change-log` 모듈도 선재하고 U4가 이미 쓴다.

그래서 이 문서의 첫 일은 **경계 정리**다. 무엇을 U5로 옮기고(§2), 무엇을 두고 읽기만 하고(§3), 무엇을 새로 만드는가(§4).

---

## 1. 3계층 소유 지도 (US-REC-04 · ADR-0013)

| 계층 | 뜻 | 물리 | 소유 유닛 | U5의 관계 |
|---|---|---|---|---|
| **plan** | 가기로 한 것 | `itinerary` · `visit_slot` | **U3**(생성) · U4(재계획으로 갱신) | **읽기만.** U5는 계획을 쓰지 않는다 |
| **actual** | 실제로 간 것 | `visit_check` + **U5 신설** `visit_photo_meta`·`visit_memo` | **U5**(이 유닛이 소유·확장) | 쓰기 주체 |
| **actual(경로)** | 어떻게 움직였나 | `actual_route_point` | **U4 유지**(DEC-U5-6 · Q5=B) | 읽기만 |
| **changelog** | 무엇을 왜 바꿨나 | `change_log_entry` | **`change-log` 모듈 유지**(DEC-U5-8 · Q8=A) | 읽기 소비자 |

**DEC-U5-1** — C12의 "3계층 소유"는 **데이터 모델 소유가 아니라 열람 책임**으로 해석한다. 인셉션 `components.md`의 "plan/actual/changelog 소유" 표기는 이 해석으로 정정 상신한다(G-U5-1). 근거: plan은 U3가 생성하고 U4가 갱신하는 살아 있는 데이터라 U5로 옮길 수 없고, changelog는 append-only 계약을 U4가 이미 쓰고 있어 옮기면 그 계약을 건드린다.

---

## 2. 결정 (DEC-U5-\*)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U5-1** | C12의 3계층 "소유" = **열람 책임**. 물리 소유는 위 표대로 갈린다 | §1 |
| **DEC-U5-2** | **`archive` 모듈을 신설하고 `visit_check`를 이관한다**(Q1=A). 테이블은 그대로 — 코드 4파일(`domain/VisitCheck.kt`·`application/VisitCheckService.kt`·`adapter/in/web/VisitCheckController.kt`·`adapter/out/persistence/VisitCheckPersistence.kt`)과 테스트 3이 `itinerary-recalculation` → `archive`로 옮겨간다. **마이그레이션 불필요** | V2.21 주석의 명시 지시. 사진·메모 확장이 U5 모듈 안에서 닫힌다 |
| **DEC-U5-3** | 이관 후 U4는 **`ArchiveFacade.getCompletedSlots(tripId)`로 완료 슬롯을 읽는다**. INV-U4-04(완료 슬롯은 재계획에서 불변)의 판정 입력이 모듈 경계를 넘는다 — 동기 public facade, 순환 없음(U5는 U4를 부르지 않는다) | 모듈 규약: 다른 모듈의 `api`만 의존 |
| **DEC-U5-4** | **`reflection` 모듈을 신설한다**(C13). `archive`와 나누는 이유: 회고는 LLM·폴백·캐시를 갖는 딥 모듈이고, 기록은 CRUD·동기화가 본체다. `reflection`은 `ArchiveFacade`를 소비하되 역방향 의존은 없다 | `components.md` C13 "딥 모듈" |
| **DEC-U5-5** ★ | **회고 생성은 포트 1개 + 어댑터 2개**(Q2=A+B 병행). `ReflectionGeneratorPort` 뒤에 ① `VendorLlmReflectionAdapter` ② `AiServiceReflectionAdapter`(`ai/` HTTP). 스위치는 리포 선례 `AI_SCHEDULE_MODE=fake\|http`와 같은 꼴의 **`AI_REFLECTION_MODE=rule\|llm\|http`** | 포트+어댑터 구조와 모드 스위치 **패턴**은 실물 승계(`ScheduleAgentPort` + `FakeScheduleAgent`/`HttpScheduleAgentAdapter`). ⚠ **어댑터 ①의 근거는 2차 셀프 검수에서 정정됐다** — 아래 |
| **DEC-U5-5 정정(2026-08-22 · 2차 셀프 검수)** ★ | **`LlmGatewayPort`는 backend에 존재하지 않는다.** `grep -ril "llmgateway" backend/` = **0건**이고, backend의 LLM 관련 자산은 `ScheduleAgentWire`·`FakeScheduleAgent`·`HttpScheduleAgentAdapter`(= `ai/` **호출** 어댑터)뿐이다. LLM 게이트웨이 실체는 **`ai/` 패키지가 소유**한다. 따라서 어댑터 ①은 "기존 U2 자산 재사용"이 아니라 **LLM 벤더 직결 신규 구축**이다 — 키·비용·레이트리밋·프롬프트 관리가 backend에 새로 생기고, "one external API = one owning module = one adapter port" 규칙상 **LLM 소유 모듈이 둘로 갈린다** | 초안은 "U2 게이트웨이가 실재"를 전제했는데 **실측에서 없었다**. 결과: 기본값을 **`rule`로 둔다**(즉시 가능·외부 의존 0). `llm`·`http` 중 무엇을 먼저 열지는 **O-U5-6**에서 사용자 결정 — 정본 정합만 보면 LLM 소유가 `ai/`에 있으므로 **B(`http`)가 더 맞다** |
| **DEC-U5-6** | **`actual_route_point`는 U4가 소유·신설하고 U5는 읽기만 한다**(Q5=B). G-U4-5("U5 C12가 승계")를 **철회**하고 U4 `domain-entities.md §3.1·§3.3` 각주를 정정한다(G-U5-2) | 사용자 결정. Plan-B 기준점 계산이 이 점열의 1차 소비자다 |
| **DEC-U5-7** | 기록의 **쓰기 주체는 `i01`(여행 중)·`j01`(기록 탭) 양쪽**이고 규칙은 U5가 소유한다(Q6=A). 두 화면 모두 `ArchiveFacade`를 호출하며, U5는 `i01`의 기록 요소를 **컴포넌트 재사용 대상으로 명시**한다 | 한쪽을 막으면 경로가 사라진다 — G-U4-7이 이미 "완료 후 기록 진입점 없음"을 지적했다 |
| **DEC-U5-8** | `change_log_entry`는 **`change-log` 모듈 유지**, C12는 읽기 소비자(Q8=A) | 실장 우선. append-only 계약을 U4가 쓰고 있다 |
| **DEC-U5-9** | 사진은 **로컬 자산 참조 + 서버 메타데이터만**(Q3=A). `ObjectStoragePort`는 **U7 게이트까지 미개통** — `uploadForCommunity`는 인터페이스로만 두고 구현하지 않는다 | 인셉션 2026-07-12 결정 유지. 선재 dbml `photo.storage_key`는 정정 대상(G-U5-3) |
| **DEC-U5-10** | 오프라인은 **화면대로 전부 설계**(Q4=A) — 로컬 큐 + `syncState` 4상태 + 충돌 시 사용자 선택 | `j01`에 `offline`·`sync-conflict` 프레임이 실재. 축소하면 그린 것을 못 쓴다 |
| **DEC-U5-11** | 스타일 분석은 **U5가 산출·소유**하고 개인화 소비 계약만 정의한다. U3는 정정하지 않고 갭으로 남긴다(Q7=A) | U3 설계 종료 — 재개는 별도 지시 |
| **DEC-U5-12** | 회고·요약의 **이동 거리는 서버가 산출하지 않는다**(§6 참조). 1차 산출 주체는 클라이언트다 | Q5=B의 파생 결과 — §6에서 전개 |
| **DEC-U5-13** | **누적 통계의 평균 체류 시간은 표시할 수 있다**(`j05` `평균 체류 72분`). 단 **개별 방문의 체류 시간은 U4·U5 화면 모두에서 노출하지 않는다** — 두 층을 가르는 선이 여기다 | **INV-U4-03**이 명시: "INV-3은 *예측 소요시간*의 표시 금지이고 사후 실적은 **U5 기록 소관**". INV-3(`ai/README.md`: "소요시간 미표시 — 거리만")은 솔버 미검증 *예측치*를 막는 규칙이지, 사후 실적 통계를 막는 규칙이 아니다 |
| **DEC-U5-14** ★ | **회고 산출물은 카드이고, 백엔드는 그것을 모델링하지 않고 보관·중계한다**(2026-09-01 사용자 결정). `draft_card`/`edited_card` 를 jsonb 로 두고 `template_id`·`card_format` 을 버전 키로 쓴다. `cover`/`scenes` 안쪽은 **재검증하지 않는다** | G-U5-4 해소로 실계약이 카드로 확인됐다(§5.3). 우리가 카드를 모델링하면 상대 템플릿 추가가 곧 우리 마이그레이션이 된다 — 그때는 문장 모델이 차라리 낫다. **`DEC-U5-5a`(source 를 항상 싣는다)는 바뀌지 않는다** — 3단 폴백의 관측 근거라 카드에서도 그대로 필요하다 |

---

## 3. 이관 집행 (DEC-U5-2)

### 3.1 옮기는 것 / 두는 것

| 대상 | 처리 |
|---|---|
| `visit_check` 테이블(V2.21) | **그대로 둔다.** 스키마 canon은 Flyway forward-only — 테이블 이동은 없다 |
| 코드 4파일 + 테스트 3 | `itinerary-recalculation` → **`archive`** 로 패키지 이동(`com.trippilot.recalculation.*` → `com.trippilot.archive.*`) |
| openapi `/trips/{tripId}/visits*` 5경로 | **경로·스키마 불변.** `tags: [trips]`도 유지 — 클라이언트 계약을 흔들지 않는다. 소유 모듈만 바뀐다 |
| `VisitCheckService`가 U4에 주던 입력 | `ArchiveFacade`로 승격(§3.2) |
| `AUTO_GEOFENCE` 소스값 | 지오펜스는 U4 소관이고, U5는 **값을 받아 저장할 뿐** 지오펜스를 소유하지 않는다 |

### 3.2 `ArchiveFacade` (C12 · `component-methods.md` 갱신분)

인셉션 4메서드에서 출발하되 실장·화면이 요구하는 것을 더한다.

| 메서드 | 용도 | 인셉션 대비 |
|---|---|---|
| `checkVisit(cmd)` → `VisitCheck` | 도착 체크·즉석 방문 (openapi `POST /visits`) | 그대로 |
| `completeVisit` / `skipVisit` / `adjustTimes` | 완료·건너뜀·시각 보정 | **신규**(실장에 이미 있다 — 인셉션이 얇았다) |
| `attachPhotoMeta(visitCheckId, meta)` | 로컬 자산 참조 저장 | 그대로 |
| `writeMemo(visitCheckId, text)` | 메모 upsert | **신규**(`j01` 인라인 메모) |
| `getRecords(tripId)` → `TripRecords` | plan/actual/changelog **3종 합본** | 그대로. ⚠ **changelog 조인 경로가 없다** — 아래 |
| `getCompletedSlots(tripId)` → `Set<SlotKey>` | **U4 재계획 잠금 판정 입력**(DEC-U5-3) | **신규** |
| `getVisitStats(tripId, date?)` → `VisitStats` | 방문 수·사진 수 (회고 stats 입력) | **신규**. **이동 거리는 포함하지 않는다**(§6) |
| ~~`uploadForCommunity`~~ | U7 게이트까지 **미개통**(DEC-U5-9) | 인터페이스만 |

> ⚠️ **`ChangeLogFacade`에 조회 메서드가 없다(2차 셀프 검수 실측 · G-U5-12).** 실물 인터페이스는 **`append(command)` 단 하나**다 — 타 모듈이 변경 이력을 *읽을* 진입점이 존재하지 않는다. 읽기는 REST(`ChangeLogController.timeline`, `@GetMapping`)로만 뚫려 있다. 따라서 두 갈래다:
> **(a)** `ChangeLogFacade`에 `findByTrip(tripId, limit)` **조회 메서드를 추가**한다(모듈 계약 확장 — U4도 이미 쓰는 facade라 팀 확인 필요).
> **(b)** `getRecords`는 plan+actual만 합치고, **화면이 changelog REST를 따로 호출**한다(`j02 변경` 탭이 별도 호출).
> **기본은 (a)** — `j02`가 세 계층을 한 화면에서 라벨로 섞어 그리므로 서버가 합쳐 주는 편이 시각 정합에 맞다. 다만 **BR-U5-29("U5는 change_log_entry를 읽기만 한다")가 성립하려면 이 확장이 선행**돼야 한다.

---

## 4. 기록 흐름 (C12)

### 4.1 방문 → 사진·메모

```
[i01 여행중] 또는 [j01 기록탭]
   │  방문 완료 체크 ─────────────► POST /visits (없으면 생성) → POST /visits/{id}/complete
   │                                      └─ VisitChecked 이벤트 → U4 Plan-B 체류 입력 · U6 알림
   │  사진 + 탭 ──► 기기 앨범 선택 ──► LocalPhotoAssetPort(로컬 자산 ID 확보)
   │                                └─ POST /visits/{id}/photos  { assetId, takenAt, exifLat?, exifLng? }
   │                                     ⚠ 바이너리는 올리지 않는다(DEC-U5-9)
   └─ 메모 입력(blur) ──────────────► PUT /visits/{id}/memo { text }
```

- **즉석 방문**: `slotKey`를 비우고 `POST /visits` — 실장에 이미 있다. `j01`의 `+ 즉석 방문 추가`가 이 경로다.
- **계획에 없던 곳이어도 계획을 건드리지 않는다** — actual 계층에만 쌓인다.

### 4.2 오프라인·동기화 (US-REC-12 · DEC-U5-10)

```
오프라인 입력 → 로컬 큐(syncState=LOCAL) → 화면에 '동기화 대기' 배지(j01 offline)
   └─ 네트워크 복구 → 순서대로 재생(PENDING) → 성공 SYNCED
                                    └─ 서버가 이미 다른 값 → CONFLICT → j01 sync-conflict
                                          └─ 사용자 선택: [내 기기 것으로] | [서버 것으로]
```

- 큐는 **기기 로컬**이다(서버에 큐 테이블을 두지 않는다). 서버는 마지막 상태만 안다.
- 충돌 판정 기준은 `visit_check.updated_at` 비교다(BR-U5-22).
- **오프라인 구간의 회고는 생성하지 않는다** — 복구 후 생성하거나 기본 카드로 대체한다(US-REC-12 예외).

### 4.3 숙소·날짜 귀속 (US-REC-05)

- 귀속은 **저장 시점이 아니라 조회 시점의 파생**이다. `visit_check.arrived_at`(여행지 기준 날짜) → `base_assignment`·`trip_base_day`(V2.4)에서 그 날짜를 덮는 기준 숙소를 찾는다.
- 이동 숙박이면 날짜별로 다른 기준 숙소가 나오고, 없는 날은 **날짜만**으로 묶는다.
- 파생으로 두는 이유: 숙소가 나중에 바뀌어도 기록이 따라 움직여야 한다. 저장해 두면 두 값이 어긋난다(V2.21이 체류를 파생으로 둔 것과 같은 논리).

---

## 5. 회고 생성 (C13 · DEC-U5-5)

### 5.1 폴백 사슬 — 3단 (ADR-0011 · INV-4)

```
① AI 서술        AI_REFLECTION_MODE=llm|http → ReflectionGeneratorPort
      │ 실패·시간초과·부적합
      ▼
② 규칙 문장      템플릿: "오늘은 {대표장소} 등 {N}곳을 방문했어요. {D}km를 이동했고 사진 {P}장을 남겼어요."
      │ 통계조차 비었을 때
      ▼
③ 기본 카드      "방문 N곳 · 이동 Nkm · 사진 N장" 수치만 — **비어 있지 않음이 불변식**(PBT-U5-1)
```

**②가 라이브 화면의 정본 문안이다.** `j03 default`의 본문이 정확히 이 형태다("오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요.") → **①과 ②가 화면에서 구분되지 않는다**(D-U5-1). 이 사실을 감추지 않는다:

**DEC-U5-5a** — 회고 응답은 `source: AI | RULE | BASIC` 을 **항상 싣는다**. 화면이 지금은 구분해 그리지 않더라도, 서버가 무엇으로 만들었는지는 계약에 남는다. 침묵 실패 금지(INV-4)의 최소 조건이고, 나중에 "AI가 실제로 값을 더하는가"를 측정할 유일한 근거다.

### 5.2 어댑터 2종의 계약 (병행)

| 모드 | 구현 | 상태 |
|---|---|---|
| `rule` | 템플릿만. AI 호출 0 | ✅ **기본값** — 즉시 가능, 외부 의존 0. `j03` 라이브 문안이 이 형태다(D-U5-1) |
| `llm` | **LLM 벤더 직결 신규 포트**(backend 소유 프롬프트·키·비용) | ⚠ **신규 구축**이다. `LlmGatewayPort`는 backend에 **없다**(2차 검수 실측). LLM 소유 모듈이 `ai/`와 둘로 갈리는 대가가 있다 |
| `http` | `ai/` `POST /ai/v1/reflection/{generate,nudge}` | ✅ **개통 대상으로 확정**(2026-09-01 사용자 결정, O-U5-6 해소). 상대 표면이 실재한다(G-U5-4 해소) — 계약은 §5.3 |

### 5.3 `ai/` 표면 실계약 (2026-09-01 실측으로 초안 교체 · G-U5-4 해소)

> **초안과 실물이 다르다.** 아래 세 줄이 원래 초안이었다:
> `daily`·`summary`·`style` 세 경로가 각각 `{ narrative, source }` 를 돌려주는 형태.
> **AI 팀이 실제로 연 것은 두 경로이고 산출물이 문장이 아니라 카드다**(TRIP-429·430 완료).
> 정본이 틀린 게 아니라 초안이었고(G-U5-4 가 "AI팀 협의 선행"이라 열어 뒀다), 협의 결과가 이것이다.

```
POST /ai/v1/reflection/generate  { request_meta, kind, region, start_date, end_date, visits[],
                                   persona_summary?, events?, weather_summary? }
                                 → { template_id, kind, format, generated_at, is_fallback,
                                     cover{title, subtitle, photo_slot?}, scenes[]{layout, caption,
                                     photo_slot?, source_event?}, hashtags[]? }
POST /ai/v1/reflection/nudge     { request_meta, destination, trip_days, highlight_places?,
                                   persona_summary? } → { message, is_fallback }
```

정본 = `ai/docs/openapi.json`(AI CI 가 실행 앱과 일치를 강제한다). 위는 그 시점 사본이다.

`persona_summary` 는 **이미 채울 수 있다** — 백엔드가 `GET /internal/users/{accountId}/persona` 를 열어 뒀다(2026-09-01). 그 표면은 계정 취향 스냅숏을 우리 어휘 그대로 낸다.

**산출물이 카드인 것의 파급 — 이 유닛이 지는 값이다.**

- `cover`·`scenes[].photo_slot`·`source_event` 는 **사용자 사진을 특정 장면에 묶는 장치**다. 문장 하나로는
  표현할 수 없고, `j03` 이 사진을 붙이는 화면인 이상 카드가 실제 산출물이다.
- 그래서 **폴백도 카드여야 한다**(BR-U5-32). 규칙 단이 문장을 내면 AI 가 죽는 날 화면 모양 자체가
  달라진다 — 폴백의 뜻이 "같은 화면을 근거만 줄여 그린다"인데 그것이 성립하지 않는다.
- 백엔드는 **카드를 모델링하지 않고 보관·중계한다**(**DEC-U5-14**). `template_id`·`format` 이 버전 키고,
  `cover`/`scenes` 안쪽은 재검증하지 않는다 — 우리가 깊이 검증하면 상대 템플릿 추가가 곧 우리
  마이그레이션이 된다.

- **INV-1 무관**(후보 선택이 아니라 서술 생성) · **INV-2 무관**(시각·순서를 만들지 않는다) · **INV-3 준수**(소요시간 필드 없음).
- 근거 데이터를 입력으로 받고 **환각 금지** — 입력에 없는 장소·수치를 서술에 넣지 않는다(BR-U5-31).

**초안 대비 남은 공백 2건**(닫지 않고 갭으로 올린다):

- `style` 경로가 **없다**. 스타일 분석(`j05`)은 계속 백엔드 로컬 산출이다 → **G-U5-15**
- `nudge` 는 **소비처가 없다**. 여행 전 넛지 화면이 U5 범위 밖이다 → **G-U5-16**

### 5.4 여행 요약 · 스타일 분석

- **요약(US-REC-08)**: `TripEnded` 이벤트 수신 → 날짜별 하이라이트 + 총계. 위치 데이터가 전혀 없으면 지도 대신 방문 목록으로 대체(`j04 error` 폴백).
- **스타일(US-REC-09)**: **누적 방문 ≥ 10** 임계. 미만이면 `j05 data-insufficient` — "현재 N곳/필요 10곳" + 온보딩 취향 기반 임시 미리보기(**정식 아님 명시**).
- 스타일은 **account 단위**라 여행 생애주기와 다르다 — 여행이 지워져도 남는다(§domain-entities INV-U5-08).

---

## 6. 이동 거리 — 계약 공백 (DEC-U5-12 · ★ G-U5-5)

회고·요약의 `12km`·`38km`가 어디서 나오는지 실측했다.

| 사실 | 근거 |
|---|---|
| `actual_route_point`는 **마이그레이션이 없다** — 테이블이 존재하지 않는다 | V2.14~V2.27 실측 |
| 실제 경로 점열은 **프런트에만 있다** — `features/execution/model/actualDistance.ts`(하버사인 누적) | 리포 실측 |
| 그 점열의 수집은 **아직 배선되지 않았다** — `useActualRoute()`가 `{ locationConsent: false, points: [] }` 고정 | 같은 파일 주석: "네이티브 위치 워치·권한 승격을 붙일 자리" |
| Q5=B로 `actual_route_point` 소유는 **U4**에 남았다 | DEC-U5-6 |

→ **U5는 서버에서 실제 이동 거리를 산출할 수 없다.** 세 갈래뿐이다:

- **(a) 클라 산출 → 서버 전송**: 회고 요청에 `actualDistanceKm`을 실어 보낸다. 서버는 검증할 근거가 없다(신뢰 경계 문제).
- **(b) 방문점 연결선 근사**: `visit_check`의 POI 좌표를 순서대로 이어 잰다. 서버만으로 가능하고 결정론적이지만 **실제 동선이 아니다**.
- **(c) U4가 `actual_route_point`를 실장할 때까지 이동 거리 미표시**: `j03`·`j04`의 stats 한 칸이 빈다.

**DEC-U5-12** — 1차는 **(b) 방문점 연결선 근사**를 서버 기본값으로 하고, 응답에 `distanceSource: ROUTE | VISIT_LINE` 을 싣는다. 클라가 실제 경로를 갖고 있으면 화면에서 그 값으로 덮되(**표시만**), 서버 저장값은 근사치를 유지한다. `actual_route_point`가 실장되면 `ROUTE`로 승격한다.
근거: (a)는 검증 불가값을 서버 통계로 굳히고, (c)는 그려진 화면을 비운다. (b)는 둘 다 피하면서 승격 경로가 열려 있다. **이 결정은 U4 실장에 의존하므로 갭으로 올린다(G-U5-5).**

---

## 7. 이벤트

| 이벤트 | 발행 | 구독 | 비고 |
|---|---|---|---|
| `VisitChecked` | **U5 `archive`**(이관 후) | U4 Plan-B(체류 초과 판정) · U6 알림 | 발행 주체가 U4→U5로 바뀐다 — 이관의 유일한 이벤트 영향 |
| `TripEnded` | U1 `trip` | **U5 `reflection`**(요약 생성) · U6 알림 | 기존 |
| `ReflectionReady` | **U5 `reflection`** | U6 알림(`j03` 인앱 카드/푸시) | **신규** — US-REC-06 "인앱 카드/푸시로 알린다" |

아웃박스 경유(at-least-once·멱등 구독자) — U0 스캐폴딩 그대로.

---

## 8. 갭 (G-U5-\*)

| ID | 갭 | 처리 |
|---|---|---|
| **G-U5-1** | 인셉션 `components.md` C12의 "plan/actual/changelog 소유" 표기 | **열람 책임**으로 정정 상신(DEC-U5-1) |
| **G-U5-2** | U4 `domain-entities.md §3.1·§3.3` 각주 "소유는 U5로 이관 예정" | ✅ **반영 완료(2026-08-22)** — 두 각주에 U5 결정 블록을 소급 기록했다. `visit_check`는 이관(Q1=A), `actual_route_point`는 U4 유지(Q5=B)로 **갈렸다**는 사실과, 후자가 **미실장**이라 U5 stats가 근사로 운용된다는 점을 §3.3에 병기 |
| **G-U5-3** | 선재 `backend/docs/design/전체-최소-스키마.dbml`이 U5 실장과 다르다 — `visit_record`(vs 실장 `visit_check`) · `photo.storage_key`(S3 전제 vs 로컬 참조) · `gps_track.steps`(**INV-U4-08이 걸음 수 저장·표시를 금지**) | backend 패키지 소유 문서 — 팀 협의로 정합. U1 G-U1-\* 파생과 같은 종류 |
| ~~**G-U5-4**~~ | ~~`ai/`에 회고 표면 부재 → `http` 모드 개통 불가~~ | ✅ **해소(2026-09-01)** — AI 팀이 `POST /ai/v1/reflection/{generate,nudge}` 를 열었다(TRIP-429·430 완료, `ai/docs/openapi.json` 실측). 협의 결과가 초안과 다르다: **산출물이 문장이 아니라 카드**다. §5.3 을 실계약으로 교체했고 그 파급(폴백도 카드여야 한다)을 DEC-U5-5a·INV-U5-06·BR-U5-32·35 에 반영했다 |
| **G-U5-5** ★ | 실제 이동 거리의 산출 근거 부재(`actual_route_point` 미실장 + 클라 수집 미배선) | DEC-U5-12로 근사 운용. U4 실장 시 `ROUTE` 승격 |
| ~~**G-U5-6**~~ | ~~`j05`의 "평균 체류 72분"이 BR-U4-37과 충돌~~ | **철회(2026-08-22)** — U4 `domain-entities.md` **INV-U4-03**이 이미 정리해 뒀다: *"INV-3은 예측 소요시간의 표시 금지이고 **사후 실적은 U5 기록 소관**이나, U4 화면에서는 노출하지 않아 경계를 흐리지 않는다."* BR-U4-37은 **U4 화면에 한정된 규칙**이지 U5를 막는 규칙이 아니다. → **DEC-U5-13** |
| **G-U5-7** | US-REC-10(개인화) 소비처 U3가 설계 종료 상태 | 계약만 정의, 인셉션 정정 상신(Q7=A) |
| **G-U5-8** | US-REC-11(지난 여행 다시 보기)의 진입 경로가 화면에 명시되지 않음 — `j07` 하단 목록에 흡수, 마이페이지(`l03`)는 U6 | U6 설계에서 확정 |
| **G-U5-9** | `j02`의 계획｜실제｜변경 3탭이 **리스트 필터인지 지도 레이어 토글인지** 불명 | 디자인 확인. 기본 해석은 §frontend-components §2 |
| **G-U5-10** | `l06`(위치정보 동의)·`l05`(설정 안내)가 U6 밴드라 US-REC-03·10의 토글 화면이 U5에 없다 | U6 리드로 인계 |
| **G-U5-11** ★ | **`LlmGatewayPort`가 backend에 없다**(2차 셀프 검수) — `llm` 모드는 기존 자산 재사용이 아니라 **벤더 직결 신규 구축**이고, LLM 소유 모듈이 `ai/`와 갈린다 | 기본값을 `rule`로 확정. `llm` vs `http` 선택은 **O-U5-6** |
| **G-U5-12** ★ | **`ChangeLogFacade`에 조회 메서드가 없다**(`append` 하나뿐) — 모듈 간 changelog 읽기 진입점 부재 | `findByTrip` 추가(기본안) 또는 화면이 REST 직접 호출. **U4도 쓰는 facade**라 팀 확인 필요 |
| **G-U5-13** | **`VisitChecked` 이벤트가 코드에 없다** — 설계 문서(`전체-API-서피스.md`)에만 존재하고 backend 구현은 0건 | "발행 주체 U4→U5 변경"은 **미실장 이벤트에 대한 설계 서술**이다. 이관 시점에 U5가 **신설**한다 |
| **G-U5-14** ★ | **프런트 `features/record` → `features/execution` import가 ESLint로 금지**된다(`import/no-restricted-paths` · `importBoundary.test.ts`가 잠근다) — `actualDistance.ts` "재사용" 서술이 구조적으로 불가 | `shared/`로 **승격**해야 한다(U4 자산 이동 → U4 프런트 티켓과 조율) |
| **G-U5-15** | **AI 에 `style` 경로가 없다** — §5.3 초안은 `POST /ai/v1/reflection/style` 을 상정했으나 실계약에 없다(실측) | 스타일 분석(`j05`)은 계속 **백엔드 로컬 산출**이다. AI 개통은 상대 작업 선행 |
| **G-U5-16** | **`nudge` 에 소비처가 없다** — 상대는 `POST /ai/v1/reflection/nudge` 를 열었으나 여행 전 넛지 화면이 U5 범위 밖이다 | 경계만 열려 있고 우리가 안 부른다. 화면이 정해질 때 U6 와 조율 |

---

## 9. 라이브 Figma 대조 정정 (2026-08-22)

계획서 단계에서 노드 트리 이름만으로 세운 드리프트 중 **1건이 스크린샷으로 뒤집혔다.**

- **D-U5-3 철회** — "3종 구분이 지도 범례로 축약되고 전후 장소가 안 보인다"는 **틀렸다**. `j02` 실물은 **상단 세그먼트 3탭(계획｜실제｜변경)** + 행별 라벨 배지(`실제`/`계획`/`변경`) + `미방문` 칩 + 변경 행의 **`△△ 카페 → ◇◇ 실내카페` 전후 장소**를 모두 그린다. US-REC-04 요구(라벨·색상·아이콘 구분 + 시각·전후 장소·사유)를 **충족**한다. 남은 미결은 3탭의 동작 축뿐이다(G-U5-9).
- **D-U5-11 신설(셀프 검수 2026-08-22)** — `j05`의 카테고리 막대가 **`카페 40%·자연 25%·미식 20%·기타 15%`** 인데, `poi.category`의 허용값 8종은 `명소·맛집·카페·야경·자연·쇼핑·문화·액티비티`다. **`미식`은 없고 `맛집`이 있다.** 화면 라벨과 데이터 코드가 다르므로 **표시 매핑표가 필요**하다(U1 G-U1-10 동반유형 매핑과 같은 종류). 또한 8종을 4줄로 줄이는 집계 규칙(상위 3 + `기타`)이 어디에도 정의돼 있지 않다 → **O-U5-7**.
- 시각 확인 완료: `j01 default` · `j02` · `j03 default` · `j04` · `j05`(**5프레임**). 나머지 12프레임(`j06`·`j07`·`j01` 변형 4·`j03` 변형 3·`j04 error`·`j05 data-insufficient`)은 **노드 트리 이름 수준 매핑**이다 — Figma MCP 호출 상한에 걸려 이번 사이클에서 더 못 읽었다. 프런트 티켓 착수 전 시각 확인이 필요하다.

---

## 10. 스토리 커버리지 (셀프 검수 2026-08-22)

14 스토리 전수 대조. **이 표가 US-REC-03의 규칙 부재를 잡아냈다** — 소유가 U4로 넘어가면서(Q5=B) 화면 동작 규칙까지 같이 빠졌던 것을 `business-rules.md §9`(BR-U5-53~56) 신설로 메웠다.

| 스토리 | 화면 | 규칙 | 엔티티 | 비고 |
|---|---|---|---|---|
| US-REC-01 방문 완료/취소 | `j01` | BR-U5-01~09 | `visit_check`(실장) | **백엔드 계약 완료** — 프런트만 남음 |
| US-REC-02 사진·메모 | `j01` | BR-U5-11~16 | `visit_photo_meta`·`visit_memo` | 로컬 참조(DEC-U5-9) |
| US-REC-03 GPS 기록 | `j01`·`j03` 지도 | **BR-U5-53~55**(신설) | `actual_route_point`(**U4 소유·미실장**) | 토글 화면은 U6 `l06`(G-U5-10) |
| US-REC-04 3종 구분 | `j02` | BR-U5-28~30 | `visit_slot`·`change_log_entry` 읽기 | 3탭 동작 축 미결(O-U5-3) |
| US-REC-05 숙소·날짜 귀속 | `j04` | BR-U5-25~27 | `base_assignment`·`trip_base_day` 읽기 | 조회 시점 파생 |
| US-REC-06 당일 회고 | `j03` 4상태 | BR-U5-31~34·37·38 | `reflection` | 3단 폴백 · `source` 적재 |
| US-REC-07 초안 수정 | `j03` 편집 | BR-U5-35·36 | `reflection`(초안/수정본 분리) | INV-U5-06 |
| US-REC-08 전체 요약 | `j04` 2상태 | BR-U5-39 | `trip_summary` | `TripEnded` 수신 |
| US-REC-09 스타일 분석 | `j05` 2상태 | BR-U5-40~42·08a | `style_analysis` | 임계 10 · 평균 체류 노출(DEC-U5-13) |
| US-REC-10 기록 기반 개인화 | 화면 없음(U6 `l05`) | BR-U5-44·45 | — | 계약만(G-U5-7) |
| US-REC-11 지난 여행 재열람 | `j07` 하단 목록 | **BR-U5-56**(신설) | 조회 | 마이페이지 진입은 U6(G-U5-8) |
| US-REC-12 오프라인 | `j01` offline·sync-conflict | BR-U5-17~24 | 기기 로컬 큐 | PBT-U5-3 |
| US-REC-13 SNS 공유 카드 | `j06` 2상태 | BR-U5-46~48 | 저장 없음(온디바이스) | |
| US-REC-14 여행 캘린더 | `j07` | BR-U5-49 | 조회 | 탭 루트 |

**미커버 0.** 단, US-REC-03·10·11은 **화면 또는 데이터가 U4·U6 소관**이라 U5 단독으로 완결되지 않는다 — 위 표의 '비고'가 그 의존을 가리킨다.
