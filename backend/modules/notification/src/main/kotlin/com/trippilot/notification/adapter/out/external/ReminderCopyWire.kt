package com.trippilot.notification.adapter.out.external

import com.fasterxml.jackson.annotation.JsonInclude
import java.time.Instant

/**
 * `POST /ai/v1/notification/copies` 와이어 타입(TRIP-836).
 *
 * 필드 이름이 곧 계약이다 — 매퍼가 snake_case 로 바꾸므로 여기서는 카멜로 쓴다.
 * 이름이 어긋나면 상대가 422 로 거절하고 우리는 상수 문구로 내려간다(조용히 틀리지는 않는다).
 */
internal data class AiReminderCopyRequest(
    val requestMeta: AiReminderRequestMeta,
    val items: List<AiReminderCopyItem>,
    /**
     * **null 이면 키째로 뺀다.** 계약이 `{"type":"string","default":""}` 이라 **nullable 이 아니다** —
     * `null` 을 실으면 `body.trip_title: Input should be a valid string` 로 **매 호출이 422** 다
     * (실측 2026-09-16 실 왕복). 키를 빼면 상대가 기본값 `""` 를 쓴다.
     *
     * 빈 문자열을 대신 싣지 않는 이유: "제목이 없다"와 "제목이 빈 문자열이다"를 우리가 구분해 두는 편이
     * 나중에 trip.api 가 제목을 주기 시작할 때 갈림길이 보인다.
     */
    @param:JsonInclude(JsonInclude.Include.NON_NULL)
    val tripTitle: String?,
)

internal data class AiReminderRequestMeta(
    val requestId: String,
    val requestedAt: Instant,
    val deadlineMs: Long,
)

internal data class AiReminderCopyItem(
    val scheduleKey: String,
    /** 계약 enum 은 `TRIP_DAY`·`TRIP_PRE` **둘뿐**이다 — 다른 종류는 어댑터가 미리 거른다. */
    val kind: String,
    val date: String,
    /**
     * **객체 배열이다.** 계약은 `ReminderSlotSchema[]`(`name` 필수 · `category` 선택)인데
     * 문자열 배열로 보내면 `Input should be a valid dictionary` 로 422 다(실측 2026-09-16).
     *
     * 계약 게이트가 **속성 이름만** 대조해서 이 어긋남을 못 봤다 — `slots` 라는 이름은 양쪽에 다 있다.
     * 그래서 게이트에 타입 대조를 더했다([ReminderCopyBoundaryOpenApiTest]).
     */
    val slots: List<AiReminderSlot>,
)

/** 그 날 갈 곳 하나. [category] 는 우리가 아직 안 채운다 — 없으면 상대가 이름만으로 쓴다. */
internal data class AiReminderSlot(
    val name: String,
    @param:JsonInclude(JsonInclude.Include.NON_NULL)
    val category: String? = null,
)

/**
 * 응답. **`degraded` 가 판단의 전부다** — 켜져 있으면 상대가 규칙 문구로 내려간 것이라
 * 우리도 쓰지 않는다(회고 `source` 선례: 가짜를 AI 로 표시하면 품질 관측이 거짓이 된다).
 */
internal data class AiReminderCopyResponse(
    val copies: List<AiReminderCopy> = emptyList(),
    val degraded: Boolean = false,
    val fallbackMode: String? = null,
)

internal data class AiReminderCopy(
    val scheduleKey: String,
    val title: String,
    val body: String,
)
