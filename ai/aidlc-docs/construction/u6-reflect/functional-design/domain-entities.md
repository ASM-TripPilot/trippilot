# U6 Reflect — 도메인 엔티티 (FD)

> **v1.0 확정 (2026-08-25, 사용자 승인)** · 방침: **FE 합의 비차단** — 정본 계약(#334)대로 선행 구현하고 FE 의견은 통합 시점에 반영한다(팀 결정 2026-08-25) — TRIP-538 · AI-DLC CONSTRUCTION Functional Design.
> 근거 정본: `reflection-template-design.md`(#334 머지 — **출력 계약, 본 FD는 이 계약을 변경하지 않는다**),
> `reflect-agent-design.md` §4·5(트리거·상태 머신 — 무변), `agent-structure-v2.md` §3·4(Reflect 전속 도구·어셈블리 관문 스킵),
> 프롬프트 정본 §2.7(REFLECTION_NUDGE)·§2.8(REFLECTION_TEMPLATE — §2.3 REFLECTION은 2026-08-25 흡수·폐지), AI-D06, agent-foundation FD(BR-AF-07 절차).
> 규칙은 U1과 동일: `frozen=True, slots=True` · tz-aware · `from_dict(to_dict(x)) == x`(U5-P10) · 컬렉션은 tuple/frozenset만.

---

## 0. 재사용 — 변경 0

U6 Reflect는 아래 기존 규격을 **소비**한다. 손대지 않는다.

| 기존 타입 (소유) | 본 유닛에서의 역할 |
|---|---|
| `TraceId` `PoiId` `GeoPoint` (U1 common) | 식별·좌표 재사용 |
| `TypedResult[T]` (U1 llm) | 워커 호출 반환형 — `is_fallback=True → value=None` 강제 그대로 |
| `LlmCallRecord` `FallbackEvent` `GateDropEvent` (U1 observability) | 시도별 계측·강등 보고·closed-set 드롭 계측 |
| `PromptRef` (U1 prompt) | 버전 없는 호출 타입상 불가능 (NFR-7.3) |
| `AgentTask` `AgentResult` (agent-foundation delegation) | 대화형 REFLECT intent 경로의 봉투 (BR-AF-01~05) |
| ~~`Mood` `ReflectionDraft`~~ | **제거됨** (2026-08-25, 미결 #8 확정) — j03 본문은 템플릿 캡션 연결이 대체한다(계약 §3.2) |
| `ReflectionNudgeInput` + `FALLBACK_NUDGE_MESSAGE` (TRIP-347) | 회고 유도 푸시 — 별개 feature, 무변 |
| `LlmPort` / `LlmResponse` (U1 ports) | 무변. 단 `LlmRequest`는 **하위호환 확장 seam의 대상** — business-logic-model §6 (기존 텍스트 호출 전부 무영향이 조건) |

경계 전제: 방문 기록·이벤트·페르소나 요약은 **백엔드가 조립해 전달**한다(계약 §5, AI stateless).
POI 정본(백엔드 C7 단일 소유 — 정합성 점검 P1 합의)에 대한 조회·기록은 본 유닛에 없다.

## 1. 열거형 (domain/reflection.py — 신규)

| 타입 | 값 | 불변식 |
|---|---|---|
| `ReflectionKind` | `DAILY / TRIP_SUMMARY` | 계약 §3.1 봉투 `kind` |
| `ReflectionFormat` | `CARD_NEWS` (REELS·VIDEO는 enum 자리만 예약 — 계약 §1, 미결 #4의 계약 미결 #1) | 1차 산출은 CARD_NEWS만 |
| `SceneLayout` | `PHOTO_FULL / PHOTO_CAPTION / STATS / MAP / EVENT` | **닫힌 enum** (계약 §3.2) — 밖 layout = 하드 위반. 픽셀 배치는 FE 렌더러 소유 |
| `SourceEventKind` | `PLAN_B / SKIPPED` | EVENT 장면은 입력 이벤트에 **실재할 때만** 유효 (계약 §3.2) |
| `ViolationGrade` | `HARD / SOFT` | 계약 §4.1 등급 |
| `ViolationCode` | `TIME_EXPR / PLACEHOLDER_OUT / VISIT_REF_OUT / EVENT_NOT_FOUND`(이상 HARD) · `HASHTAG_OUT / CAPTION_LEN / SCENE_COUNT / DUP_VISIT_REF`(이상 SOFT — HASHTAG_OUT은 2026-08-25 강등, 미결 #5) | 위반 코드도 closed-set — 게이트가 이 코드만 산출 |

## 2. 입력 — 경계 요청 (domain/reflection.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `VisitRef` | `date: date, poi_id: PoiId` | 방문 기록 참조의 최소 단위 (계약 §3.2 `photo_slot.visit_ref`) |
| `VisitRecord` | `ref: VisitRef, poi_name: str, category: str, order_in_day: int, photo_count: int` | **시각·체류분 필드 없음** — INV-3 유출 원천 차단(입력 최소화, G181 동형). 순서는 실측 방문 순서(백엔드 조립값) |
| `TripEventRecord` | `kind: SourceEventKind, date: date, detail: str` | `source_event` 실재 검증의 대조 집합 |
| `ReflectionRequest` | `kind: ReflectionKind, region: str, start_date: date, end_date: date, visits: tuple[VisitRecord,...], events: tuple[TripEventRecord,...], persona_summary: str, weather_summary: str, vision: VisionInput \| None = None` | `len(visits) ≥ 1` (0건은 생성 진입 불가 — BR-U6R-15, 트리거 단과 이중 방어). `start_date ≤ end_date`. **사진 바이너리 절대 미포함** (계약 §5) — Phase 1은 `VisitRecord.photo_count` 수량 메타뿐. `vision`은 Phase 2 전용 (§4) |

- 서버 집계 통계(방문 N·이동 km·사진 N)는 **요청에 없다** — 숫자는 자리표시자로만 캡션에 실리고
  실측값 바인딩은 렌더 시 서버가 한다(계약 §2). AI가 숫자를 알 필요 자체가 없다 = 숫자 환각 구조 차단.

## 3. 산출 — 연출 템플릿 (domain/reflection.py, 계약 §3 스키마의 타입화)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `PhotoSlot` | `visit_ref: VisitRef` | 자리와 참조뿐 — 실제 사진 결합은 서비스 렌더 시 (business-logic-model §5) |
| `Scene` | `layout: SceneLayout, photo_slot: PhotoSlot \| None, caption: str, source_event: SourceEventKind \| None` | `layout ∈ {PHOTO_FULL, PHOTO_CAPTION}` ⇒ `photo_slot` 필수 · `layout = EVENT` ⇒ `source_event` 필수 (post-init) |
| `Cover` | `title: str, subtitle: str, photo_slot: PhotoSlot \| None` | subtitle 기본형 `{region} · {start_date}~{end_date}` — 자리표시자 |
| `ReflectionTemplate` | `template_id: str, kind, format, generated_at: datetime, is_fallback: bool, cover: Cover, scenes: tuple[Scene,...], hashtags: tuple[str,...]` | 계약 §3.1 봉투 + §3.2 본문. tz-aware. **시각·순서·duration 필드 자체가 없다** (INV-2 비적용의 구조화 + INV-3). `template_id` 생성 규칙은 미결 #3 |
| `PLACEHOLDER_VOCAB` (상수) | `{visit_count} {distance_km} {photo_count} {region} {start_date} {end_date} {poi:i.name}` | **자리표시자 어휘도 closed-set** — 어휘 밖 참조·poi 인덱스 범위 밖 = 하드 위반. 어휘 확장 = 계약 개정 |
| `TemplateViolation` | `grade: ViolationGrade, code: ViolationCode, scene_index: int \| None, detail: str` | 게이트 산출물 — 빈 튜플 = 위반 0 (조기 종료 조건) |
| `TemplateCandidate` | `template: ReflectionTemplate, violations: tuple[TemplateViolation,...], attempt: int(1~3)` | 랭킹 입력 1건. **하드 위반이 있어도 후보는 유지** — 드롭이 아니라 N회 생성→최선 채택 (계약 §4) |

## 4. Phase 2 — 멀티모달 입력 (domain/reflection.py, 출력 타입 추가 없음)

**Phase 2에서 산출 타입(§3)은 하나도 늘지 않는다** — 달라지는 것은 장면 채움의 입력뿐 (FE 재협상 없는 드롭인).

| 타입 | 필드 | 불변식 |
|---|---|---|
| `PhotoId` | `NewType('PhotoId', str)` | 백엔드 사진 정본(TRIP-478)의 키 |
| `PhotoRef` | `photo_id: PhotoId, visit_ref: VisitRef \| None, taken_at: datetime \| None, gps: GeoPoint \| None, image_ref: str` | 메타 + 접근 참조. `image_ref` 형태(사전서명 URL vs 인라인)는 미결 #2 |
| `PhotoConsent` | `granted: bool, consent_ref: str, granted_at: datetime` | `consent_ref` = 백엔드 **append-only 법무 로그**(consent-log — DB 권한 수준 DELETE 불가) 레코드 참조. AI는 동의를 판정하지 않고 증빙 참조를 트레이스에 연결한다 |
| `VisionInput` | `photos: tuple[PhotoRef,...], consent: PhotoConsent` | **post-init: `consent.granted=True` ∧ `consent_ref` 비어있지 않음** — 아니면 `ValueError`. 즉 **미동의 상태의 VisionInput은 인스턴스로 존재 자체가 불가능** (U1 "검증 위치" 규칙 동형 — 동의 게이트의 타입 강제) · `len(photos) ≥ 1` |
| (하이라이트 산출) | `tuple[PhotoId,...]` | 별도 타입 없이 PhotoId 튜플 — `⊆ 입력 photos의 id 집합`(게이트 강제, INV-1 정신) · 중복 0 · 개수 ≤ 요청 상한 N. 경계 전달 형태는 미결 #1 |

## 5. 직렬화·검증 규칙 (U1 승계)

- §1~§4 전 타입: `to_dict()/from_dict()` 왕복 (RFL-P6). Enum → `.value`, datetime → ISO 8601(오프셋 포함).
- `ReflectionTemplate.to_dict()`가 곧 경계 응답 본문 — 계약 §3 JSON과 키 단위 일치 (openapi 반영은 business-rules DoD).
- 범위·정합 검증은 전부 `__post_init__` — 유효하지 않은 인스턴스는 존재 불가.
- `TypedResult`·`GateOutcome` 등 게이트웨이 파이프라인 형태는 U4 규격 그대로 — 본 유닛은 값 타입만 추가한다.
