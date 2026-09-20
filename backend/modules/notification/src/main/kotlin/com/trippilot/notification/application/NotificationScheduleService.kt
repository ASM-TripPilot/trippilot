package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripOwnerFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 리마인드 예약 적재·재계산(BR-U6-04 · INV-U6-08).
 *
 * 일정이 생성·재생성될 때마다 그 여행의 **미발화 예약을 통째로 다시 만든다.** 차이를 계산해 일부만 고치지
 * 않는 이유는, 어긋났을 때 드러나지 않기 때문이다 — 남은 한 줄이 지난 일정을 알린다.
 */
@Service
class NotificationScheduleService(
    private val trips: TripOwnerFacade,
    private val schedules: NotificationScheduleRepository,
    private val copies: ReminderCopyPort,
    // 문구의 재료 — 그 날 갈 곳의 이름. R1: api 퍼사드만 본다.
    private val plans: ItineraryPlanFacade,
    private val clock: Clock,
) {
    @Transactional
    fun reload(tripId: UUID) {
        val now = clock.instant()
        val trip = trips.findOwnedPeriod(tripId)
        if (trip == null) {
            // 소프트 삭제된 여행은 FK CASCADE 가 닿지 않는다 — 남겨 두면 없어진 여행의 알림이 울린다.
            schedules.replacePending(tripId, emptyList())
            log.info("여행이 없어 리마인드 예약을 비웠습니다. tripId={}", tripId)
            return
        }
        val planned = withCopies(tripId, trip, plan(tripId, trip, now))
        schedules.replacePending(tripId, planned)
        log.info(
            "리마인드 예약 {}건을 적재했습니다. tripId={} AI문구={}건",
            planned.size, tripId, planned.count { it.title != null },
        )
    }

    private fun plan(tripId: UUID, trip: OwnedTripPeriod, now: Instant): List<NotificationSchedule> {
        val rows = mutableListOf<NotificationSchedule>()
        rows += NotificationSchedule.pending(
            trip.accountId, tripId, NotificationKind.TRIP_PRE, fireAt(trip.startDate.minusDays(1)),
        )
        var day = trip.startDate
        while (!day.isAfter(trip.endDate)) {
            rows += NotificationSchedule.pending(
                trip.accountId, tripId, NotificationKind.TRIP_DAY, fireAt(day),
            )
            day = day.plusDays(1)
        }
        // 이미 지난 시각은 적지 않는다. 넣어 봐야 발화기가 곧바로 취소할 뿐이고(INV-U6-09),
        // 그동안 폴링 배치를 죽은 행으로 채운다. 여행 중에 일정을 다시 짜면 실제로 이 경로를 탄다.
        return rows.filter { it.fireAt.isAfter(now) }
    }

    /**
     * 받을 수 있으면 문구를 채운다(TRIP-836). **여기서 부르는 이유**: 적재는 아웃박스 릴레이(배경)에서
     * 돌아 사용자 대기에 안 걸린다. 발화 시점에 부르면 발화가 상대 지연에 묶이고 호출 수도 리마인드
     * 수만큼 늘어난다.
     *
     * **못 받으면 그대로 간다** — 예외를 잡지 않는 이유는 포트가 이미 빈 맵으로 낮추기 때문이고,
     * 그래도 여기서 한 번 더 감싸는 것은 **문구 때문에 예약 적재가 실패하면 리마인드가 통째로
     * 사라지기** 때문이다. 밋밋한 문구보다 그쪽이 훨씬 나쁘다(INV-4).
     */
    private fun withCopies(tripId: UUID, trip: OwnedTripPeriod, planned: List<NotificationSchedule>): List<NotificationSchedule> {
        if (!copies.enabled || planned.isEmpty()) return planned
        val received = runCatching {
            // 한 번만 묻는다 — 예약마다 부르면 여행 일수만큼 조회가 늘고, 그 사이 일정이 바뀌면
            // 같은 적재 안에서 날짜별로 다른 일정을 말하게 된다.
            val namesByDate = plans.findPlannedPlaceNames(trip.accountId, tripId)
            copies.copiesFor(
                tripTitle = null, // 여행 제목은 trip.api 가 아직 안 준다 — 상대는 선택 필드로 받는다
                items = planned.map {
                    val subject = subjectDate(it)
                    ReminderCopyRequest(
                        scheduleKey = it.scheduleId.toString(),
                        kind = it.kind,
                        date = subject,
                        slots = namesByDate[subject].orEmpty(),
                    )
                },
            )
        }.onFailure { log.warn("리마인드 문구를 받지 못했습니다 — 상수 문구로 갑니다.", it) }
            .getOrDefault(emptyMap())

        if (received.isEmpty()) return planned
        return planned.map { row ->
            received[row.scheduleId.toString()]
                ?.let { row.copy(title = it.title, body = it.body) }
                ?: row
        }
    }

    /**
     * **문구가 말하는 날**. 발화일과 다를 수 있다 — `TRIP_PRE` 는 D-1 에 울리면서 *"내일은 …"* 을
     * 말하므로 여행 첫날을 가리킨다. 발화일을 그대로 넘기면 아직 시작도 안 한 날의 일정을 묻게 되고,
     * 그 날은 슬롯이 없어 **재료가 비어 문구가 통째로 안 나온다**(어댑터가 빈 재료를 거른다).
     */
    private fun subjectDate(row: NotificationSchedule): LocalDate {
        val fired = row.fireAt.atZone(TRAVEL_ZONE).toLocalDate()
        return if (row.kind == NotificationKind.TRIP_PRE) fired.plusDays(1) else fired
    }

    private fun fireAt(date: LocalDate): Instant = date.atTime(REMIND_TIME).atZone(TRAVEL_ZONE).toInstant()

    private companion object {
        private val log = LoggerFactory.getLogger(NotificationScheduleService::class.java)

        /** 여행지 기준 시각. 사용자의 기기 시간대가 아니라 여행이 벌어지는 곳의 아침이어야 한다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /**
         * BR-U6-04 는 `TRIP_DAY` 를 "당일 오전 기본 8시"로 못박고 `TRIP_PRE` 는 "D-1" 까지만 정한다.
         * 사용자별 시각 설정은 O-U6-1 로 열려 있으므로, 둘 다 이 기본 시각을 쓴다 — 값을 둘로 나누면
         * 설정이 붙을 때 고칠 자리가 둘이 된다.
         */
        private val REMIND_TIME: LocalTime = LocalTime.of(8, 0)
    }
}
