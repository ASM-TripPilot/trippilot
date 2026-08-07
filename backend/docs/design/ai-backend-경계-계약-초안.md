# AI ↔ 백엔드 경계 계약 — 백엔드 제안 초안

> 목적: PR #70(TRIP-255) 경계 감사 후속. 두 경계 계약을 **백엔드가 초안**으로 잡아 AI팀 검토·공동 동결용으로 올린다.
> 지위: **합의**(2026-08-04, AI팀 회신 PR #76 — 4개 결정 전부 수용). 이 계약 기준으로 백엔드 실장·openapi 반영.
> 근거: `ai/aidlc-docs/inception/application-design/agent-io-contracts.md`(AI 초안)·`ai/src`(실측)·백엔드 `modules/place-data`·`modules/trip`·`modules/profile`.

## 경계는 딱 두 개

| 방향 | 이름 | 호출자 → 응답자 | 용도 |
|---|---|---|---|
| 포워드 | **ScheduleAgent** | 백엔드 → AI | 일정 생성 한 번 호출 → 검증된 일정 |
| 리버스 | **POI 정본 read 포트** | AI(M7) → 백엔드 | AI가 백엔드 POI 정본 읽어 후보풀 빌드 |

조각 조립 경계(백엔드가 M7·C1·C2 직접 지휘)는 두지 않는다. `camelCase↔snake_case` 변환은 백엔드(M8) 소유(IO 규약).

---

## 계약 1 · 포워드 — ScheduleAgent

AI의 `agent-io-contracts.md 1.2` 초안을 채택하고 백엔드 소스를 매핑한다.

### 1-A. 요청 — `POST /ai/schedule` (백엔드 → AI)

| AI 필드 (snake) | 백엔드 소스 (camel) | 백엔드 원본 |
|---|---|---|
| `trip_id` | `tripId` | trip.trip_id |
| `generation_mode` | `generationMode` | d11 추천강도 (`fully_ai`\|`co_plan`) |
| `trip_context` | `tripContext{ destination, dateRange, party, budgetLevel }` | trip_destination · trip.start/end_date · companion_type · budget_tier |
| `anchors` | `anchors: [{ date, lat, lng }]` | base coverage(trip_base_day 해석 = day별 거점) |
| `time_windows` | `[{ date, start, end }]` | 기본 09:00–21:00 |
| `fixed_blocks` | `[{ poiId, date?, start?, dwellMin?, type }]` | must_visit (ANYTIME/FIXED) |
| `preference_profile` | preference_snapshot **7축** | profile.preference_set(styles·activities·foodTastes·transportModes·pace·companion·budget) |
| `recommendation_strength` | `recommendationStrength` | d11 |
| `request_meta` | `{ requestId, requestedAt, deadlineMs }` | 지연예산 전파(day1 5s / 전체 20s) — IO-1 |

### 1-B. 응답 — `ScheduleAgentOutput` (AI → 백엔드)

| AI 필드 | 백엔드 소비 |
|---|---|
| `days: [{ date, slots: [VisitSlotDisplay] }]` | itinerary 영속. **slot = poiId·startAt·endAt (soley 솔버 검증값 INV-2), duration 필드 없음 INV-3** |
| `day1_ready_at` | day1 조기노출 트리거 |
| `explanations{ slot_id → 이유 }` | 표시(시각·소요시간 언급 금지) |
| `solve_mode` (FULL_AI/DETERMINISTIC/MINIMAL) · `is_fallback` | 저장·표시, 침묵실패 금지 IO-2 |
| `freshness` · `candidates_summary` | UI 안내(후보 부족 등) |

**백엔드 소유(응답 이후)**: 저장 · `poi_snapshot` 동결(poi_id→poi_snapshot_id, 확정 시. AI는 스냅샷 안 만듦 IO-5) · day1 노출 · `ItineraryGenerated` 아웃박스 이벤트 · AI 불통 시 최소일정 폴백(바깥 겹).

---

## 계약 2 · 리버스 — POI 정본 read 포트

AI의 `poi_db_port.py`(M7이 원하는 read 스펙)를 백엔드 REST로 노출한다. 백엔드가 POI 정본 소유, AI는 소비만.

| AI가 원하는 것 (poi_db_port) | 제안 백엔드 엔드포인트 |
|---|---|
| `find_by_radius(center, radius_km)` | `GET /internal/pois?centerLat&centerLng&radiusKm` |
| `find_by_ids(ids)` | `POST /internal/pois:batchGet { ids[] }` |
| `find_nearby(coord, radius_m, category)` | `GET /internal/pois/nearby?lat&lng&radiusM&category` |
| `get_open_window(poi_id, on)` | `GET /internal/pois/{id}/open-window?on={date}` |
| `batch_check_closed(ids, on)` | `POST /internal/pois:closedCheck { ids[], on }` |
| ~~`upsert(poi)`~~ | **제외** — POI 수집·등록은 백엔드 소유(C7 게이트 INV-1). 웹소싱은 `:collect` 동기 제출(결정 3) |

### 2-A. POI 응답 스키마 (제안)

```
Poi {
  poiId, nameKo, category(code, 아래 매핑), lat, lng,
  openHours[{ day, open, close }],   // AI get_open_window·영업필터용
  dataStatus(ACTIVE/UNVERIFIED/LOST/CLOSED),
  source(KAKAO_LOCAL/TOURAPI/MANUAL),
  savedCount,                         // 인기 신호 1순위 (rating 대체)
  dataQuality(FULL/PARTIAL/MINIMAL)   // 합성 정렬키 2순위 (완전성 파생, 결정 1 · 3등급은 PR #104 협의)
}
// per-POI 비용(avg_cost)·평점(rating) 없음: 백엔드 정본 미보유(결정 1)
```

---

## 협의거리 — 합의 완료 (AI 회신 2026-08-04, PR #76)

백엔드 정본 기준 결정에 AI팀이 **4개 다 수용**. 아래는 최종 합의안.

### 결정 1 · POI에 per-POI 비용·평점 없음 (백엔드 정본) ✅

- POI 정본은 **`avg_cost`·`rating`을 갖지 않는다.** 예산은 **trip/user 레벨**(preference_set.budget_tier · trip.budget_total)이지 per-POI가 아니다.
- AI `pool_builder` 조정 (합의): 예산 필터 → **카테고리 소프트 가중치**, 인기 정렬 → **`savedCount`**.
- **합성 정렬키(콜드스타트 대비, AI 제안)**: `savedCount ↓ → dataQuality(FULL>PARTIAL>MINIMAL) ↓ → 거점거리 ↑ → poiId ↑`. 유저 쌓이면 savedCount가 자동 지배 → 전환 시점 불필요·결정론 유지.
  → **백엔드 조치**: read 응답에 `dataQuality`(FULL/PARTIAL/MINIMAL) 노출(완전성 파생).
  → **3등급 파생 기준(PR #104 확정 요청분)**: `FULL`=영업시간+대표사진 · `PARTIAL`=영업시간O·사진X · **`MINIMAL`=영업시간 없음**(사진 무관).
    MINIMAL 은 영업일 필터·HC1 을 신뢰할 수 없는 POI = AI 후보풀 제외 대상. 전제: 영업시간 원본이 존재해야 하므로
    시드(`R__seed_stub_pois.sql`)에 영업시간을 채우고, 프로덕션 데이터는 **실 벤더 어댑터가 U5 통합 전에 선행**해야 한다.

### 결정 2 · 카테고리 = 경계 코드 8종 고정 (백엔드 정본) ✅

AI가 ACTIVITY 추가 요청 → **8종**으로 확정. ETC는 AI가 폐기(수집 게이트가 카테고리 필수라 존재 이유 없음).

| 백엔드(정본, 한글) | 경계 코드 | 조치 |
|---|---|---|
| 명소 | `SIGHT` | ok |
| 맛집 | `FOOD` | ok |
| 카페 | `CAFE` | ok |
| 쇼핑 | `SHOPPING` | ok |
| 야경 | `NIGHT_VIEW` | AI 매핑 신설 |
| 자연 | `NATURE` | AI 매핑 신설 |
| 문화 | `CULTURE` | AI 매핑 신설 |
| **액티비티 (신설)** | `ACTIVITY` | **백엔드 신설** — place-data PoiCategory + Flyway poi CHECK 마이그레이션 |
| — | ~~STAY~~ | 숙소=앵커, 후보 아님 → 제외 |
| — | ~~ETC~~ | AI 폐기 |

### 결정 3 · MVP read-only, `upsert` 없음 ✅

- MVP에선 AI가 백엔드 POI 정본에 **write하지 않는다** (read 5종만). 수집·등록은 백엔드 C7 소유(INV-1 게이트).
- 웹소싱 POI(U6, **후속**)는 `POST /internal/pois:collect`로 등록 — **동기 판정**: 제출 응답에 즉시 ACTIVE/반려+사유 코드(목표 p95 2~3초), 등록 **즉시 read 포트 반영**(배치 대기 없음). → 다음 생성부터 새 장소가 후보에 든다.

### 결정 4 · 프로토콜 = REST + 공유 openapi 코드젠 (gRPC 보류) ✅

- **REST/JSON over HTTP**로 확정.
- 드리프트(P3 enum·P7 시그니처)는 **단일 `openapi.yaml`을 정본으로 두고 양쪽(Kotlin·Python) 코드 생성**해서 막는다 — gRPC의 `.proto` 단일계약과 같은 안전을 더 가볍게.
- **gRPC는 고려했으나 보류**: 하이브리드 설계(day1 동기 + 나머지 아웃박스 이벤트)가 in-call 스트리밍을 우회하고, 경계 표면이 작으며(ScheduleAgent 1 + POI read 5), AI 코드가 JSON 지향이라 양쪽 전환비용이 크다. 스트리밍·드리프트·성능이 실제로 아파지면 어댑터(포트 뒤) 교체로 전환 가능.

---

## 다음 단계 (합의 후)

1. ✅ AI 회신 4개 수용 완료(2026-08-04) → 이 문서 = 합의 계약.
2. **백엔드 실장**:
   - (a) place-data `액티비티`(ACTIVITY) 카테고리 + Flyway poi CHECK 마이그레이션
   - (b) 리버스 POI read 포트 5종 + `dataQuality` 노출
   - (c) 포워드 `ScheduleAgentPort` + `ScheduleAgentInput/Output` DTO + FakeScheduleAgent (계약우선)
3. `openapi.yaml`(포워드·리버스)에 계약 반영, 양쪽 코드젠.
4. AI는 U5(오케스트레이터+HTTP) 병렬 착수.
