package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import org.slf4j.LoggerFactory
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
    ): PushToken {
        val incoming = PushToken.register(accountId, token, deviceId, platform, osPermission, clock.instant())
        val saved = tokens.register(incoming)
        // 앱은 포그라운드 복귀마다 같은 토큰을 다시 보낸다 — 줄은 **처음 보는 토큰**일 때만 남긴다(저장소가 기존 행의 id 를 돌려주면 갱신).
        // 새 빌드가 푸시 토큰을 만들기 시작했는지 DB 접근 없이 로그로 센다. 토큰·계정 값은 싣지 않는다.
        if (saved.pushTokenId == incoming.pushTokenId) {
            // 토큰 모양도 센다 — Expo 푸시 서비스는 `ExponentPushToken[…]`/`ExpoPushToken[…]` 만 받는다. 앱이 APNs·FCM 기기 토큰을 보내면
            // 등록은 되지만 첫 발송에서 `DeviceNotRegistered` 로 보여 죽은 토큰과 구분이 안 된다 — 등록 줄에서 바로 갈라 둔다. 값은 싣지 않는다.
            log.info(
                "push.token.register platform={} osPermission={} deliverable={} tokenFormat={}",
                saved.platform, saved.osPermission, saved.deliverable, if (EXPO_TOKEN.matches(saved.token)) "expo" else "other",
            )
        }
        return saved
    }

    /** 로그아웃·기기 해제. 없거나 남의 것이면 false — 존재를 알려 주지 않는다. */
    @Transactional
    fun remove(accountId: UUID, token: String): Boolean = tokens.remove(accountId, token)

    /** 이 계정에 **쏠 수 있는 기기가 있는가**. 화면이 `권한 필요` 안내를 그릴지 판단하는 값이다. */
    @Transactional(readOnly = true)
    fun hasDeliverableDevice(accountId: UUID): Boolean = tokens.findActive(accountId).any { it.deliverable }

    private companion object {
        private val log = LoggerFactory.getLogger(PushTokenService::class.java)

        /** Expo 푸시 토큰의 모양(`ExponentPushToken[…]` 구형·`ExpoPushToken[…]` 신형). */
        private val EXPO_TOKEN = Regex("^Expo(nent)?PushToken\\[[^\\]\\s]+]$")
    }
}
