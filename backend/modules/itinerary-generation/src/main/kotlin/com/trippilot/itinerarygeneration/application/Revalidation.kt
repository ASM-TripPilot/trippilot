package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import org.slf4j.LoggerFactory
import java.time.LocalDate
import java.util.UUID

/**
 * 편집·되돌리기의 **재검증 결과**. AI 가 답을 못 주는 경우를 "위반 없음"과 구분하려고 타입으로 둔다.
 *
 * 편집은 사용자의 의도라 AI 가 죽었다고 막지 않는다(그러면 AI 장애가 곧 편집 불가가 된다).
 * 그렇다고 빈 목록으로 넘기면 **"검증했더니 깨끗하다"는 거짓말**이 되어, 화면에서 위반 배지가 조용히 꺼진다
 * (INV-2 는 검증되지 않은 값을 확정된 것처럼 보이지 말라고 정한다).
 *
 * 그래서 판정을 못 했으면 [Withheld] — 직전에 표시하던 위반을 그대로 잇는다. 새로 생긴 슬롯은 이력이 없어
 * 표시가 없지만, 이는 원래 기본값이라 새 거짓을 만들지 않는다.
 */
internal sealed interface Revalidation {

    /** AI 가 판정했다. 목록이 비었으면 진짜로 위반이 없는 것이다. */
    data class Judged(val violations: List<Violation>) : Revalidation

    /** AI 를 못 불렀다(장애·시한). 아무것도 주장하지 않는다. */
    data object Withheld : Revalidation

    companion object {
        private val log = LoggerFactory.getLogger(Revalidation::class.java)

        /**
         * 재검증을 시도하고 실패는 [Withheld] 로 접는다. 침묵 금지(INV-4) — 실패는 반드시 로그로 드러낸다.
         * 외부 호출이라 **트랜잭션 밖**에서 부른다(DB 커넥션을 물지 않게, generate 와 동일).
         */
        fun attempt(agent: ScheduleAgentPort, output: ScheduleAgentOutput, tripId: UUID): Revalidation =
            runCatching { Judged(agent.validate(output)) }
                .getOrElse { e ->
                    log.warn(
                        "일정 재검증 실패 — 직전 위반 표시를 유지한 채 진행합니다(판정 보류). tripId={}",
                        tripId, e,
                    )
                    Withheld
                }

        /** 판정된 위반만. 보류면 빈 목록(경고·집계 대상이 아니다). */
        fun Revalidation.violations(): List<Violation> = when (this) {
            is Judged -> violations
            Withheld -> emptyList()
        }
    }
}

/**
 * 직전 일정의 위반 표시를 (날짜, poiId) 로 찾아 잇기 위한 색인.
 * poiId 만으로 묶으면 같은 장소가 여러 날 있을 때 뭉개진다(복원 쪽 고정 블록 색인과 같은 이유).
 */
internal class PriorViolations(previous: Itinerary) {
    private val bySlot: Map<Pair<LocalDate, UUID>, VisitSlot> =
        previous.days.flatMap { d -> d.slots.map { (d.date to it.sourcePoiId) to it } }.toMap()

    fun flagOf(date: LocalDate, poiId: UUID): Boolean = bySlot[date to poiId]?.hasViolation ?: false

    fun reasonOf(date: LocalDate, poiId: UUID): String? = bySlot[date to poiId]?.violationReason
}
