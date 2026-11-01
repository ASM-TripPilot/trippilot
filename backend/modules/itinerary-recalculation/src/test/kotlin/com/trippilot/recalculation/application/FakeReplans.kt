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

    /** 반영이 돌려줄 되돌리기 지점(TRIP-1412). 기본은 "반영 전엔 그 날이 비어 있었다". */
    var restorePoint: ReplanProposal? = null

    /** 되돌리기 호출 — (반영본, 되돌리기 지점, 사유). [revertFailWith] 로 C8 의 409(STALE)를 흉내 낸다. */
    val reverted = mutableListOf<Triple<ReplanProposal, ReplanProposal, String>>()
    var revertFailWith: RuntimeException? = null

    /** 되돌리기가 받은 실적 읽기를 실제로 불러 본 값 — C10 이 넘기는 집합이 맞는지 본다(판정 자체는 C8 스펙). */
    val visitedSeen = mutableListOf<Set<String>>()

    /** 잠금을 잡는 순간에 끼워 넣을 일 — "잠금 전 읽기와 잠금 뒤 읽기 사이에 커밋된 쓰기"를 흉내 낸다. */
    var onLock: () -> Unit = {}

    override fun apply(accountId: UUID, tripId: UUID, proposal: ReplanProposal, reason: String, afterLock: () -> Unit): ReplanProposal {
        onLock()
        afterLock()
        applied += proposal
        appliedReasons += reason
        return restorePoint ?: proposal.copy(slots = emptyList())
    }

    override fun revert(
        accountId: UUID, tripId: UUID, applied: ReplanProposal, restore: ReplanProposal, reason: String,
        visitedSlotKeys: () -> Set<String>,
    ) {
        visitedSeen += visitedSlotKeys()
        revertFailWith?.let { throw it }
        reverted += Triple(applied, restore, reason)
    }

    companion object {
        val ITINERARY_ID: UUID = UUID.fromString("11111111-1111-4111-8111-111111111111")

        fun sampleProposal(date: LocalDate = LocalDate.parse("2026-08-11")) = ReplanProposal(
            ITINERARY_ID, date,
            listOf(
                ReplanSlot(
                    UUID.randomUUID(), LocalTime.parse("14:00"), LocalTime.parse("15:00"),
                    isFixed = false, endsNextDay = false, distanceRange = "약 1.2km", placementReason = "실내라 비를 피할 수 있어요",
                    hasViolation = false, violationReason = null,
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
    /** 다녀온(도착·완료) 슬롯 — 주지 않으면 완료분과 같다(완료는 도착을 거친다). */
    private val visitedSlots: Set<String> = completedSlots,
    /** 날짜별로 건너뛴 POI — 날짜 가름(슬롯 키의 날짜)은 archive 스펙이 보고, 여기서는 "어느 날짜로 물었나"만 드러낸다. */
    private val skippedPois: Map<LocalDate, Set<UUID>> = emptyMap(),
) : ArchiveFacade {
    override fun getCompletedSlots(tripId: UUID) = completedSlots
    override fun getVisitedSlots(tripId: UUID) = visitedSlots
    override fun getSkippedPois(tripId: UUID, date: LocalDate) = skippedPois[date].orEmpty()
    override fun findLastCompletedPoi(tripId: UUID) = lastCompletedPoi
    override fun isAutomationArmed(tripId: UUID, at: java.time.Instant) = false
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
