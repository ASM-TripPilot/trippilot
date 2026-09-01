# TRIP-463 — 백엔드가 AI `/ai/v1/itinerary/alternatives` 를 호출한다 (설계 확정)

> **TRIP-463** · 상태: 설계 확정, 구현 미착수 · 작성 2026-09-01
> 근거는 전부 `origin/develop` 실측이다 — 이 문서 안의 파일·심볼·기본값은 작성 시점에 코드에서 확인한 것이고, 인셉션 문서에서 옮겨 적은 것이 아니다.
> 범위: **백엔드 단독 PR**. `ai/` 변경 0, `ai/docs/openapi.json` 변경 0, FE 변경 0(공개 계약 스키마 무변경).
>
> **미결 2건은 추천안으로 진행한다** — D-4 = (가) 로컬 폴백, D-5 = (가) 어댑터가 `ground()`. 둘 다 "오늘의 http 모드 동작과 같다 / 공개 계약 무변경"이 선정 이유다. 이의가 있으면 구현 착수 전에 이 절을 고친다.
> **별도 티켓으로 뺀 것 1건** — 백엔드→AI 호출 무인증(§5 전제 2). 이 티켓은 이미 무인증으로 열려 있는 채널에 경로 하나를 더 여는 것이라 신뢰 경계를 바꾸지 않는다.

---

## 0. 한 줄 요약

`HttpScheduleAgentAdapter.proposeSlotCandidates` 가 지금은 `LocalSlotCandidateSource` 로 우회하고 있다. 이것을 AI `/ai/v1/itinerary/alternatives` 실호출로 바꾸되, **AI 응답에 없는 값(거리·반경·시각)은 백엔드가 자기 손에 이미 있는 데이터로 채운다.**

---

## 1. 결정과 근거

### D-1 — **(b) 백엔드가 AI 응답을 받아 거리를 자기가 계산해 채운다** 를 채택

AI 응답의 대안 1건(`AlternativeSchema`)은 `{label, poi_ids[], rationale}` 세 값뿐이다(`AlternativesResponse` 자체는 `alternatives·is_fallback·fallback_level·notes·retrieved·dropped_out_of_pool·empty_reason·pool_size` 8필드 — §3 표 참조). 백엔드가 채워야 하는 `distanceRange`(`SlotCandidate` 소속)·`radiusMUsed`(`SlotCandidatesOutput` 소속)가 AI 응답에 아예 없다. 그 결손을 어디서 메울 것인가가 이 티켓의 실제 질문이고, 답은 "백엔드가 메운다"다.

**근거 1 — 필요한 데이터가 이미 백엔드 손에 있다.**
`SlotCandidateService` 는 AI 가 준 `poiId` 를 `candidatePool.ground(...)` 로 재확인한다(INV-1 게이트). 그 `GroundedPlace` 가 `lat`·`lng`·`nameKo`·`category` 를 준다. 탐색 중심 좌표는 `PoiSurfaceFacade.findSurfaces` 로 이미 뽑아 `SlotCandidatesInput.centerLat/centerLng` 에 실려 어댑터까지 내려온다. **좌표 재조회는 0건**이고, 거리는 하버사인 한 줄이다. `placedata.domain.Haversine` 은 `api` 층이 아니라 R1(ArchUnit 강제) 위반이라 못 쓰고, 같은 모듈의 `StayOnramp.distanceM` 은 **`private fun` 이라 재사용 불가**다(2026-09-01 감사 정정 — 초판의 "이미 존재한다"가 재사용 가능으로 오독된다). 같은 이유로 §6-2 에서 **새 private 함수**를 만든다. 상수 `EARTH_RADIUS_M = 6_371_000.0` 은 `StayOnramp.kt` 에 실재하는 같은 값이다.

**근거 2 — `radiusMUsed` 는 (a)로도 안 풀린다.**
`AlternativesRequest` 에 반경 필드가 **없고**(`trigger·reason·anchor·dates·budget_level·transport_mode·excluded_poi_ids·affected_reasons·saved_places·request_meta` 가 전부다), 응답에도 없다. AI 는 `TransportMode.PUBLIC.radius_km = 10.0`(다일 ×0.7)을 자기 안에서 쓰고 백엔드 기본은 3km 라 값도 다르다. FE `radiusUsedLabel.ts` 가 이 숫자를 h15 문구("약 11.3km")로 그대로 렌더하므로 **누군가는 반드시 이 값을 답해야 한다.** 백엔드밖에 답할 주체가 없다.

**근거 3 — `rationale` 이 폴백 시 사용자에게 보여선 안 되는 문자열이다.**
`rag.py::_rationale` 은 `fallback_level>=1` 일 때 `f"{trigger.kind}/{reason} · {source}"` 를 만든다 → 이 경로에서는 `"MANUAL/none · rule_ranking"`. FE `SlotCandidateCard` 는 `candidate.rationale` 을 가공 없이 leaf 로 렌더한다. 백엔드가 매핑 단계에서 이걸 감지해 기존 템플릿(`"주변 카페"`)으로 되돌리고 `degraded=true` 를 세우면, 지금 "항상 true" 인 `degraded` 가 **"AI 가 제대로 된 랭킹을 못 줬을 때만 true"** 가 되어 값의 의미가 정확해진다(§4).

**근거 4 — 계약 게이트 비용이 최소다.**
`AiBoundaryOpenApiTest` 의 경로 검사는 `paths shouldContain it` 이라 경로가 늘어도 안 깨진다. `ai/docs/openapi.json` 을 한 글자도 안 바꾸므로 AI CI 의 "실행 앱 스키마 == 커밋된 계약" 스냅샷도 무영향. **백엔드 단독 PR** 이 성립한다.

### 기각: (a) AI 계약에 필드를 추가한다

`radiusM`(요청)·`distance_m`·`radius_m_used`(응답)를 AI 계약에 넣는 안. 기각 사유:
- `ai/docs/openapi.json` 이 바뀌면 AI PR·백엔드 PR 두 건이 순서를 맞춰야 하고, 그 사이 `AiBoundaryOpenApiTest`(정확 일치 비교)가 빨개진다. 단독 PR 이 아니게 된다.
- 거리는 **백엔드 정본(place-data) 좌표 기준**이 맞다. AI 는 자기 풀 좌표(토큰 없으면 시드 4곳)로 계산하게 되는데, 그 값이 백엔드가 `ground()` 로 확정한 POI 의 좌표와 다를 수 있다. 표시값의 주인을 넘기면 두 정본이 생긴다.
- 반경은 애초에 AI 가 대답할 수 없는 값이다. AI 풀 반경(10km)과 사용자가 h15 로 조절하는 반경(3→12km)은 다른 개념이다.

### 기각: (c) AI 응답 모양(대안 세트)에 백엔드를 맞춘다

`alternatives` 를 "대안 세트 2~3안"으로 받아 화면 모델을 바꾸는 방향. 기각 사유:
- `DEC-U4-1` 이 **라이브 Figma 27프레임 재관측을 근거로 이미 기각한 모델**이다("대안의 단위는 단일 재계획안 + 슬롯별 후보 교체 — 일정 단위 2~3안을 만들지 않는다"). 인셉션 `proposeAlternatives → List<AlternativeOption>` 과의 불일치는 `G-U4-1` 로 정정 상신까지 끝났다. 정본을 다시 흔드는 일이다.
- `docs/conventions/anti-patterns.md` 에 기록된 **TRIP-521 폐기 사고가 정확히 그 방향에서 났다** — inception 만 보고 "구현이 정본과 어긋난다"고 판정해 연동 차단 결함으로 티켓까지 끊었으나, construction FD 가 이미 그 모델을 기각한 뒤였다(2026-08-24 TRIP-521 폐기 → TRIP-463 통합).
- 구현도 이미 단일 POI 다: `rag.py` 의 `Alternative(poi_ids=(poi_id,))` — 대안 1개 = POI 1개. 세트 개념은 코드에 없다.

---

## 2. 요청 매핑표 — 백엔드 `SlotCandidatesInput` → AI `AlternativesRequest`

| AI 필드 | 필수 | 백엔드가 싣는 값 | 근거·주의 |
|---|---|---|---|
| `trigger.kind` | ✔ | **`"MANUAL"` 고정 (지어내는 값)** | `TriggerKind` 는 `WEATHER·CLOSURE·DELAY·MANUAL` 4값. h12/h18 은 사용자가 직접 "다른 후보"를 눌러 여는 흐름이라 나머지 셋은 사실이 아니다. **`SlotCandidatesInput` 에 트리거 정보가 없어 다른 값을 실을 방법 자체가 없다.** 코드 주석에 "지어낸 값"이라고 남긴다 |
| `trigger.schedule_id` | ✔ | `tripId.toString()` | AI 는 이 값을 KB 검색 질의 문자열 조립(`_schedule_query`)에만 쓴다. 계약 제약은 `min_length=1` 뿐. 의미상 `itineraryId` 가 더 가깝지만 입력에 없다 |
| `trigger.affected_date` | ✔ | `SlotKey.parse(slotKey)!!.first` | 서비스가 이미 파싱해 갖고 있다. `parse` 는 `Pair<LocalDate, UUID>?` 를 돌려준다 — `.date` 멤버는 없다(2026-09-01 감사 정정) |
| `trigger.payload` | | `{}` | 실을 신호가 없다 |
| `reason` | | `"none"` | 어휘는 `weather\|closed\|delay\|canceled\|fatigue\|none` 이지만 **계약상 enum 이 아니다** — `{"default":"none","type":"string"}` 이라 다른 값을 넣어도 422 가 안 난다(2026-09-01 감사 정정). 그래서 오타·자유 문자열이 더 위험하다: 분기(`_DEMOTED_BY_REASON`)는 안 타면서 KB 검색 질의만 조용히 오염된다. 반드시 위 6개 중 하나를 쓴다 |
| `anchor.lat/lng` | ✔ | `centerLat` / `centerLng` | 교체 대상 슬롯의 POI 좌표(서비스가 `PoiSurfaceFacade` 로 확보) |
| `dates` | ✔ | `[slotKey 의 date]` **1건** | `min_length=1`. 1건이므로 AI 의 다일 반경 축소(×0.7)가 안 걸리고 영업일 필터도 그 요일만 본다 — 둘 다 슬롯 교체에 맞는 동작 |
| `budget_level` | | `null` | AI 기본 `MID`. 값을 채우려면 profile 모듈 의존이 생긴다(R1 확대) — `replan` 이 `NEUTRAL_PREFERENCES` 로 간 것과 같은 판단 |
| `transport_mode` | | `null` | AI 기본 `PUBLIC` → **풀 반경 10km**. 이 값이 §3 의 반경 컷 상한을 결정한다 |
| `excluded_poi_ids` | | `excludePoiIds.map { it.toString() }` | 서버가 현재 일정에서 유도한 목록 그대로(BR-U3-24) |
| `affected_reasons` | | `{targetPoiId: placementReason}` (없으면 `{}`) | 교체 대상 슬롯의 `VisitSlot.placementReason` 이 이미 손에 있다(`matches.single().value`). LLM 이 "원래 취지를 잇는 대안"을 고르게 하는 컨텍스트 |
| `saved_places` | | `[]` | `place-data` 에 `SavedPlaceService` 는 있으나 `..api..` 파사드가 **없다**. 파사드 신설은 별건 |
| `request_meta` | ✔ | `RequestMeta` 그대로 (`deadlineMs = 3_000`) | `deadline_ms` 는 `exclusiveMinimum: 0` — 3000 통과 |

### 자리가 없는 것 3개 — 처리 방침

**AI 요청 계약은 건드리지 않는다.** 세 값 모두 백엔드 쪽에서 처리하거나 이번엔 포기한다.

| 백엔드 입력 | 처리 | 이유 |
|---|---|---|
| `radiusM` | **백엔드가 응답 후처리에서 컷** — `ground()` 로 얻은 좌표와 중심 사이 거리로 필터. 컷 = `min(radiusM ?: 3_000, 10_000)`, 0건이면 `10_000` 으로 한 번 넓혀 재컷. `radiusMUsed` 는 **실제 적용한 컷** | AI 풀 반경(PUBLIC 10km)을 넘는 값을 표시하면 "본 적 없는 범위를 넓혀 봤다"는 거짓말이 된다. 그래서 로컬 경로의 12km 대신 10km 를 상한으로 쓴다. **서비스**의 50km 상한(`SlotCandidateService.MAX_RADIUS_M`, 400)은 그대로 — 컨트롤러는 `@field:Positive` 뿐이다 |
| `concept` | **`rationale` 템플릿 문구에만 반영** — `"$concept 컨셉에 맞는 $category"`. 필터로는 안 쓴다 | 현행 `LocalSlotCandidateSource` 와 동일 동작이라 회귀가 없다. 필터로 쓰려면 컨셉→카테고리 매핑표가 필요한데 `concept` 은 자유 문자열(40자)이라 1:1이 아니다 — 별건 |
| `neighborSlotKeys` | **버린다(전달 안 함)** | AI 요청 계약에 실을 자리가 없다. `replan` 의 `reasons·directives` 와 같은 처지 — 없는 필드를 지어내면 422 로 전 호출이 폴백된다. **결과: 앞뒤 슬롯 동선 트레이드오프는 AI 경로에서도 반영되지 않는다.** `LocalSlotCandidateSource` 가 스스로 적어 둔 한계 3가지(거리순 정렬·템플릿 근거·이웃 미반영) 중 **이것만 그대로 남는다** — 실연동을 붙였다고 사라진 줄 알면 안 된다 |

---

## 3. 응답 매핑표 — AI `AlternativesResponse` → 백엔드 `SlotCandidatesOutput`

| AI 필드 | 백엔드 처리 | 근거 |
|---|---|---|
| `alternatives[].poi_ids` | **flatten 해서 후보 목록으로.** 순서 = AI 랭킹 순서 보존 | 대안 1개 = POI 1개다(`Alternative(poi_ids=(poi_id,))` · DEC-U4-1). 계약상 배열이므로 2개 이상이 와도 첫 건만 쓰지 않고 전부 펼쳐 방어한다 |
| `alternatives[].label` | **버린다** | `"A"/"B"/"C"` 위치 문자인데 FE `candidateBadge(index)` 가 이미 `'B'` 부터 자기가 만든다(현 슬롯이 `'A'`). 서버 라벨을 실으면 두 체계가 충돌 |
| `alternatives[].rationale` | `fallback_level == 0` → **그대로** (LLM 이 낸 사용자 표시 1문장)<br>`fallback_level >= 1` → **버리고 템플릿으로 되돌린다** (`"$concept 컨셉에 맞는 $category"` / `"주변 $category"`, `category` 는 `GroundedPlace.category`) | `_rationale` 이 폴백 시 `"MANUAL/none · rule_ranking"` 기계 문자열을 만들고 FE 가 가공 없이 렌더한다 |
| `is_fallback` / `fallback_level` | **`degraded = fallback_level >= 1`** | 둘은 계약상 동치다(`PlanBRagResult.__post_init__` 이 `is_fallback ⇔ fallback_level >= 1` 을 강제). `fallback_level==2` 는 후보 0 |
| `notes` | **로그(INFO/WARN)만** | 폴백 사유·드롭 사유의 기계 문자열 진단값이지 사용자 문구가 아니다 (`"alternative_gateway_absent · …"`) |
| `retrieved` | **로그만** | KB 3종 검색 건수. 0 이면 KB 미적재 진단 |
| `dropped_out_of_pool` | **로그(WARN)만** | AI 가 자기 풀 기준으로 버린 참조. 우리 `ground()` 탈락 로그와 나란히 봐야 INV-1 경로 전체가 보인다 |
| `empty_reason` | **`SlotCandidatesOutput.emptyReason` 으로 매핑** | 정정(2026-09-01 감사) — 초판은 "실을 자리가 없다"고 썼으나 **세 층 모두에 자리가 있다**: `openapi.yaml` `emptyReason`(enum `NO_NEARBY`·`ALL_IN_ITINERARY`) · `SlotCandidateController` · `ScheduleAgentPort.SlotCandidatesOutput`. 게다가 도메인 KDoc 이 **기본값을 두지 말라고 명시**한다("두면 빈 목록을 내는 새 구현이 그것을 물려받아 '0건인데 이유 없음'이 조용히 나간다"). 어댑터가 완결된 출력을 만드는 D-5(가)에서는 **생성자 인자라 안 채우면 컴파일이 막힌다**. 매핑: AI `"no_candidates"`(풀 0건)·`"all_excluded"` → `ALL_IN_ITINERARY`, 반경 컷으로 0건이 된 경우 → `NO_NEARBY`. AI 가 준 값이 이 둘로 안 떨어지면 `NO_NEARBY` + 원문 WARN 로그 |
| `pool_size` | **로그만** | 실을 자리 없음. "후보가 적어요" 배너는 생성 경로(`CandidatesSummary`) 소유이고 여기 계약엔 없다 |
| — | **`distanceRange` = 백엔드가 채운다** — `ground()` 좌표 ↔ `centerLat/Lng` 하버사인, 포맷 `"약 %.1fkm"` (`Locale.ROOT`). 거리만, 소요시간 없음(INV-3) | 응답에 거리 필드가 없다 |
| — | **`radiusMUsed` = 백엔드가 채운다** — §2 의 적용 컷 | 응답에 반경 필드가 없다 |
| — | **`freshness.generatedAt` = `clock.instant()`** | 응답에 생성 시각 필드가 없다 |

### 정렬 규칙 (하위 결정 D-3a)

- `degraded == false` → **AI 랭킹 순서 그대로.** 그게 이 티켓이 사려던 것이다.
- `degraded == true` → **거리 오름차순으로 재정렬.** 규칙 랭킹 순서는 "저장 장소 우선 + 우천 시 실외 강등"이라 거리순이 아닌데, FE 강등 고지 문구가 `'AI 추천 준비 중, 가까운 순'` 이라고 못박고 있다. 재정렬해야 문구가 사실이 된다.
- 상한: AI `max_alternatives = 3` 이라 최대 3건이 온다(로컬 경로는 5건). 백엔드가 추가로 자르지 않는다 — **화면 후보 수가 5→3 으로 줄 수 있다**는 사실을 리뷰에서 확인할 것.

---

## 4. `degraded` 의미 변경

**지금:** `HttpScheduleAgentAdapter.proposeSlotCandidates` = `localCandidates.propose(input, degraded = true)` — **리터럴 true**. http 모드에서는 무조건 강등이다.

**바뀐 뒤:** `degraded = (fallback_level >= 1)`.

| 상황 | `degraded` | 사용자가 보는 것 |
|---|---|---|
| AI 200 · `fallback_level == 0` (LLM 랭킹) | `false` | 고지 없음. AI 근거 문장 |
| AI 200 · `fallback_level >= 1` (규칙 랭킹 / 후보 0) | `true` | "AI 추천 준비 중, 가까운 순" + 템플릿 근거 |
| AI 미도달(4xx/5xx/네트워크) | `true` (D-4 아래) | 위와 동일 |
| fake 모드 | `false` (무변경) | 에이전트 전체가 대역이라 강등이 아니다 |

**FE 영향: 없음.** 두 벌 모두 문구 리터럴이 동일하고(`'AI 추천 준비 중, 가까운 순'`), 조건도 이미 `degraded === true` 로만 갈린다:
- h12/h18 — `frontend/src/features/itinerary/ui/SlotCandidatePanel.tsx` `DEGRADED_NOTE` (`degraded === true ? … : null`)
- i14 — `frontend/src/features/planb/ui/SlotCandidateSheet.tsx` `DEGRADED_NOTE` (`degraded ? … : null`, 기본 `false`)

즉 **바뀌는 것은 배너가 뜨는 빈도뿐**이고 컴포넌트·테스트·생성 스키마(`slotCandidates.ts`)는 손대지 않는다. 공개 계약의 필드·타입이 그대로라 orval 재생성도 불필요하다.

**문서만 갱신:** `backend/docs/design/openapi.yaml` 의 `SlotCandidates.degraded` description — 현재 "**AI 순위가 아니다**(true)" / `SlotCandidateController` 의 KDoc "TRIP-408 전까지 true" 를 "AI 가 LLM 랭킹을 못 냈을 때 true" 로. 스키마 자체는 무변경.

---

## 5. 착수 전제 (2건 — 반드시 확인)

### 전제 1 — `SERVICE_AUTH_TOKEN` 이 있어야 AI 풀이 실 POI 다

`ai/main.py::_backend_poi_db()` 는 `TRIPPILOT_BACKEND_BASE_URL` 이 없으면 `None` 을 돌려주고, `build_dev_app` 이 `StaticPoiDb(demo_poi_seed())` = **제주 시드 4곳**으로 조립한다. 그리고 `docker-compose.yml` 은

```yaml
TRIPPILOT_BACKEND_BASE_URL: ${SERVICE_AUTH_TOKEN:+http://backend:8080}
```

**토큰이 있어야만 주소가 붙는다.** 토큰이 비면 AI 는 영원히 시드 4곳으로 답한다.

정확한 결과(실측 기준 정정 — 원 브리프의 "전량 탈락"보다 한 겹 더 들어간다):
- 시드 4곳의 UUID 는 백엔드 `R__seed_stub_pois.sql` 과 **일치하도록 미러링돼 있다**(`wiring.py::_BACKEND_SEED_ROWS` 주석이 그 의도를 명시). 그래서 그 R__ 시드가 적재된 로컬 스택에서는 `ground()` 를 통과한다.
- 그럼에도 실질은 빈 목록에 가깝다: ① 4곳이 제주 전역에 흩어져 있어 교체 대상 좌표 기준 반경 컷(기본 3km)에 거의 안 걸리고 ② 그 4곳은 fake 로 만든 일정에 이미 들어가 있을 확률이 높아 `excludePoiIds` 로 빠진다.
- R__ 시드가 없는 환경(시드 제거 후 · 운영)에서는 `ground()` 에서 **전량 탈락해 빈 목록**이다.

→ **토큰 없이 http 모드를 켜면 "AI 는 붙었는데 후보 0건"이 정상 동작처럼 보인다.** 연동 확인은 반드시 토큰을 세팅한 뒤에 한다. LiveAI 테스트 주석에도 이 전제를 적는다.

### 전제 2 — 백엔드→AI 호출에 인증이 아예 없다

`ScheduleAgentConfiguration.client()` 는 `baseUrl`·타임아웃·경계 매퍼만 붙이고 **`Authorization` 헤더를 달지 않는다.** `ScheduleAgentProperties` 에 토큰 필드도 없다. 잠긴 것은 반대 방향뿐이다 — AI→백엔드 `/internal/**` 은 `ServiceTokenAuth` 로 fail-closed (TRIP-393).

**판단: 이 티켓 범위 밖. 별도 티켓으로 끊는다.** 근거 3가지:
1. 이 티켓은 **이미 무인증으로 열려 있는 채널에 경로 하나를 더 여는 것**이다 — `generate`·`validate`·`repair`·`explanations` 네 경로가 이미 같은 조건으로 나간다. 신뢰 경계를 바꾸지 않는다.
2. 인증을 붙이면 `ScheduleAgentProperties`·`ScheduleAgentConfiguration`·`docker-compose.yml`·`.env.example`·AI 미들웨어·CI 를 동시에 건드려야 하고, **"백엔드 단독 PR" 이라는 이 설계의 전제가 깨진다.**
3. fail-closed 로 붙이면 토큰 미설정 환경에서 `generate` 까지 죽는다 — 회귀 범위가 이 티켓 밖이다.

→ 후속 티켓 제목 제안: *"백엔드→AI 호출에 서비스 토큰 붙이기 (역방향 TRIP-393)"* · `SECURITY-*` 태그. 이 문서에서 링크만 남긴다.

---

## 6. 단계별 작업 목록

### D-4 (선택 필요) — AI 미도달 시 어떻게 할 것인가

| 안 | 동작 | 평가 |
|---|---|---|
| **(가) 로컬 폴백 · 추천** | 어댑터가 `ScheduleAgentCallFailed` 를 잡아 `localCandidates.propose(input, degraded = true)` + WARN 로그 | **오늘의 http 모드 동작과 정확히 같다**(가용성 회귀 0). `degraded` 의미도 일관 — "AI 순위가 아니다" |
| (나) 503 표면화 | 예외를 그대로 올려 서비스의 기존 `UpstreamUnavailable` 분기가 503 을 낸다 | 지금까지 http 모드에서 잘 되던 기능이 AI 다운 시 **503 으로 죽는 회귀**가 생긴다. 서비스에 그 분기는 이미 있으니 코드는 더 적다 |

→ **(가) 추천.** 서비스의 503 분기는 그대로 남겨 둔다(포트가 던질 수 있는 계약은 유지).

### D-5 (선택 필요) — `ground()` 를 누가 하는가

| 안 | 배치 | 평가 |
|---|---|---|
| **(가) 어댑터가 한다 · 추천** | `HttpScheduleAgentAdapter` 생성자에 `CandidatePoolPort` 추가 주입. 어댑터가 `ground()` → 거리·반경 컷·정렬·템플릿까지 끝낸 **완결된 `SlotCandidatesOutput`** 반환 | `SlotCandidateService`·`LocalSlotCandidateSource`·`SlotCandidateController`·공개 계약 **전부 무변경**. `FakeScheduleAgent` 가 이미 같은 포트를 받고 있고 `HttpScheduleAgentAdapterTest.fixture()` 도 이미 `emptyPool` 을 만들어 두어 테스트 변경이 인자 하나다. 비용: 서비스의 INV-1 게이트 `ground()` 와 합쳐 **id 조회 1회 증가**(≤3건) — 무시 가능 |
| (나) 서비스가 한다 | 어댑터는 `poiId`+`rationale`+`degraded` 만 채우고, 서비스가 지금 버리고 있는 `ground()` 결과(`GroundedPlace`)로 거리·컷·정렬을 채운다 | 조회 1회 절약. 대신 도메인 타입에 "`distanceRange` 가 비어 있는 중간 상태"가 생기고, 로컬 경로와 http 경로에 서로 다른 후처리가 걸려 조건 분기가 는다 |

→ **(가) 추천.** "좌표 재조회 0건"이라는 근거 1은 (가)에서도 그대로 참이다(중심 좌표는 `SlotCandidatesInput` 에 이미 실려 있다).

### 파일별 작업

| # | 파일 | 작업 |
|---|---|---|
| 1 | `backend/modules/itinerary-generation/.../adapter/out/external/ScheduleAgentWire.kt` | **와이어 타입 추가**(새 파일 만들지 않는다 — 기존 패턴). `AiAlternativesRequest`·`AiTrigger`·`AiCoord`·`AiAlternativesResponse`·`AiAlternative`. 응답형의 **컬렉션·선택 필드에만 기본값**을 준다 — `alternatives: List<AiAlternative> = emptyList()`, `notes = emptyList()`, `emptyReason: String? = null` 처럼. 실제 선례는 타입이 아니라 **필드**다(`AiScheduleResponse.unplacedMustVisits: List<AiUnplacedMustVisit> = emptyList()`); `AiUnplacedMustVisit` 자체는 기본값이 0개다. 정정(2026-09-01 감사) — 초판의 "전 필드에 기본값"은 이 파일의 관행과 **반대**다: `AiScheduleResponse.solveMode`·`AiSlot.poiId/startAt/endAt`·`AiDay.date`·`AiViolation.code` 는 필수 필드 누락을 역직렬화 실패로 드러내려고 **일부러** 기본값이 없다. `AiAlternative.poiIds`·`rationale` 도 같은 이유로 기본값 없이 둔다. `AiRequestMeta` 는 이미 있다. snake_case 는 경계 매퍼가 자동 변환하므로 camelCase 필드명만 계약과 맞추면 된다 |
| 2 | 같은 파일 | **`toDomain` 확장 함수** — `AiAlternativesResponse.toDomain(input, grounded, receivedAt): SlotCandidatesOutput`. flatten → ground 교차 → 거리 계산 → 반경 컷 → (degraded 면) 정렬·템플릿 → `radiusMUsed` 확정. 하버사인은 이 모듈 안 private 상수/함수(`EARTH_RADIUS_M = 6_371_000.0` — `StayOnramp` 와 같은 이유로 place-data `domain` 을 못 쓴다) |
| 3 | `.../adapter/out/external/HttpScheduleAgentAdapter.kt` | `ALTERNATIVES_PATH = "/ai/v1/itinerary/alternatives"` 상수 추가(기존 4개 경로 상수 옆). `proposeSlotCandidates` 를 공통 `post(...)` 실호출로 교체 — **`scheduleAgentBoundedRestClient`** 를 쓴다(사용자가 화면에서 기다리는 동작). 마감은 `SlotCandidateService.CANDIDATES_DEADLINE_MS = 3_000L` — **서비스 companion 소속**이라 어댑터가 그 값을 다시 정의하지 말고 `input` 을 통해 받거나 서비스 상수를 참조한다(어댑터에는 `VALIDATE_DEADLINE_MS`·`REPAIR_DEADLINE_MS` 만 있다). 생성자에 `CandidatePoolPort` 추가(D-5가). `ScheduleAgentCallFailed` → `localCandidates` 폴백 + WARN(D-4가). 스키마 드리프트(`IllegalArgumentException`)는 기존 3경로와 같이 `ScheduleAgentCallFailed` 로 승격. **재시도 없음**(선언 정책) |
| 4 | `.../contract/AiBoundaryOpenApiTest.kt` | 경로 목록에 `"/ai/v1/itinerary/alternatives"` 추가. `wireKeys(sampleAlternativesRequest) shouldContainExactly props("AlternativesRequest")` + `TriggerSchema`·`CoordSchema`·`RequestMetaSchema` 중첩 검사 + 필수 필드(`anchor·dates·request_meta·trigger`) 누락 검사 + 응답측 `AlternativesResponse`·`AlternativeSchema` 키 일치. **이걸 빼면 새 경계만 게이트 밖에 남는다** |
| 5 | `.../adapter/out/external/HttpScheduleAgentAdapterTest.kt` | §7 케이스 추가. `fixture()` 의 `emptyPool` 을 채워 쓰는 변형 픽스처 하나 |
| 6 | `backend/app/src/test/kotlin/com/trippilot/app/LiveAiRoundTripIT.kt` | §7 의 왕복 케이스 2건 |
| 7 | `backend/docs/design/openapi.yaml` | `SlotCandidates.degraded` description 갱신(§4). **스키마 무변경** |
| 8 | `SlotCandidateController.kt` · `LocalSlotCandidateSource.kt` KDoc | `degraded` 의미 주석 갱신 / "http 모드가 여기로 우회한다"는 서술을 "AI 미도달·AI 폴백 시 쓰인다"로 |

**AI 쪽 변경 파일: 0. FE 변경 파일: 0.**

---

## 7. 테스트 계획

### fake 모드는 손대지 않는다 — 왜

`FakeScheduleAgent.proposeSlotCandidates` 는 `localCandidates.propose(input, degraded = false)` 그대로다. 백엔드 기본은 `AI_SCHEDULE_MODE=fake` 이고 **CI 는 전부 fake** 라, 이 PR 이 기본 경로에 미치는 영향이 0 이다. `SlotCandidateServiceTest`·`LocalSlotCandidateSourceTest`·`SlotCandidatesResponseTest`·`ScheduleAgentFakeModeIT` 가 **무변경으로 통과하는 것 자체가 회귀 없음의 증거**다. 이들을 고쳐야 한다면 그건 범위를 넘었다는 신호다.

### http 모드 단위 검증 — `MockRestServiceServer` (외부 호출 0)

요청측:
- `requestTo("/ai/v1/itinerary/alternatives")` · `method(POST)`
- `jsonPath("$.trigger.kind").value("MANUAL")` · `$.trigger.affected_date` · `$.dates[0]` · `$.anchor.lat` · `$.excluded_poi_ids` · `$.request_meta.deadline_ms` (3000)
- `$.affected_reasons` 에 대상 슬롯 `placementReason` 이 실린다 / 없으면 빈 객체

응답측:
| 케이스 | 기대 |
|---|---|
| `fallback_level=0`, rationale 정상 | `degraded=false`, rationale 원문 보존, `distanceRange` 채워짐, AI 순서 보존 |
| `fallback_level=1`, `rationale="MANUAL/none · rule_ranking"` | `degraded=true`, rationale **템플릿으로 교체**, **거리 오름차순 재정렬** |
| `fallback_level=2`, `alternatives=[]`, `empty_reason="no_candidates"` | 빈 목록 + `degraded=true`, **`emptyReason=ALL_IN_ITINERARY`** (§3) |
| 반경 컷으로 0건이 됨 (AI 는 후보를 줬다) | 빈 목록 + **`emptyReason=NO_NEARBY`**, `radiusMUsed=10000` |
| AI 가 모르는 `empty_reason` 문자열 | `NO_NEARBY` 로 떨어뜨리고 원문 WARN — 침묵 금지 |
| `poi_ids` 중 1건이 `ground()` 미통과 | 그 건만 제외, 나머지 유지 |
| 반경 컷 | `radiusM=3000` 인데 AI 가 8km 밖 후보를 줌 → 잘림 / 컷 결과 0건 → 10km 재컷 후 `radiusMUsed=10000` |
| `radiusM=20000` 요청 | `radiusMUsed=10000`(AI 풀 상한으로 접힘) — 없는 반경을 표시하지 않는다 |
| HTTP 500 | 예외가 새지 않고 `localCandidates` 결과 + `degraded=true` (D-4가) |
| 스키마 드리프트(미지 필드 형태) | `ScheduleAgentCallFailed` 로 승격, 침묵 금지 |

`ScheduleAgentHttpModeIT` 는 무변경(주입만 본다). 단, 어댑터 생성자에 `CandidatePoolPort` 를 추가하므로 **전체 컨텍스트 기동이 깨지지 않는지**를 이 테스트가 그대로 지켜 준다.

### `LIVE_AI=1` 왕복 테스트 추가 케이스

```
docker compose --profile full up -d ai
LIVE_AI=1 ./gradlew :app:test --tests "*LiveAiRoundTripIT*"
```

1. **`슬롯 후보가 상대에 수용되고 도메인으로 매핑된다`** — `trigger.kind=MANUAL` · `dates` 1건 · anchor 제주(33.4996, 126.5312, 기존 테스트와 동일 좌표)로 실호출. **후보 건수는 단정하지 않는다**(풀 상태 의존). `candidates.size`·`radiusMUsed`·`degraded`·`rationale` 첫 건을 `println("[LIVE-AI] alternatives → …")` 으로 기록. 예외가 안 나는 것 = 계약 통과가 이 테스트의 전부다(계약 게이트는 필드 **이름**만 보고, 한 겹 안쪽 변환 422 는 실호출로만 드러난다 — 전례 있음).
2. **`AI 가 LLM 랭킹을 냈는지 폴백했는지 기록`** — `degraded` 와 rationale 원문을 찍는다. LLM 키·KB 적재 상태에 따라 갈리므로 **값을 단정하지 않는다**.
3. 두 테스트 KDoc 에 **전제 1**(토큰 없으면 후보 0~1건이 정상처럼 보인다)을 명시한다.

주의: `LiveAiRoundTripIT` 는 `ScheduleAgentPort` 를 직접 주입받으므로 DB 일정 없이 포트만 호출한다 — 서비스 계층 검증(404/409)은 타지 않는다.

---

## 8. fake 로 두고 지금 할 수 있는 것 / 실연동이 켜져야 되는 것

### 지금 할 수 있다 (AI 컨테이너 없이, 토큰 없이) — **PR 하나가 여기까지로 완결된다**

- 와이어 타입 5종 작성 + `toDomain` 매퍼 (§6-1,2)
- **`AiBoundaryOpenApiTest` 확장** — 리포 안 `ai/docs/openapi.json` 을 그 자리에서 읽으므로 **AI 를 안 띄우고도 요청/응답 계약이 맞는지 여기서 끝난다.** 필드명 오타·필수 필드 누락은 전부 여기서 잡힌다
- `HttpScheduleAgentAdapter.proposeSlotCandidates` 실구현 (§6-3)
- `HttpScheduleAgentAdapterTest` 전 케이스 — `MockRestServiceServer` 라 외부 호출 0
- 거리 계산·반경 컷·정렬·템플릿 되돌리기 로직 + 단위 테스트
- `degraded` 의미 변경 + `openapi.yaml`·KDoc 갱신
- fake 모드 회귀 확인: `./gradlew :modules:itinerary-generation:test` · `:app:test`

→ 머지해도 **기본(fake) 모드 동작은 0 변화**다(http 모드 전용 경로).

### 실연동이 켜져야 확인된다

| 확인 항목 | 필요한 것 |
|---|---|
| 계약이 실물에 수용되는가 (422 없음) | AI 컨테이너 (`--profile full up -d ai`) |
| **쓸 만한 후보가 나오는가** | + `SERVICE_AUTH_TOKEN` (전제 1). 없으면 200 은 오지만 후보 0~1건이라 "매핑이 맞는지"만 확인되고 "쓸 만한지"는 확인 안 된다 |
| `degraded=false` 를 실제로 한 번이라도 보는가 | + LLM 키 + PlanB KB(pgvector) 적재. 없으면 `alternative_gateway_absent` / `retrieve_*_error` 로 **항상 `fallback_level=1`** 이다. → **이 티켓의 완료 조건으로 걸지 말고 별도 확인 항목으로 둔다** |
| FE 에서 강등 배너가 실제로 사라지는가 | 위 전부 + 실연동 스택 |

---

## 9. 이 티켓이 닫혀도 남는 한계 (명시)

1. **`neighborSlotKeys` 미반영** — 앞뒤 슬롯 동선 트레이드오프는 AI 경로에서도 안 본다. AI 요청 계약에 필드가 먼저 생겨야 한다.
2. **`concept` 은 문구에만** — 필터가 아니다. 컨셉→카테고리 매핑표는 별건.
3. **`reason` 이 항상 `"none"`** — `SlotCandidatesInput` 에 트리거·사유 정보가 없다. 그래서 **i14 의 우천 시나리오에서 AI 의 실외 강등(`_DEMOTED_BY_REASON["weather"]`)이 안 걸린다.** Plan-B 가 사유를 실어 보내려면 포트 입력 확장이 필요하다.
4. **`saved_places`·`budget_level`·`transport_mode` 미전달** — 개인화가 덜 걸린다. `saved_places` 는 place-data `..api..` 파사드 신설이 선행.
5. **후보 수 5 → 최대 3** — AI `max_alternatives = 3`.
6. **백엔드→AI 무인증** (전제 2) — 별도 티켓.

---

## 10. 착수 전 정리해야 할 것 (이 티켓 밖에서 발견, 2026-09-01 감사)

**FE 생성 스키마가 stale 하다.** `frontend/src/shared/api/generated/schemas/slotCandidates.ts` 에 `emptyReason` 이 없고, `frontend/src/` 전체에 그 심볼이 0건이다. orval 입력은 `frontend/orval.config.ts` 가 가리키는 `backend/docs/design/openapi.yaml` 이고 거기엔 있다 — 즉 **재생성이 안 된 상태**다.

이 티켓과 직접 관계는 없지만(이 PR 은 openapi 스키마를 안 바꾼다), 초판 설계가 `empty_reason` 에 대해 "실을 자리가 없다"고 잘못 판단한 것이 **생성물만 보면 실제로 자리가 없어 보이기 때문**이었을 가능성이 높다. 같은 착시가 다음 사람에게도 생긴다 — `pnpm codegen` 재생성을 별건으로 처리하는 편이 낫다.