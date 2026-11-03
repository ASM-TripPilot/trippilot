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

/** 영수증 판정 결과(`push_ticket.receipt_status`). */
enum class ReceiptStatus {
    /** 영수증이 ok — APNs·FCM 이 접수했다(기기 표시까지 보증하지는 않는다). */
    OK,

    /** 영수증이 오류 — 코드는 `receipt_error` 에 남는다. */
    ERROR,

    /** 24시간이 지나도 영수증이 없다(Expo 는 그 뒤 영수증을 지운다) — 도착 여부를 끝내 모른다. */
    EXPIRED,
}

/**
 * Expo 영수증 한 건(`getReceipts` 응답의 값). 티켓 id 가 키로 돌아오고 **토큰은 없다** — 그래서 티켓 기록이 토큰을 들고 있다.
 */
data class TicketReceipt(val ok: Boolean, val error: String?, val message: String?)

/**
 * 영수증 조회 포트 — [PushPort] 에 메서드를 더하지 않고 **따로 둔다**. 더하면 발송기 대역 전부가 영수증을 알아야 하고, 기본 구현은
 * [PushPort.deliversExternally] 와 같은 "기본값이 거짓말한다" 함정이 된다(없는 영수증을 ok 로 읽는다).
 */
interface PushReceiptPort {
    /**
     * 티켓 id → 영수증. 응답에 없는 id(아직 안 만들어졌거나 24시간이 지나 사라짐)는 **맵에서 빠진다** — 둘은 구분되지 않는다.
     * 한도(429)·자격(401/403)·네트워크 오류는 예외로 올라간다 — 호출 쪽이 상태를 바꾸지 않고 다음 회차로 넘긴다.
     */
    fun fetch(ticketIds: List<String>): Map<String, TicketReceipt>
}

/** 푸시 티켓 영속 포트. */
interface PushTicketRepository {
    /**
     * 티켓을 기록한다. **던지지 않는다** — 발송 트랜잭션 안에서 불리므로 INSERT 실패가 곧 발화 롤백·재발송이 된다.
     * 이미 있는 `ticket_id` 는 무시하고, 폭을 넘는 값은 호출 쪽이 미리 거른다([PushTicket.TICKET_ID_MAX]·[PushToken.TOKEN_MAX]).
     */
    fun record(tickets: List<PushTicket>)

    /** 아직 판정 안 된 티켓 중 [sentBefore] 이전에 보낸 것 — 오래된 순, 최대 [limit] 건. */
    fun findDue(sentBefore: Instant, limit: Int): List<PushTicket>

    /**
     * 조건부 판정 — **이미 판정된 티켓이면 false**. 다중 인스턴스가 같은 영수증을 받아도 판정은 하나만 성공하므로, 부수효과(토큰
     * 무효화·로그·지표)는 true 를 받은 쪽만 낸다(잠금 없이 중복을 막는 전부다).
     */
    fun settle(ticketId: String, status: ReceiptStatus, error: String?, at: Instant): Boolean

    /** 판정이 끝난 티켓 중 [sentBefore] 이전에 보낸 것을 지운다 — 보존 기간이 지난 기록. 지운 건수. */
    fun purgeSettledBefore(sentBefore: Instant): Int

    /** 아직 판정 안 된 티켓 수 — 폴러가 멈추면 이 값이 쌓인다. */
    fun countPending(): Long
}
