package com.trippilot.notification.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.notification.application.PushTokenService
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.validation.annotation.Validated
import java.security.Principal
import java.util.UUID

/**
 * 푸시 토큰 등록·해제. 계정 하위 리소스.
 *
 * **등록은 멱등이라 PUT 이 아니라 POST 다** — 같은 토큰을 다시 보내면 새 행이 아니라 갱신이고,
 * 클라이언트는 자기 토큰의 서버 id 를 모른다(토큰 자체가 키다).
 *
 * `osPermission` 을 함께 받는 이유는 **서버가 OS 권한을 알 방법이 없기** 때문이다. 이 값이 채널
 * 판정에 들어간다 — 권한이 없으면 쏘지 않는다(쏴도 닿지 않고 레이트리밋만 먹는다).
 */
@RestController
@RequestMapping("/api/v1/me/push-tokens")
@Validated
class PushTokenController(private val service: PushTokenService) {

    @PostMapping
    fun register(principal: Principal, @RequestBody request: RegisterPushTokenRequest): PushTokenResponse =
        PushTokenResponse.from(
            service.register(
                accountId = principal.accountId(),
                token = request.token,
                deviceId = request.deviceId,
                platform = request.platform,
                osPermission = request.osPermission,
            ),
        )

    /** 해제. 없거나 남의 것이면 404 — 존재를 알려 주지 않는다. */
    @DeleteMapping("/{token}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(principal: Principal, @PathVariable token: String) {
        if (!service.remove(principal.accountId(), token)) throw ResourceNotFound()
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

data class RegisterPushTokenRequest(
    @field:NotBlank @field:Size(max = PushToken.TOKEN_MAX) val token: String,
    @field:Size(max = 64) val deviceId: String? = null,
    val platform: DevicePlatform,
    /** 클라이언트가 알려 주는 OS 권한 미러. 안 주면 `NOT_DETERMINED` — 모른다는 뜻이라 쏘지 않는다. */
    val osPermission: OsPermission = OsPermission.NOT_DETERMINED,
)

/**
 * @property deliverable 이 기기에 **실제로 쏠 수 있는가**. 화면이 `권한 필요` 안내를 그릴 근거다 —
 *   등록에 성공했다는 것과 알림이 간다는 것은 다른 말이다.
 */
data class PushTokenResponse(
    val deviceId: String?,
    val platform: String,
    val osPermission: String,
    val deliverable: Boolean,
) {
    companion object {
        // 토큰 자체는 돌려주지 않는다 — 클라이언트가 이미 갖고 있고, 응답·로그에 흘릴 이유가 없다.
        fun from(t: PushToken) =
            PushTokenResponse(t.deviceId, t.platform.name, t.osPermission.name, t.deliverable)
    }
}
