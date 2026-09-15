package com.trippilot.notification.adapter.out.external

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
    val tripTitle: String?,
)

internal data class AiReminderRequestMeta(
    val requestId: String,
    val requestedAt: Instant,
    val deadlineMs: Long,
)

internal data class AiReminderCopyItem(
    val scheduleKey: String,
    val kind: String,
    val date: String,
    val slots: List<String>,
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
