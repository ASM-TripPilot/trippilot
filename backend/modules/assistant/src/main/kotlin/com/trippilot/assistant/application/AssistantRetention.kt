package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.DialogueMemoryPort
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 도우미 데이터의 파기(DATA-U8-01·02·04). 대화에는 사용자가 한 말이 그대로 들어 있다 — 보존 기간이 지났거나 계정을
 * 지우겠다고 했으면 **실제로 지워져야** 한다. 만료된 대화는 조회에서 이미 안 보이지만(`expires_at`), 안 보이는 것과
 * 없는 것은 다르다.
 *
 * ShedLock 없음 — 만료분 DELETE 는 멱등이라 여러 인스턴스가 겹쳐 돌아도 두 번 지워질 것이 없다(위치 확인자료 스위퍼와
 * 같은 판단). 주기는 하루 — 하루 늦은 파기는 "마지막 이용 후 90일"을 하루 넘길 뿐이고, 그동안에도 조회되지는 않는다.
 */
@Component
class AssistantRetention(
    private val sessions: AssistantSessionRepository,
    private val usage: AssistantUsageRepository,
    private val properties: AssistantProperties,
    private val memory: DialogueMemoryPort,
    private val clock: Clock,
) {
    @Scheduled(
        fixedDelayString = "\${trippilot.assistant.retention-sweep-ms:86400000}",
        initialDelayString = "\${trippilot.assistant.retention-initial-delay-ms:0}",
    )
    @Transactional
    fun sweep() {
        val now = clock.instant()
        val expired = sessions.deleteExpired(now)
        // 사용량은 발화가 없는 카운터라 대화와 따로 간다 — 월 상한 집계에 필요한 만큼만 둔다.
        val stale = usage.deleteBefore(LocalDate.ofInstant(now, TRAVEL_ZONE).minusDays(properties.usageRetentionDays))
        // 조용히 지우지 않는다 — 개인 발화의 파기는 로그로 답할 수 있어야 한다(INV-4). 건수뿐이고 내용은 없다.
        if (expired > 0 || stale > 0) log.info("도우미 보존 청소 — 만료된 대화 {}건, 오래된 사용량 {}행을 지웠습니다.", expired, stale)
    }

    /**
     * 계정 삭제 요청 — **즉시** 지운다(DATA-U8-02). 30일 유예를 기다리지 않고, 철회해도 되살리지 않는다(GPS 즉시 파기와 같은
     * 규율). 같은 이벤트가 두 번 와도 두 번째는 0행이다.
     *
     * 유예 중인 계정이 그 뒤에 다시 대화하면 그 대화는 남는다(계정을 최종 파기하는 배치가 아직 없다) — 보존 청소가 90일 뒤에
     * 지운다. 파기 순간에 돌던 턴이 LLM 을 썼으면 사용량 한 행이 다시 생길 수 있다(발화 없는 카운터, 40일 뒤 청소).
     *
     * 사용량까지 지우는 것은 여기뿐이다 — 이력 지우기는 사용량을 남긴다(COST-U8-01: 지우기가 상한 우회가 되지 않게).
     *
     * 상대 세션 메모리(요약)도 여기서 지운다(DE §4.1 · BR-AO-10). **실패는 올린다** — 이력 지우기와 달리 TTL 백스톱에 맡기지 않는다
     * (DATA-U8-02 즉시 파기): 예외가 트랜잭션을 되감고 아웃박스가 재시도한다. 파기는 멱등이라 재시도가 두 번 지울 것은 없다.
     */
    @Transactional
    fun purgeAccount(accountId: UUID): Int {
        val purged = sessions.deleteByAccount(accountId)
        usage.deleteByAccount(accountId)
        memory.deleteByAccount(accountId.toString())
        return purged
    }

    private companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val log = LoggerFactory.getLogger(AssistantRetention::class.java)
    }
}
