package com.trippilot.recalculation.application

import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 재계획 산출·반영 대역. [proposal] 을 바꿔 "해 있음/해 없음"을, [failWith] 로 AI 실패를 만든다.
 * [applied] 로 **반영이 실제로 일어났는지** 본다 — INV-U4-05(확정 전 무변경) 검증의 핵심이다.
 */
internal class FakeReplans(
    var proposal: ReplanProposal? = sampleProposal(),
    var failWith: RuntimeException? = null,
) : ReplanFacade {
    val commands = mutableListOf<ReplanCommand>()
    val applied = mutableListOf<ReplanProposal>()

    /** 확정 시 넘어온 이력 사유(BR-U4-31) — 조립이 맞는지 여기서 본다. */
    val appliedReasons = mutableListOf<String>()

    override fun propose(command: ReplanCommand): ReplanProposal? {
        commands += command
        failWith?.let { throw it }
        return proposal
    }

    override fun apply(accountId: UUID, tripId: UUID, proposal: ReplanProposal, reason: String) {
        applied += proposal
        appliedReasons += reason
    }

    companion object {
        val ITINERARY_ID: UUID = UUID.fromString("11111111-1111-4111-8111-111111111111")

        fun sampleProposal(date: LocalDate = LocalDate.parse("2026-08-11")) = ReplanProposal(
            ITINERARY_ID, date,
            listOf(
                ReplanSlot(
                    UUID.randomUUID(), LocalTime.parse("14:00"), LocalTime.parse("15:00"),
                    isFixed = false, endsNextDay = false, distanceRange = "약 1.2km", placementReason = "실내라 비를 피할 수 있어요",
                ),
            ),
        )
    }
}

/**
 * 방문 실적 대역. 실적은 `archive` 소유라 여기서는 **경계 너머의 답**만 흉내 낸다 —
 * 잠금 대상이 완료분만인지·마지막 완료 방문지가 무엇인지는 archive 모듈 스펙이 본다.
 */
internal class FakeArchive(
    private val completedSlots: Set<String> = emptySet(),
    private val lastCompletedPoi: UUID? = null,
) : ArchiveFacade {
    override fun getCompletedSlots(tripId: UUID) = completedSlots
    override fun findLastCompletedPoi(tripId: UUID) = lastCompletedPoi
}

internal class CapturingReplanEvents : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}

/** 트랜잭션 없이 그 자리에서 실행 — 단위 테스트는 결정론이 우선이다. */
internal val NOOP_TX: org.springframework.transaction.PlatformTransactionManager =
    object : org.springframework.transaction.PlatformTransactionManager {
        override fun getTransaction(definition: org.springframework.transaction.TransactionDefinition?) =
            org.springframework.transaction.support.SimpleTransactionStatus()
        override fun commit(status: org.springframework.transaction.TransactionStatus) = Unit
        override fun rollback(status: org.springframework.transaction.TransactionStatus) = Unit
    }
