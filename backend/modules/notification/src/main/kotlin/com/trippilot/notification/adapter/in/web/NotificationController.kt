package com.trippilot.notification.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.notification.application.NotificationQueryService
import com.trippilot.notification.domain.Notification
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/** 알림함(`l01`) — 계정 하위 리소스. 소유 스코프(타 계정 404). 최신순. */
@RestController
@RequestMapping("/api/v1/me/notifications")
class NotificationController(private val service: NotificationQueryService) {

    @GetMapping
    fun list(
        principal: Principal,
        @RequestParam(required = false, defaultValue = "false") unreadOnly: Boolean,
        @RequestParam(required = false, defaultValue = "${NotificationQueryService.DEFAULT_LIMIT}") limit: Int,
    ): NotificationListResponse =
        NotificationListResponse(service.list(principal.accountId(), unreadOnly, limit).map { NotificationResponse.from(it) })

    @PostMapping("/{notificationId}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun markRead(principal: Principal, @PathVariable notificationId: UUID) =
        service.markRead(principal.accountId(), notificationId)
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

data class NotificationListResponse(val items: List<NotificationResponse>)

/**
 * 알림 한 건의 웹 표현.
 *
 * `l01` 이 `10분 전`·`어제` 같은 **상대 시각**으로 그리므로 서버는 [occurredAt] 절대 시각만 준다 —
 * 포맷은 기기 로케일·시간대의 몫이다.
 *
 * 푸시 결과(`push_sent_at`·`push_failed_reason`)는 싣지 않는다. 인앱 목록은 푸시 성패와 무관하고
 * (INV-U6-02), 사용자에게 "푸시가 실패했다"는 보여 줄 값이 없다.
 */
data class NotificationResponse(
    val notificationId: UUID,
    val kind: String,
    val title: String,
    val body: String,
    val actionType: String?,
    val actionPayload: Map<String, String>?,
    val occurredAt: Instant,
    /** null = 미읽음 — 목록 좌측 빨간 dot 의 근거. */
    val readAt: Instant?,
) {
    companion object {
        fun from(n: Notification) = NotificationResponse(
            notificationId = n.notificationId,
            kind = n.kind.name,
            title = n.title,
            body = n.body,
            actionType = n.actionType,
            actionPayload = n.actionPayload,
            occurredAt = n.occurredAt,
            readAt = n.readAt,
        )
    }
}
