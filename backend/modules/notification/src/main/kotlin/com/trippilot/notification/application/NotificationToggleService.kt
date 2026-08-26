package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationToggle
import com.trippilot.notification.domain.NotificationToggleRepository
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 알림 수신 설정(`l02`).
 *
 * **행이 없다 ≠ 꺼짐.** 조회는 저장된 행 위에 기본값을 덮어 **항상 7종을 다 준다** — 화면이 "설정한
 * 적 없음"과 "꺼 둠"을 구분하려 애쓰지 않아도 된다.
 *
 * `SYSTEM` 은 어디에도 나타나지 않는다(INV-U6-03·04) — 조회 목록에도 없고 변경도 거부한다.
 * 보안·계정 알림은 끌 수 있는 것이 아니다.
 */
@Service
class NotificationToggleService(
    private val toggles: NotificationToggleRepository,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun list(accountId: UUID): List<NotificationToggle> {
        val saved = toggles.findByAccount(accountId).associateBy { it.kind }
        // 저장된 것이 우선, 없으면 기본값. 순서는 enum 선언 순 — 화면이 정렬을 다시 하지 않게.
        return NotificationToggle.TOGGLEABLE.map { saved[it] ?: NotificationToggle.defaultFor(accountId, it, clock.instant()) }
    }

    /**
     * 한 종류를 바꾼다. 저장된 행이 없으면 기본값에서 출발해 만든다.
     *
     * 푸시와 인앱은 **따로 간다**(INV-U6-02) — 푸시를 꺼도 인앱은 쌓여, 앱을 열면 놓친 것을 볼 수 있다.
     */
    @Transactional
    fun update(accountId: UUID, kind: NotificationKind, pushEnabled: Boolean?, inAppEnabled: Boolean?): NotificationToggle {
        if (kind == NotificationKind.SYSTEM) {
            throw ValidationFailed(listOf(FieldError("kind", "보안·계정 알림은 끌 수 없습니다")))
        }
        val now = clock.instant()
        val current = toggles.findByAccount(accountId).firstOrNull { it.kind == kind }
            ?: NotificationToggle.defaultFor(accountId, kind, now)
        // null 은 **변경 없음**이다(지움이 아니다) — 한쪽만 바꾸는 요청이 다른 쪽을 덮지 않는다.
        return toggles.upsert(
            current.copy(
                pushEnabled = pushEnabled ?: current.pushEnabled,
                inAppEnabled = inAppEnabled ?: current.inAppEnabled,
                updatedAt = now,
            ),
        )
    }

    /**
     * 이 종류를 **인앱에 적재할 것인가**. 적재 경로(TRIP-547 발화기·구독자)가 묻는 자리다.
     *
     * **INV-U6-03 — `SYSTEM` 은 토글과 무관하게 항상 적재된다.** 여기서 갈리지 않으면 어딘가에서
     * 보안 알림이 조용히 사라진다.
     */
    @Transactional(readOnly = true)
    fun allowsInApp(accountId: UUID, kind: NotificationKind): Boolean {
        if (kind == NotificationKind.SYSTEM) return true
        return toggles.findByAccount(accountId).firstOrNull { it.kind == kind }?.inAppEnabled
            ?: NotificationToggle.defaultFor(accountId, kind, clock.instant()).inAppEnabled
    }

    /** 이 종류를 **푸시로 보낼 것인가**(TRIP-549 가 쓴다). `SYSTEM` 은 언제나 보낸다. */
    @Transactional(readOnly = true)
    fun allowsPush(accountId: UUID, kind: NotificationKind): Boolean {
        if (kind == NotificationKind.SYSTEM) return true
        return toggles.findByAccount(accountId).firstOrNull { it.kind == kind }?.pushEnabled
            ?: NotificationToggle.defaultFor(accountId, kind, clock.instant()).pushEnabled
    }
}
