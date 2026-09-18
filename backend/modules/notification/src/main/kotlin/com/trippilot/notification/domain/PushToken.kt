package com.trippilot.notification.domain

import java.time.Instant
import java.util.UUID

/** 기기 종류. Expo 는 둘을 같은 표면으로 받지만 우리는 조사·통계를 위해 남긴다. */
enum class DevicePlatform { IOS, ANDROID }

/**
 * OS 푸시 권한 **미러**(`location_consent_state.os_permission_mirror` 와 같은 꼴).
 *
 * 서버는 OS 권한을 알 방법이 없다 — 클라이언트가 알려 주는 값이고, 그래서 낡을 수 있다.
 * 그 낡음을 실제로 고치는 것은 Expo 의 `DeviceNotRegistered` 다(INV-U6-07).
 */
enum class OsPermission { GRANTED, DENIED, NOT_DETERMINED }

/**
 * 푸시 토큰 한 건(U6 정본 §2.3).
 *
 * **한 계정에 여러 개일 수 있다**(INV-U6-06 다기기) — 발송은 유효 토큰 전부에 한다.
 * 폰과 태블릿을 함께 쓰는 사용자에게 한쪽만 울리면 그쪽을 안 보고 있을 때 놓친다.
 */
data class PushToken(
    val pushTokenId: UUID,
    val accountId: UUID,
    val token: String,
    val deviceId: String?,
    val platform: DevicePlatform,
    val osPermission: OsPermission,
    val lastSeenAt: Instant,
    val invalidatedAt: Instant?,
) {
    init {
        require(token.isNotBlank() && token.length <= TOKEN_MAX) { "토큰은 1~$TOKEN_MAX 자여야 합니다." }
    }

    /** 살아 있고 OS 권한도 있는가. **둘 다여야 쏜다** — 권한이 없으면 쏴도 사용자에게 닿지 않는다. */
    val deliverable: Boolean get() = invalidatedAt == null && osPermission == OsPermission.GRANTED

    companion object {
        /** `push_token.token` 컬럼 상한과 같아야 한다 — 갈리면 저장 시점에 22001 로 터진다. */
        const val TOKEN_MAX = 255

        fun register(
            accountId: UUID,
            token: String,
            deviceId: String?,
            platform: DevicePlatform,
            osPermission: OsPermission,
            now: Instant,
        ) = PushToken(
            pushTokenId = UUID.randomUUID(),
            accountId = accountId,
            token = token,
            deviceId = deviceId,
            platform = platform,
            osPermission = osPermission,
            lastSeenAt = now,
            // 재등록은 **되살린다**(null). 앱을 지웠다 다시 깐 기기가 죽은 채로 남으면 알림이 영영 안 간다.
            invalidatedAt = null,
        )
    }
}

/** 푸시 토큰 영속 포트. */
interface PushTokenRepository {
    /**
     * 토큰 기준 등록·갱신. 같은 토큰이 **다른 계정**에 있으면 그 계정에서 떼어 새 계정에 붙인다 —
     * 기기 교체·계정 전환의 실제 모습이고, 그러지 않으면 남의 알림이 그 기기로 간다.
     */
    fun register(token: PushToken): PushToken

    /** 유효 토큰 전부(INV-U6-06). 무효화된 것은 나오지 않는다. */
    fun findActive(accountId: UUID): List<PushToken>

    /**
     * 조건부 무효화 — 이미 무효면 false(INV-U6-07).
     *
     * 조건부인 이유는 다중 인스턴스가 같은 죽은 토큰에 동시에 부딪히기 때문이다. 무조건 UPDATE 면
     * "언제 죽었나"가 마지막 시도 시각으로 계속 밀린다.
     */
    fun invalidate(token: String, at: Instant): Boolean

    /** 로그아웃·기기 해제. 남의 토큰이면 false. */
    fun remove(accountId: UUID, token: String): Boolean
}
