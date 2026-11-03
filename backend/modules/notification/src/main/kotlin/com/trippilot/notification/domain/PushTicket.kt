package com.trippilot.notification.domain

import java.time.Instant
import java.util.UUID

/**
 * 발송이 Expo 에서 받은 티켓 한 건(TRIP-1707). `SENT` 는 **Expo 가 접수했다**는 뜻일 뿐이고, APNs·FCM 단계의 실패(프로젝트 자격 누락,
 * 영수증으로만 드러나는 죽은 토큰)는 15분 뒤 영수증을 이 id 로 조회해야 안다.
 *
 * @property token 영수증 응답엔 토큰이 없다 — 어느 기기 것인지 우리가 들고 있어야 죽은 토큰을 무효화할 수 있다.
 */
data class PushTicket(
    val ticketId: String,
    val notificationId: UUID,
    val token: String,
    val platform: DevicePlatform,
    val sentAt: Instant,
) {
    companion object {
        /** `push_ticket.ticket_id` 컬럼 폭. 넘는 id 는 기록하지 않는다(INSERT 가 터지면 발송 트랜잭션이 죽는다). */
        const val TICKET_ID_MAX = 64
    }
}

/** 푸시 티켓 영속 포트. */
interface PushTicketRepository {
    /**
     * 티켓을 기록한다. **던지지 않는다** — 발송 트랜잭션 안에서 불리므로 INSERT 실패가 곧 발화 롤백·재발송이 된다.
     * 이미 있는 `ticket_id` 는 무시하고, 폭을 넘는 값은 호출 쪽이 미리 거른다([PushTicket.TICKET_ID_MAX]·[PushToken.TOKEN_MAX]).
     */
    fun record(tickets: List<PushTicket>)
}
