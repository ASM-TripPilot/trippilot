package com.trippilot.assistant.adapter.`in`.event

import com.trippilot.assistant.application.AssistantRetention
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 계정 삭제 요청 → 도우미 대화·사용량 즉시 파기(DATA-U8-02).
 *
 * FK CASCADE 만으로는 지워지지 않는다 — 계정 행은 유예 기간(30일) 동안 남고, 그 뒤의 파기 배치도 아직 없다.
 * 이 구독이 없으면 **탈퇴하겠다고 한 사람의 말이 보존 기간 내내 남는다.**
 *
 * **소급하지 않는다** — 이 구독이 생기기 전에 발행된 이벤트는 릴레이가 이미 흘려보냈다. 도우미 테이블(V2.64)이 이 구독과
 * **같은 배포**로 처음 나가므로 그 전에 쌓인 대화는 없다(2026-10-14 확인: 직전 운영 배포는 V2.64 이전이다). 둘을 갈라
 * 배포했다면 그 사이 삭제를 요청한 계정의 대화는 보존 청소(90일)까지 남는다.
 *
 * 멱등: 계정 id 로 지우므로 같은 이벤트가 두 번 배달돼도(at-least-once) 두 번째는 0행이다.
 */
@Component("assistantAccountDeletionSubscriber")
class AccountDeletionSubscriber(private val retention: AssistantRetention) : OutboxSubscriber {

    override val eventType: String = "auth.AccountDeletionRequested"

    override fun handle(envelope: EventEnvelope) {
        val accountId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다(INV-4).
            ?: error("AccountDeletionRequested 의 aggregateId 를 계정으로 읽지 못했습니다. eventId=${envelope.eventId}")
        val purged = retention.purgeAccount(accountId)
        log.info("계정 삭제 요청으로 도우미 대화 {}건을 지웠습니다. eventId={}", purged, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AccountDeletionSubscriber::class.java)
    }
}
