# API Documentation

> ⚠ **지위 강등 (2026-08-07, TRIP-282).** 아래 `/c1/*`·`/c2/*`·`/m7/*` **세분 경로는 폐기 방향**이다.
> PR #76 "굵은 경계 — 조각 조립 경계(백엔드가 M7·C1·C2를 직접 지휘)는 두지 않는다" 합의에 따라
> 실제 백엔드↔AI 경계는 포워드·리버스 **두 방향**뿐이다:
> - 포워드 — 열린 경로 목록의 정본은 `ai/docs/openapi.json`(일정 `/ai/v1/itinerary/*` · 회고 `/ai/v1/reflection/*`)
> - 리버스 `GET /internal/pois?centerLat&centerLng&radiusKm` · `POST /internal/pois/batch-get`(필드 `poi_ids`)
>
> 경로·필드의 **정본은 `../application-design/agent-io-contracts.md` 0.1**이다.
> 본 문서는 **AI 서비스 내부의 논리 인터페이스 참고용**으로만 남긴다 — 경계 계약으로 인용하지 말 것.
> 프로토콜도 미확정이 아니라 **REST/JSON over HTTP 확정**(PR #76 결정4)이다.

## Python AI 서비스 API (Kotlin 백엔드 → AI 서비스)

> 아래 경로 표기는 **폐기 방향의 논리 인터페이스**다(위 지위 강등 註). 요청/응답 필드 구조만 참고한다.

### C1 LLM Gateway API

#### call — LLM feature 호출
- **Method**: POST
- **Path**: `/c1/call`
- **Purpose**: 특정 feature의 LLM 워커를 호출하여 구조화된 결과를 반환
- **Request**:
  ```json
  {
    "feature": "preference_scoring",
    "context_refs": [{"type": "trip", "id": "trip_123"}],
    "prompt": { "version": "v1", "template_id": "pref_score_v1" },
    "schema": { "type": "scored_poi_list" }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "result": [{"poi_id": "poi_abc", "score": 0.87}],
    "is_fallback": false
  }
  ```

#### route — 자연어 의도 라우팅 (AI 도우미 전용)
- **Method**: POST
- **Path**: `/c1/route`
- **Purpose**: 자연어 입력의 의도 분류 + 슬롯 추출 → 워커 디스패치 계획 반환
- **Request**:
  ```json
  {
    "utterance": "비 와서 실내로 바꿔줘",
    "context_refs": [{"type": "itinerary", "id": "itin_456"}],
    "requester": {"user_id": "user_789"}
  }
  ```
- **Response**:
  ```json
  {
    "intent": "REPLAN",
    "slots": {"reason": "weather", "preference": "indoor"},
    "dispatch": [
      {"worker": "ReplanAgent", "params": {}},
      {"worker": "PreferenceAgent", "params": {"filter": "indoor"}}
    ],
    "apply_mode": "confirm_required"
  }
  ```

#### resolve_context — 컨텍스트 재조회
- **Method**: POST
- **Path**: `/c1/resolve-context`
- **Purpose**: 요청자 권한으로 ResourceRef를 재조회하여 LLM 주입용 컨텍스트 생성
- **Request**: `{"requester": {...}, "refs": [...]}`
- **Response**: `{"injected_context": {...}}` or `PermissionDeniedError`

### C2 Assembly Engine API

#### solve — 일정 배치 최적화
- **Method**: POST
- **Path**: `/c2/solve`
- **Purpose**: 후보 POI + 제약을 받아 최적 방문 순서·시각 배치 반환
- **Request**:
  ```json
  {
    "anchor": {"lat": 37.5665, "lng": 126.9780},
    "time_windows": [{"date": "2026-08-01", "start": "09:00", "end": "21:00"}],
    "candidates": [{"poi_id": "poi_abc", "score": 0.87, "open": "10:00", "close": "22:00"}],
    "fixed_blocks": [],
    "travel_params": {"safety_public": 1.5, "safety_walk": 1.4, "buffer_min": 15},
    "budget_weight": {"level": "mid", "weight": 0.3}
  }
  ```
- **Response**:
  ```json
  {
    "days": [{
      "date": "2026-08-01",
      "slots": [{"poi_id": "poi_abc", "start_at": "10:30", "end_at": "12:00", "is_fixed": false}]
    }],
    "is_fallback": false,
    "solve_mode": "full_ai"
  }
  ```

#### validate — 하드 제약 검증
- **Method**: POST
- **Path**: `/c2/validate`
- **Purpose**: 일정의 하드 제약 위반 여부를 검증
- **Request**: `{"itinerary": {...}, "constraints": {...}}`
- **Response**: `{"violations": []}` or `{"violations": [{"type": "HC2", "slot_index": 3, "detail": "..."}]}`

#### repair — 최소 변경 수리
- **Method**: POST
- **Path**: `/c2/repair`
- **Purpose**: 위반 배치를 시각·순서만 최소 조정하여 수리
- **Request**: `{"itinerary": {...}, "violations": [...], "policy": "minimal_change"}`
- **Response**: `{"repaired": {...}, "changes": [...]}`

#### estimate_travel — 이동시간 추정 (내부 전용)
- **Method**: POST
- **Path**: `/c2/estimate-travel`
- **Purpose**: 두 지점 간 이동시간 추정 (어셈블리 내부용, DTO 미노출)
- **Request**: `{"from": {"lat": ..., "lng": ...}, "to": {...}, "mode": "public"}`
- **Response**: `{"distance_range": "약 2.1km", "internal_minutes": 25, "is_estimated": true}`

### M7 Place Data API

#### get_candidate_pool — closed-set 후보 풀 생성
- **Method**: POST
- **Path**: `/m7/candidate-pool`
- **Purpose**: 여행 조건으로 필터링한 후보 POI 집합 반환
- **Request**:
  ```json
  {
    "anchor": {"lat": 37.5665, "lng": 126.9780},
    "radius_km": 10.0,
    "budget_level": "mid",
    "dates": ["2026-08-01", "2026-08-02"],
    "transport_mode": "public"
  }
  ```
- **Response**: `{"poi_ids": ["poi_abc", ...], "pois": [...], "generated_at": "..."}`

#### fuzzy_match — 엔티티 해소
- **Method**: POST
- **Path**: `/m7/entity-resolve`
- **Purpose**: 사용자 입력 텍스트를 M7 POI/지역에 결정론적으로 매칭
- **Request**: `{"name": "강능", "kind": "region"}`
- **Response**: `{"matched": {"id": "region_gangneung", "name": "강릉"}, "score": 0.92, "status": "bound"}`

## Data Models

### Poi (M7 정본)
- **Fields**: poi_id, source, source_id, source_url, name, address, location, category, open_hours, is_closed_today, avg_cost, default_stay_minutes, tags, rating, data_quality, confidence, last_verified_at
- **Relationships**: CandidatePool에 포함, VisitSlot에서 poi_id로 참조
- **Validation**: 좌표 필수, 카테고리 필수, data_quality >= PARTIAL

### ItineraryProblem (C2 입력)
- **Fields**: anchor, time_windows, candidates, fixed_blocks, travel_params, budget_weight
- **Relationships**: CandidatePool의 ScoredPoi를 candidates로 수신
- **Validation**: candidates 비어있지 않음, time_windows 1일 이상

### ItinerarySolution (C2 출력)
- **Fields**: days(list[DaySolution]), is_fallback, solve_mode
- **Relationships**: M8이 수신하여 일정 저장소에 기록
- **Validation**: 모든 slot이 HC1~HC4 통과

### VisitSlot
- **Fields**: poi_id, start_at, end_at, internal_duration_min(내부전용), travel_from_prev, is_fixed
- **Relationships**: DaySolution에 포함
- **Validation**: start_at < end_at, poi_id in candidate_pool

### VisitSlotDisplay (표시 DTO)
- **Fields**: poi_id, start_at, end_at, distance_range, is_fixed
- **Note**: internal_duration_min 필드 **부재** (INV-3 보장)
