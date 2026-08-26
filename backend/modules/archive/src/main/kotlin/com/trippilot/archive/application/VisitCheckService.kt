package com.trippilot.archive.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.archive.api.event.VisitChecked
import com.trippilot.archive.api.VisitConflictState
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 실적(C12 Travel Archive · LC-U4-6 승계). 계획을 덮어쓰지 않고 **별도 계층**으로 쌓는다.
 *
 * 이 서비스가 여는 것 셋:
 * - 재계획의 **잠금 대상**(INV-U4-04) — 이미 다녀온 곳의 시각을 바꾸면 사용자가 겪은 사실과 어긋난다
 * - `DELAY` 트리거의 **체류 초과 입력**(파생 dwell)
 * - 기준점 사다리의 **마지막 완료 방문지**(BR-U4-19)
 *
 * 뒤의 둘은 U4 가 쓰므로 [ArchiveFacade] 로 내보낸다 — 남의 모듈이 이 클래스를 직접 들면 R1 위반이고,
 * 여기서 U4 를 되부르면 순환이다(BR-U5-10).
 */
@Service
class VisitCheckService(
    private val trips: TripFacade,
    private val checks: VisitCheckRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) : ArchiveFacade {

    /** 도착 체크. 같은 슬롯에 이미 실적이 있으면 409 — 둘이면 "완료됐나"가 갈린다. */
    @Transactional
    fun arrive(accountId: UUID, tripId: UUID, slotKey: String?, poiId: UUID, source: CheckSource): VisitCheck {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val existing = slotKey?.let { checks.findBySlot(tripId, it) }
        if (existing != null) {
            // 지오펜스가 같은 wake 에서 두 번 깨워도(P-MOBILE-U4-1 중복 진입) 하나만 확정된다.
            //
            // 다만 **왜 거절하는지**를 갈라 실어야 한다(BR-U5-20). 오프라인 큐를 재생하다 같은 도착을
            // 다시 보낸 것이면 원하던 상태가 이미 서버에 있으니 클라이언트는 수렴하면 된다.
            // 같은 슬롯에 **다른 장소**가 기록돼 있으면 그건 사용자가 풀어야 할 충돌이다.
            val sameState = existing.poiId == poiId
            throw ConflictDetected(
                current = VisitConflictState(existing.visitCheckId, existing.updatedAt),
                message = if (sameState) "이미 체크된 방문지입니다." else "그 슬롯에는 다른 장소가 기록돼 있습니다.",
                errorCode = if (sameState) ErrorCode.VISIT_ALREADY_RECORDED else ErrorCode.VISIT_CONFLICT,
            )
        }
        return checks.save(VisitCheck.arrive(tripId, slotKey, poiId, source, clock.instant()))
    }

    /**
     * 방문 완료. 이 시점부터 그 슬롯은 재계획에서 불변이다(INV-U4-04).
     *
     * 완료를 알리는 것도 여기다(BR-U5-09). 발행은 **같은 트랜잭션 안**이라 실적과 이벤트가 함께 커밋된다 —
     * "이벤트는 나갔는데 방문 기록은 없다"가 원리적으로 불가능해진다. 반대(기록은 있고 배달이 늦다)는
     * 릴레이가 나중에 따라잡는다. 둘 중 감당할 수 있는 어긋남은 이쪽뿐이다.
     */
    @Transactional
    fun complete(accountId: UUID, tripId: UUID, visitCheckId: UUID): VisitCheck {
        val completed = checks.save(owned(accountId, tripId, visitCheckId).complete(clock.instant()))
        events.publish(
            VisitChecked(
                aggregateId = completed.visitCheckId.toString(),
                tripId = completed.tripId.toString(),
                slotKey = completed.slotKey,
                poiId = completed.poiId.toString(),
                // 완료됐다면 도착도 있다 — `complete()` 가 도착 없는 완료를 409 로 막는다.
                arrivedAt = completed.arrivedAt!!.toString(),
                completedAt = completed.completedAt?.toString(),
            ),
        )
        return completed
    }

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
        expectedUpdatedAt: Instant? = null,
    ): VisitCheck {
        val current = owned(accountId, tripId, visitCheckId)
        // BR-U5-22 — 충돌 판정 기준은 `updated_at` 이다. 로컬 편집이 서버의 현재 상태보다 이른 것을
        // 근거로 만들어졌으면, 그 편집을 그대로 반영하면 **서버가 이미 반영한 변경을 조용히 되돌린다.**
        // 기준을 보내지 않으면(단일 기기·온라인 편집) 검사하지 않는다 — 있던 경로를 막지 않기 위해서다.
        if (expectedUpdatedAt != null && current.updatedAt.isAfter(expectedUpdatedAt)) {
            throw ConflictDetected(
                current = VisitConflictState(current.visitCheckId, current.updatedAt),
                message = "그 사이 서버 기록이 바뀌었습니다.",
                errorCode = ErrorCode.VISIT_CONFLICT,
            )
        }
        return checks.save(current.adjustTimes(arrivedAt, completedAt, clock.instant()))
    }

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
    override fun getCompletedSlots(tripId: UUID): Set<String> =
        checks.findByTrip(tripId).filter { it.isCompleted }.mapNotNull { it.slotKey }.toSet()

    /** 기준점 사다리의 **마지막 완료 방문지**(BR-U4-19). 좌표는 호출 측이 POI 정본에서 얻는다. */
    @Transactional(readOnly = true)
    override fun findLastCompletedPoi(tripId: UUID): UUID? =
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
