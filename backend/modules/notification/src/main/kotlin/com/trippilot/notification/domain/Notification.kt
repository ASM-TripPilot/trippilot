package com.trippilot.notification.domain

import java.time.Instant
import java.util.UUID

/**
 * 인앱 알림 한 건(U6 정본 §2.1) — 알림함의 정본이자 catch-up 의 원천.
 *
 * **INV-U6-02**: 이 행의 존재는 푸시 성공 여부와 무관하다. 푸시가 실패해도 행은 남고, 앱이 3일 뒤에 켜져도
 * 여기서 읽힌다. "누락 0"의 근거는 푸시가 아니라 이 영속성이다. [pushSentAt]·[pushFailedReason] 은
 * 발송 결과를 **기록만** 하는 칸이다(TRIP-549 가 채운다).
 *
 * @property sourceEventId 아웃박스 이벤트 id — 있으면 DB UNIQUE 가 중복 적재를 막는다(INV-U6-01).
 *   스케줄러가 만든 알림은 원천 사건이 없어 null 이다.
 * @property dedupKey 중복 억제 판정용 표식(예 `TRIP_DAY#{tripId}#{date}`). 유니크가 아니다 —
 *   "같은 것을 또 보내려 한다"를 나중에 판정하기 위한 재료일 뿐이다.
 */
data class Notification(
    val notificationId: UUID,
    val accountId: UUID,
    val kind: NotificationKind,
    val title: String,
    val body: String,
    val actionType: String?,
    val actionPayload: Map<String, String>?,
    val sourceEventId: UUID?,
    val dedupKey: String?,
    val occurredAt: Instant,
    val readAt: Instant?,
    val pushSentAt: Instant?,
    val pushFailedReason: String?,
) {
    init {
        require(title.isNotBlank() && title.length <= TITLE_MAX) { "제목은 1~$TITLE_MAX 자여야 합니다." }
        require(body.isNotBlank() && body.length <= BODY_MAX) { "본문은 1~$BODY_MAX 자여야 합니다." }
    }

    companion object {
        /** `notification.title` 컬럼 상한과 같아야 한다 — 갈리면 저장 시점에 22001 로 터진다. */
        const val TITLE_MAX = 120

        /** `notification.body` 컬럼 상한. */
        const val BODY_MAX = 400

        /** 새로 적재되는 알림. 미읽음이고 푸시 결과는 아직 없다. */
                fun raise(
            accountId: UUID,
            kind: NotificationKind,
            title: String,
            body: String,
            occurredAt: Instant,
            actionType: String? = null,
            actionPayload: Map<String, String>? = null,
            sourceEventId: UUID? = null,
            dedupKey: String? = null,
        ) = Notification(
            notificationId = UUID.randomUUID(),
            accountId = accountId,
            kind = kind,
            title = title,
            body = body,
            actionType = actionType,
            actionPayload = actionPayload,
            sourceEventId = sourceEventId,
            dedupKey = dedupKey,
            occurredAt = occurredAt,
            readAt = null,
            pushSentAt = null,
            pushFailedReason = null,
        )
    }
}
