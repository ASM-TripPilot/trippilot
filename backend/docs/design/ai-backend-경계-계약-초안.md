# AI ↔ 백엔드 경계 계약 — 백엔드 제안 초안

> 목적: PR #70(TRIP-255) 경계 감사 후속. 두 경계 계약을 **백엔드가 초안**으로 잡아 AI팀 검토·공동 동결용으로 올린다.
> 지위: **제안(draft)**. 미확정. AI팀 확인 후 정본화.
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
| ~~`upsert(poi)`~~ | **제외** — POI 수집·등록은 백엔드 소유(C7 수집 게이트 INV-1). AI는 write 안 함 → 확인 필요 |

### 2-A. POI 응답 스키마 (제안)

```
Poi {
  poiId, nameKo, category(code, 아래 매핑), lat, lng,
  openHours[{ day, open, close }],   // AI get_open_window·영업필터용
  dataStatus(ACTIVE/UNVERIFIED/LOST/CLOSED),
  source(KAKAO_LOCAL/TOURAPI/MANUAL),
  savedCount                          // 인기 신호(AI 정렬용) — rating 대체
}
// per-POI 비용(avg_cost)·평점(rating) 없음: 백엔드 정본 미보유(결정 1)
```

---

## 협의거리 — 백엔드 결정 + AI 확인 요청

백엔드 정본 기준으로 아래처럼 정한다. AI는 3개 항목만 확인·수용하면 된다(4번은 확정).

### 결정 1 · POI에 per-POI 비용·평점 없음 (백엔드 정본)

- POI 정본은 **`avg_cost`·`rating`을 갖지 않는다.** 예산은 **trip/user 레벨**(preference_set.budget_tier · trip.budget_total)이지 per-POI가 아니다 — 정본대로 간다.
- 따라서 AI `pool_builder` 조정 제안:
  - **예산 필터(avg_cost) → 카테고리 소프트 가중치**로 전환 (원래 budget은 하드 아님·소프트 = `ai-architecture.md`와 정합).
  - **인기 정렬(rating) → 백엔드 `savedCount`(담긴 수)** 로 대체.
- 🔸 **AI 확인**: 이 두 전환 수용?

### 결정 2 · 카테고리 = 경계 코드 7종 고정 (백엔드 정본)

백엔드 정본이 진실원이므로 경계 코드 7종을 고정하고, AI가 내부 enum을 여기에 맞춘다.

| 백엔드(정본, 한글) | 경계 코드 | AI 현재 enum | 조치 |
|---|---|---|---|
| 명소 | `SIGHT` | SIGHT | ok |
| 맛집 | `FOOD` | FOOD | ok |
| 카페 | `CAFE` | CAFE | ok |
| 쇼핑 | `SHOPPING` | SHOPPING | ok |
| 야경 | `NIGHT_VIEW` | (없음) | AI 매핑 추가 |
| 자연 | `NATURE` | (없음) | AI 매핑 추가 |
| 문화 | `CULTURE` | (없음) | AI 매핑 추가 |
| (없음) | — | STAY | 숙소=앵커 → 후보 제외 |

- 🔸 **AI 확인**: 내부 enum을 이 7종에 맞춰 매핑(야경·자연·문화 신설) 동의?

### 결정 3 · MVP read-only, `upsert` 없음

- MVP에선 AI가 백엔드 POI 정본에 **write하지 않는다** (read 5종만). 수집·등록은 백엔드 C7 소유(INV-1 게이트).
- 웹소싱 POI(U6, **후속**)는 AI가 직접 upsert하지 않고 **백엔드 수집 게이트 경유** `POST /internal/pois:collect`(NormalizedPlace 제출 → 게이트가 ACTIVE/반려 판정)로 등록.
- 🔸 **AI 확인**: 웹소싱 POI를 게이트 제출 경로로 넘기는 데 동의(직접 write 제거)?

### 결정 4 · 프로토콜 = REST + 공유 openapi 코드젠 (gRPC 보류)

- **REST/JSON over HTTP**로 확정.
- 드리프트(P3 enum·P7 시그니처)는 **단일 `openapi.yaml`을 정본으로 두고 양쪽(Kotlin·Python) 코드 생성**해서 막는다 — gRPC의 `.proto` 단일계약과 같은 안전을 더 가볍게.
- **gRPC는 고려했으나 보류**: 하이브리드 설계(day1 동기 + 나머지 아웃박스 이벤트)가 in-call 스트리밍을 우회하고, 경계 표면이 작으며(ScheduleAgent 1 + POI read 5), AI 코드가 JSON 지향이라 양쪽 전환비용이 크다. 스트리밍·드리프트·성능이 실제로 아파지면 어댑터(포트 뒤) 교체로 전환 가능.

---

## 다음 단계

1. AI팀이 이 초안 검토 → 위 4개 결정 항목 회신.
2. 합의되면 이 문서를 정본화하고 `openapi.yaml`(포워드·리버스)에 계약 반영.
3. 백엔드는 Fake로, AI는 U5(오케스트레이터+HTTP)로 병렬 착수.
