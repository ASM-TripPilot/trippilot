package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 푸시 토큰 등록·해제(`l02` 권한 판정의 입력).
 *
 * 등록은 **멱등**이다 — 앱은 포그라운드 복귀마다 같은 토큰을 다시 보낼 수 있고, 그때마다
 * `last_seen_at` 과 OS 권한 미러가 갱신된다. 서버가 OS 권한을 알 방법은 이 미러뿐이다.
 */
@Service
class PushTokenService(
    private val tokens: PushTokenRepository,
    private val clock: Clock,
) {
    @Transactional
    fun register(
        accountId: UUID,
        token: String,
        deviceId: String?,
        platform: DevicePlatform,
        osPermission: OsPermission,
    ): PushToken = tokens.register(
        PushToken.register(accountId, token, deviceId, platform, osPermission, clock.instant()),
    )

    /** 로그아웃·기기 해제. 없거나 남의 것이면 false — 존재를 알려 주지 않는다. */
    @Transactional
    fun remove(accountId: UUID, token: String): Boolean = tokens.remove(accountId, token)

    /** 이 계정에 **쏠 수 있는 기기가 있는가**. 화면이 `권한 필요` 안내를 그릴지 판단하는 값이다. */
    @Transactional(readOnly = true)
    fun hasDeliverableDevice(accountId: UUID): Boolean = tokens.findActive(accountId).any { it.deliverable }
}
