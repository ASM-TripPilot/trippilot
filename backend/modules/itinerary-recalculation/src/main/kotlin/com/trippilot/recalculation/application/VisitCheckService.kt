package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.recalculation.domain.CheckSource
import com.trippilot.recalculation.domain.VisitCheck
import com.trippilot.recalculation.domain.VisitCheckRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 실적(LC-U4-6). 계획을 덮어쓰지 않고 **별도 계층**으로 쌓는다.
 *
 * 이 서비스가 여는 것 셋:
 * - 재계획의 **잠금 대상**(INV-U4-04) — 이미 다녀온 곳의 시각을 바꾸면 사용자가 겪은 사실과 어긋난다
 * - `DELAY` 트리거의 **체류 초과 입력**(파생 dwell)
 * - 기준점 사다리의 **마지막 완료 방문지**(BR-U4-19)
 *
 * ⚠ U5 C12 로 이관 예정이다(G-U4-5) — 사진·메모는 여기서 늘리지 않는다.
 */
@Service
class VisitCheckService(
    private val trips: TripFacade,
    private val checks: VisitCheckRepository,
    private val clock: Clock,
) {

    /** 도착 체크. 같은 슬롯에 이미 실적이 있으면 409 — 둘이면 "완료됐나"가 갈린다. */
    @Transactional
    fun arrive(accountId: UUID, tripId: UUID, slotKey: String?, poiId: UUID, source: CheckSource): VisitCheck {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        if (slotKey != null && checks.findBySlot(tripId, slotKey) != null) {
            // 지오펜스가 같은 wake 에서 두 번 깨워도(P-MOBILE-U4-1 중복 진입) 하나만 확정된다.
            throw ConflictDetected(message = "이미 체크된 방문지입니다.")
        }
        return checks.save(VisitCheck.arrive(tripId, slotKey, poiId, source, clock.instant()))
    }

    /** 방문 완료. 이 시점부터 그 슬롯은 재계획에서 불변이다(INV-U4-04). */
    @Transactional
    fun complete(accountId: UUID, tripId: UUID, visitCheckId: UUID): VisitCheck =
        checks.save(owned(accountId, tripId, visitCheckId).complete(clock.instant()))

    /** 건너뜀(취소, TRIP-118). 안 갔으므로 재계획에서 잠그지 않는다. */
    @Transactional
    fun skip(accountId: UUID, tripId: UUID, visitCheckId: UUID): VisitCheck =
        checks.save(owned(accountId, tripId, visitCheckId).skip(clock.instant()))

    /**
     * 실제 시각 보정(TRIP-118 — 자동 기록하되 수정 가능).
     * 기기 시각이 어긋났거나 체크를 늦게 눌렀을 때 바로잡는 경로다.
     */
    @Transactional
    fun adjustTimes(
        accountId: UUID,
        tripId: UUID,
        visitCheckId: UUID,
        arrivedAt: Instant?,
        completedAt: Instant?,
    ): VisitCheck =
        checks.save(owned(accountId, tripId, visitCheckId).adjustTimes(arrivedAt, completedAt, clock.instant()))

    @Transactional(readOnly = true)
    fun listByDay(accountId: UUID, tripId: UUID, day: LocalDate): List<VisitCheck> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 즉석 방문은 슬롯 키가 없어 날짜로 못 거른다 — 도착 시각(여행지 기준 날짜)으로 판단한다.
        return checks.findByTrip(tripId).filter { it.dayOf() == day }
    }

    /**
     * 재계획에서 **잠글 슬롯 키**(INV-U4-04). 완료된 것만 — 도착만 한 곳은 아직 떠날 수 있어
     * 시각을 조정할 여지가 있다.
     */
    @Transactional(readOnly = true)
    fun lockedSlotKeys(tripId: UUID): Set<String> =
        checks.findByTrip(tripId).filter { it.isCompleted }.mapNotNull { it.slotKey }.toSet()

    /** 기준점 사다리의 **마지막 완료 방문지**(BR-U4-19). 좌표는 호출 측이 POI 정본에서 얻는다. */
    @Transactional(readOnly = true)
    fun lastCompletedPoi(tripId: UUID): UUID? =
        checks.findByTrip(tripId).filter { it.isCompleted }.maxByOrNull { it.completedAt!! }?.poiId

    private fun owned(accountId: UUID, tripId: UUID, visitCheckId: UUID): VisitCheck {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 여행 범위로 좁혀 찾는다 — id 만으로 찾으면 남의 여행 실적을 건드릴 수 있다.
        return checks.findById(visitCheckId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("방문 기록을 찾을 수 없습니다.")
    }

    /** 그 방문이 속한 여행지 기준 날짜. 도착이 없으면 생성 시각으로 본다. */
    private fun VisitCheck.dayOf(): LocalDate =
        LocalDate.ofInstant(arrivedAt ?: createdAt, TRAVEL_ZONE)

    private companion object {
        private val TRAVEL_ZONE: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")
    }
}
