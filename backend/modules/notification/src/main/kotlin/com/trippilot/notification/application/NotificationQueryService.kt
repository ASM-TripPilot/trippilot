package com.trippilot.notification.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 알림함 조회·읽음 표시(`l01`).
 *
 * 목록이 곧 catch-up 이다 — 푸시를 못 받았어도(꺼 뒀거나 실패했거나 3일 만에 앱을 켰거나) 여기 다 있다.
 * 그것이 INV-U6-02 가 말하는 "누락 0"의 실체다.
 */
@Service
class NotificationQueryService(
    private val notifications: NotificationRepository,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun list(accountId: UUID, unreadOnly: Boolean, limit: Int): List<Notification> =
        notifications.findByAccount(accountId, unreadOnly, limit.coerceIn(1, MAX_LIMIT))

    /**
     * 읽음 표시. **이미 읽은 것을 다시 눌러도 오류가 아니다** — 목록을 열 때마다 클라이언트가 재시도할 수 있고,
     * 그때 409 를 내면 화면이 붉어질 이유가 없는 곳에서 붉어진다. 처음 읽은 시각은 덮이지 않는다.
     *
     * 없거나 남의 알림이면 404 로 은닉한다 — 존재 여부가 새면 남의 알림 id 를 훑어볼 수 있다.
     */
    @Transactional
    fun markRead(accountId: UUID, notificationId: UUID) {
        if (notifications.markRead(accountId, notificationId, clock.instant())) return
        // 갱신이 0건인 이유는 둘 중 하나다 — 이미 읽었거나(정상), 내 것이 아니거나(404).
        if (!notifications.exists(accountId, notificationId)) throw ResourceNotFound("알림을 찾을 수 없습니다.")
    }

    companion object {
        /** 기본 반환 건수. 알림함은 한 화면 분량이면 충분하고, 더 필요하면 커서가 붙을 자리다. */
        const val DEFAULT_LIMIT = 50

        /** 전량 반환은 없다 — 계정 파기 전까지 무한히 쌓이는 테이블이다. */
        const val MAX_LIMIT = 200
    }
}
