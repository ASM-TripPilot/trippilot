package com.trippilot.notification.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.notification.application.NotificationToggleService
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationToggle
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 알림 수신 설정(`l02`). 계정 하위 리소스.
 *
 * **`SYSTEM` 은 여기 나타나지 않는다**(INV-U6-03·04) — 목록에도 없고 변경도 400 이다.
 * 보안·계정 알림은 끌 수 있는 것이 아니라서, 화면에 두면 "왜 안 꺼지지"가 된다.
 */
@RestController
@RequestMapping("/api/v1/me/notification-settings")
class NotificationToggleController(private val service: NotificationToggleService) {

    @GetMapping
    fun list(principal: Principal): NotificationToggleListResponse =
        NotificationToggleListResponse(service.list(principal.accountId()).map { NotificationToggleResponse.from(it) })

    @PatchMapping("/{kind}")
    fun update(
        principal: Principal,
        @PathVariable kind: NotificationKind,
        @RequestBody request: UpdateToggleRequest,
    ): NotificationToggleResponse = NotificationToggleResponse.from(
        service.update(principal.accountId(), kind, request.pushEnabled, request.inAppEnabled),
    )
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/** `null` 은 **변경 없음**이다(끄는 뜻이 아니다) — 한쪽만 바꾸는 요청이 다른 쪽을 덮지 않는다. */
data class UpdateToggleRequest(val pushEnabled: Boolean? = null, val inAppEnabled: Boolean? = null)

/** 항상 7종이 다 온다 — 설정한 적 없는 종류는 기본값으로 채워진다(행이 없다 ≠ 꺼짐). */
data class NotificationToggleListResponse(val items: List<NotificationToggleResponse>)

data class NotificationToggleResponse(
    val kind: String,
    val pushEnabled: Boolean,
    val inAppEnabled: Boolean,
) {
    companion object {
        fun from(t: NotificationToggle) = NotificationToggleResponse(t.kind.name, t.pushEnabled, t.inAppEnabled)
    }
}
