# U8 Conversational Assistant — Domain Entities

> 정본 순위: 리포 실물 > ai 문서 > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션.
> **재사용 절은 실장 기술**(2026-10-12 실측), **신설 절은 설계**다. 마이그레이션 번호는 **고정하지 않는다** — 현재 최신은 `V2.62__trip_day_window.sql`이고, 착수 시점의 최신 + 1부터 매긴다(U6가 제안 번호 V2.33~36과 실번호가 갈린 전례).
> 모듈 내부 계층은 `api / application / domain / adapter(in·out)`(components.md 2026-10-12 개정).

---

## 1. 소유 경계표

| 엔티티 | 물리 | 소유 | U8 접근 |
|---|---|---|---|
| `assistant_session` | **신설** | U8 `:modules:assistant` | 쓰기 |
| `assistant_message` | **신설** | U8 | 쓰기 |
| `assistant_proposal` | **신설** | U8 | 쓰기 |
| `account` | V1.1 | U0 auth | 읽기(FK) |
| `trip` | V2.3 | U1 trip | 읽기 — `TripFacade.findPeriod`(소유 확인 겸용) |
| 일정(`itinerary`·`visit_slot`) | U3 | itinerary-generation | 읽기 — `ItineraryFacade`·`ItineraryPlanFacade` / 쓰기는 **`ItineraryEditFacade`(신설, G-U8-1) 경유만** |
| `itinerary_revision` | U3 | itinerary-generation | **직접 접근 안 함** — 편집 퍼사드가 남긴다 |
| `change_log_entry` | V2.11 · `source` CHECK에 `ASSISTANT` 이미 있음 | change-log | **직접 접근 안 함** — 편집 퍼사드가 `ChangeSourceType.ASSISTANT`로 남긴다 |
| 금칙어 사전 | moderation | moderation | `TextModerationFacade.inspect`만 |
| 날씨·POI 표면 | weather-context · place-data | 각 모듈 | 퍼사드 읽기만 |

> **다른 모듈은 `assistant`의 `api`에만 의존할 수 있다.** 1차에는 `assistant`를 부르는 다른 모듈이 없다 — 앱만 부른다. 역방향(assistant → 각 모듈 `api`)만 있다. 동기 순환 없음.

> **[개정 · 2026-10-19 · US-ASSIST-09 신설]** 위 표에 한 줄을 더한다 — `assistant_message_feedback` · **신설(V2.74)** · U8 `:modules:assistant` · 쓰기(§3.7). 다른 모듈 경계는 그대로다(평가는 앱만 부른다).

---

## 2. 재사용 (실장)

| 자산 | 위치 | U8에서의 쓰임 |
|---|---|---|
| `ChangeSource { PLAN_B, MANUAL, COEDIT, ASSISTANT }` · `ChangeSourceType`(api) | `backend/modules/change-log/src/main/kotlin/com/trippilot/changelog/domain/ChangeLogEntry.kt:25` · `api/ChangeLogFacade.kt:57` | 어시스턴트 적용분의 출처. **현재 아무도 `ASSISTANT`를 쓰지 않는다** |
| `EditItineraryService.edit(accountId, tripId, EditItinerary)` | `backend/modules/itinerary-generation/.../application/EditItineraryService.kt:75` | [적용]의 실제 저장 경로(재검증·리비전·change log·거절 기록) — 퍼사드로 감싸 연다 |
| `EditItinerary{days[{date, slots[{poiId,startAt,endAt,isFixed,endsNextDay}]}], reason}` | 같은 파일 :41 | `assistant_proposal.after`의 모양. **전체 교체**라 제안도 전체 일정을 담는다 |
| `ItineraryContent.sameAs` | itinerary-generation | 제안 기준 지문 대조의 선례(INV-U8-04) |
| `RateLimited(retryAfterSeconds)` → 429 + `Retry-After` | `backend/common/core/src/main/kotlin/com/trippilot/core/error/DomainException.kt:79` · `GlobalExceptionHandler` | 분당 20턴 초과. **던지는 곳이 처음 생긴다** |
| `TextModerationFacade.inspect(text): ModerationVerdict(clean, category)` | `backend/modules/moderation/.../api/TextModerationFacade.kt` | 입력 선검사. 사전이 없으면 예외(fail-closed) → 그 턴은 FALLBACK |
| ai `DialogueContext`·`PendingFrame`·`IntentFrame`(직렬형) | `ai/aidlc-docs/construction/assistant-dialogue/functional-design/domain-entities.md` §1·§6 (코드는 `ai/src/trippilot/domain/dialogue.py`에 인자표만 실재) | backend는 **불투명 jsonb**로 저장·반송한다(INV-U8-07) |

---

## 3. 신설

### 3.1 `assistant_session` — 대화 맥락의 단위 (DEC-U8-5)

| 필드 | 타입 | 비고 |
|---|---|---|
| `session_id` | uuid PK | |
| `account_id` | uuid FK → `account` | **ON DELETE CASCADE** — 회원 탈퇴 시 함께 지워진다 |
| `trip_id` | uuid? FK → `trip` | null = 일반(무컨텍스트) 세션. **ON DELETE CASCADE** |
| `status` | varchar(16) | `ACTIVE` \| `CLOSED` |
| `dialogue_context` | jsonb | ai `DialogueContext` 직렬형. **backend는 `turn_index`만 읽고 올린다**, 나머지는 그대로 반송 |
| `refusal_streak` | smallint | 연속 거절(금칙어·범위 밖) 횟수 — 2 이상이면 사용 안내로 전환(BR-U8-25), 정상 턴에서 0 |
| `created_at` · `last_turn_at` | timestamptz | `last_turn_at`이 목록 정렬·만료 기준 |
| `expires_at` | timestamptz | 보존 만료(값은 O-U8-1). 청소 배치가 지난 행을 지운다 |

- 부분 UNIQUE: `(account_id, trip_id) WHERE status = 'ACTIVE' AND trip_id IS NOT NULL` · `(account_id) WHERE status = 'ACTIVE' AND trip_id IS NULL`.
- 인덱스: `(account_id, last_turn_at DESC)` — `b06` 목록.

**INV-U8-01** — 한 계정에 **(여행 1개당) ACTIVE 세션은 최대 1개, 일반 세션도 최대 1개**다. 같은 여행 대화가 두 갈래로 쪼개지지 않는다(DB 부분 UNIQUE가 보장).

**INV-U8-02** — 세션의 `trip_id`는 **그 계정이 소유한 여행**이다. 생성 시 `TripFacade.findPeriod(accountId, tripId)`가 null이면 만들지 않는다(404 존재 은닉).

### 3.2 `assistant_message` — 표시용 대화 기록 (DEC-U8-4)

| 필드 | 타입 | 비고 |
|---|---|---|
| `message_id` | uuid PK | |
| `session_id` | uuid FK | CASCADE |
| `account_id` | uuid | 비정규화 — **리미터 카운트**(DEC-U8-9)와 탈퇴 정리용 |
| `client_turn_id` | uuid? | 사용자 턴만. **UNIQUE `(session_id, client_turn_id)`** — 멱등 키 |
| `role` | varchar(16) | `USER` \| `ASSISTANT` |
| `kind` | varchar(24) | §3.4 `MessageKind` |
| `text` | text? | 사용자 원문(≤500) 또는 도우미 템플릿 문구. 금칙어 위반 입력은 `null` + `redacted=true` |
| `redacted` | boolean | 정책 위반 입력 원문 미보관 표지(BR-U8-23) |
| `payload` | jsonb? | 카드 데이터(§3.4) |
| `next_actions` | jsonb | 도우미 메시지는 **1개 이상**(INV-U8-03) |
| `quick_replies` | jsonb | 서버 발급 quick reply(id·라벨·액션) |
| `intent` · `match_route` | varchar? | 관측용(해석된 경우만). 화면에 쓰지 않는다 |
| `proposal_id` | uuid? FK → `assistant_proposal` | `PROPOSAL`·`ACTION_LOG` 메시지 |
| `created_at` | timestamptz | |

- 인덱스: `(session_id, created_at)` — 페이지 조회 · `(account_id, created_at) WHERE role = 'USER'` — 분당 리미터.

**INV-U8-03** — `role = ASSISTANT`인 메시지는 **`next_actions`가 비어 있을 수 없다**(PRD 02-1 dead-end 금지). 거절·폴백·범위 밖도 예외가 아니다(DB CHECK `jsonb_array_length(next_actions) >= 1`).

**INV-U8-05** — 같은 `(session_id, client_turn_id)`로 두 번 들어온 턴은 **두 번째에 새 행을 만들지 않고** 처음 응답을 돌려준다.

**INV-U8-06** — 메시지 `payload`·`text`에 **소요시간 필드·문자열이 없다**(INV-3). 거리만(`distanceRange` 문자열 그대로).

> **[개정 · 2026-10-19 · US-ASSIST-09 신설] 관측 칸 `trace_id` 추가(V2.74, expand-only).** `trace_id varchar(64)?` — 그 턴의 해석 호출에 실어 보낸 `request_meta.request_id`(backend 가 호출마다 만든다). AI 는 같은 값을 `trace_id` 로 로그(`llm_cost`·`FallbackEvent`·`LlmCallRecord`)에 남긴다 — 답변 평가(§3.7)를 프롬프트 판본·모델·폴백과 잇는 열쇠다(BR-U8-64). 도우미 행에만 있고, 해석을 부르지 않은 턴(버튼·빠른 답·버튼 모드·입력 거절)과 사용자 행은 null. `intent`·`match_route` 와 같은 관측 칸이라 화면에 쓰지 않는다(OBS-U8-01 의 넷에 더해지는 다섯째 칸).

### 3.3 `assistant_proposal` — [적용] 전의 변경안 (DEC-U8-2)

| 필드 | 타입 | 비고 |
|---|---|---|
| `proposal_id` | uuid PK | |
| `session_id` · `account_id` · `trip_id` | uuid FK | CASCADE |
| `kind` | varchar(16) | 1차 `EDIT`만 |
| `base_fingerprint` | varchar(64) | 제안을 만든 시점 일정의 내용 지문(슬롯 열 해시) — 낡음 판정(INV-U8-04) |
| `after` | jsonb | `EditItinerary` 모양 — 전체 일자·슬롯. 시각은 **ai 조립이 검증해 돌려준 값만**(INV-2) |
| `diff` | jsonb | 카드용 항목 목록 `[{change: ADDED\|REMOVED\|REPLACED\|MOVED\|RETIMED, slotKey, before{name,startAt,distanceRange}?, after{...}?}]` |
| `violations` | jsonb | ai 응답 위반 목록(사유 문구). 비어 있지 않으면 적용 불가(BR-U8-31) |
| `apply_hint` | varchar(16)? | ai `apply_mode` 그대로(`AUTO_APPLY`\|`CONFIRM_REQUIRED`) — **표시 힌트일 뿐**(DEC-U8-2) |
| `status` | varchar(16) | §3.5 상태기계 |
| `expires_at` | timestamptz | 생성 + 30분(제안값, O-U8-4) |
| `applied_at` · `revision_id` · `change_log_entry_id` | timestamptz? · uuid? · uuid? | 적용 결과 추적(US-ASSIST-05 "무엇을 바꿨는지") |
| `created_at` | timestamptz | |

**INV-U8-04** — 적용은 **지금 일정의 지문 = `base_fingerprint`**일 때만 일어난다. 그 사이 사용자가 일정을 바꿨으면 `STALE`이 되고 저장하지 않는다 — 옛 일정에 맞춘 전체 교체가 새 편집을 덮어쓰지 않는다.

**INV-U8-08** — 제안 하나는 **최대 한 번** 적용된다. `APPLIED`에서 다른 상태로 가는 전이는 없다(되돌리기는 리비전 복원 — 별도 경로).

**INV-U8-09** — `after`·`diff`·`violations` 어디에도 `duration`·소요시간 항목이 없다(INV-3).

### 3.4 `MessageKind` · 카드 페이로드

| `kind` | 역할 | `payload` 요지 | Figma |
|---|---|---|---|
| `TEXT` | 사용자 발화 · 도우미 짧은 문구 | — | 전 프레임 |
| `CLARIFY` | 인자 되묻기 | `{argument, question, options[]?}` | — |
| `REVIEW` | 진행 검토 | `{trip, stays, itineraryState, problems[{slotKey?, reason(솔버 위반 문구), fixAction}]}` | `b01 review` |
| `CANDIDATES` | 대체 후보 | `[{poiId, name, distanceRange?, reason}]` | — |
| `PROPOSAL` | 전후 비교 카드 | `proposal_id` 참조 + `diff` 요약 | `b02` |
| `INFO` | 조회(다음 장소·거리·장소·날씨) | 종류별 값 | — |
| `SCOPE` | 범위 밖 · 외부 위임 | `{reason, alternative?}` | `b03` |
| `REFUSAL` | 정책 위반 거절 | `{category}`(원문 없음) | `b04` |
| `FALLBACK` | 실패 | `{cause: AI_UNAVAILABLE\|SOLVER_UNAVAILABLE\|SOURCE_UNAVAILABLE\|TRANSLATION_FAILED\|REJECTED}` | `b05` |
| `ACTION_LOG` | 적용·이동 기록 | `{what, revisionId?, changeLogEntryId?}` | `b06` 행 |

**`NextAction`** — `{type, label, params}`. `type` closed-set: `OPEN_ITINERARY` · `OPEN_ITINERARY_EDIT` · `OPEN_ITINERARY_METHOD` · `OPEN_REGENERATE` · `OPEN_REPLAN` · `OPEN_LIVE` · `OPEN_PLACE` · `OPEN_STAY_SEARCH` · `OPEN_OTA` · `OPEN_REFLECTION` · `OPEN_TRIP_SUMMARY` · `OPEN_STYLE` · `CREATE_TRIP` · `RETRY_TURN` · `CONTINUE_WITHOUT_ASSISTANT` · `SHOW_CAPABILITIES` · `RESTORE_REVISION`. 앱은 모르는 `type`을 받으면 그 버튼을 그리지 않고 `SHOW_CAPABILITIES`를 대신 보인다(BR-U8-06).

**`QuickReply`** — `{id, label, action, params}`. `action` closed-set: `SEND_TEXT`(라벨을 발화로) · `REVIEW` · `PICK_CANDIDATE` · `PICK_OPTION`(되묻기 보기) · `SHOW_CAPABILITIES` · `RETRY`. **서버가 발급한 id만 ACTION 턴으로 받는다**(위조 액션 차단).

### 3.5 제안 상태기계

```
PROPOSED --[적용, 지문 일치, 위반 없음]--> APPLIED
PROPOSED --[적용, 지문 불일치]----------> STALE
PROPOSED --[취소]-----------------------> DISMISSED
PROPOSED --[expires_at 경과]------------> EXPIRED
PROPOSED --[적용 중 저장 예외]----------> FAILED (사용자에게 알림, 재제안 quick reply)
APPLIED / STALE / DISMISSED / EXPIRED / FAILED : 종결 (나가는 전이 없음)
```

### 3.6 `DialogueContext` 영속 형태 (ai FD §6과 정합)

```json
{
  "pending": {
    "frame": { "intent": "EDIT_SCHEDULE", "arguments": { "target": "카페 모카" }, "missing": ["day"],
               "confidence": 0.9, "match_route": "CONFIDENT", "source_span": null, "depends_on": null },
    "asked": "몇째 날 일정을 바꿀까요?",
    "asked_argument": "day",
    "asked_at": "2026-10-12T05:01:00Z"
  },
  "turn_index": 5,
  "clarify_count": 1
}
```

- `asked_at`은 tz-aware만(ai 직렬화 규칙 DLG-P9). backend는 이 문자열을 고치지 않는다.
- 보류 프레임 폐기 조건(다른 의도로 CONFIDENT · 턴 2회 경과 · 만료)은 **ai가 판정**하고 갱신본을 돌려준다(BR-DLG-24). backend는 받은 대로 덮어쓴다.
- **이 칸은 발화 원문 목록을 담지 않는다**(BR-DLG-21). 원문은 `assistant_message`에만 있다.

**INV-U8-07** — backend는 `dialogue_context`를 **해석하지 않는다** — `turn_index`를 1 올리는 것 외에 내용을 만들거나 고치지 않는다. 두 곳이 같은 규칙을 판정하면 갈라진다.

### 3.7 `assistant_message_feedback` — 답변 평가 (US-ASSIST-09)

> **[개정 · 2026-10-19 · US-ASSIST-09 신설] 절 신설.** 사용자 요청(도우미 답변마다 좋아요/싫어요). 규칙은 `business-rules.md` §8(BR-U8-60~65). 마이그레이션 `V2.74__assistant_message_feedback.sql`(착수 시점 최신 V2.73 + 1).

| 필드 | 타입 | 비고 |
|---|---|---|
| `message_id` | uuid PK · FK → `assistant_message` | **ON DELETE CASCADE** — 메시지당 평가 하나. 대화가 사라지는 네 길(이력 지우기·여행 삭제·계정 삭제·보존 청소)이 전부 세션 → 메시지 → 평가로 연쇄된다 |
| `account_id` | uuid | 비정규화(`assistant_message` 와 같다). 계정 FK 는 걸지 않는다 — 계정 파기는 세션 연쇄로 이미 닿는다 |
| `rating` | varchar(8) | `UP` \| `DOWN`(CHECK) |
| `created_at` · `updated_at` | timestamptz | 처음 남긴 시각 · 바꾼 시각. 바꿔도(upsert) `created_at` 은 그대로다 |

- 쓰기: 남기기·바꾸기 = `INSERT … ON CONFLICT (message_id) DO UPDATE`(notification_toggle 선례), 취소 = DELETE(없어도 오류 아님).
- 읽기: 메시지를 읽을 때 붙인다 — 조회·열기·턴 응답의 메시지 `feedback`(`UP`|`DOWN`|null)과 내보내기 줄의 `feedback` 칸. 표시용 `AssistantMessage` 는 평가 값만 들고, 판정·로그에 쓰는 관측 칸(`intent`·`trace_id`)은 따로 읽는다.
- **법정 로그가 아니다** — append-only 권한 제약을 걸지 않는다(취소가 DELETE 다). 평가·지표 용도로만 쓰고 모델 학습에 쓰지 않는다(BR-U8-63).

**INV-U8-10** — 평가는 **도우미의 답**(`role = ASSISTANT` 이고 `kind ≠ ACTION_LOG`)에만 붙고 메시지당 많아야 하나다(PK). 메시지가 사라지면 평가도 사라진다(FK CASCADE) — 대화보다 오래 사는 평가는 없다.

---

## 4. 마이그레이션 제안 (번호 미정 — 착수 시 최신 + 1)

| 순서 | 파일(가칭) | 내용 |
|---|---|---|
| 1 | `V2.N__assistant_session.sql` | §3.1 + 부분 UNIQUE 2 + 인덱스 + `status` CHECK |
| 2 | `V2.N+1__assistant_proposal.sql` | §3.3 + `kind`·`status` CHECK |
| 3 | `V2.N+2__assistant_message.sql` | §3.2 + `UNIQUE(session_id, client_turn_id)` + CHECK `role <> 'ASSISTANT' OR jsonb_array_length(next_actions) >= 1` + 리미터 부분 인덱스 |

- 셋 다 **일반 테이블**이다 — 법정 로그가 아니므로 append-only 권한 제약을 걸지 않는다(사용자 삭제 `b06 이력 지우기`·보존 만료 청소가 DELETE를 쓴다). `location_legal_log`·동의 로그 규율과 섞지 않는다.
- 청소 배치: `@Scheduled` + ShedLock(`OutboxRelay` 선례) — `expires_at < now()`인 세션을 지운다(메시지·제안 CASCADE).
- `change_log_entry.source` CHECK는 이미 `ASSISTANT`를 포함한다(V2.11) — **마이그레이션 불요**.

---

## 5. 관계

```
account 1 --- * assistant_session (trip_id null 은 계정당 ACTIVE 1)
trip    1 --- 0..1 assistant_session (ACTIVE 기준)
assistant_session 1 --- * assistant_message
assistant_session 1 --- * assistant_proposal
assistant_message * --- 0..1 assistant_proposal
assistant_proposal --(적용)--> ItineraryEditFacade --> itinerary_revision / change_log_entry(ASSISTANT)
```

> **[개정 · 2026-10-19 · US-ASSIST-09 신설]** 위 관계에 한 줄을 더한다 — `assistant_message 1 --- 0..1 assistant_message_feedback`(도우미 답만, CASCADE · §3.7).
