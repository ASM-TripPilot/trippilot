package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
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
        val planned = plan(tripId, trip, now)
        schedules.replacePending(tripId, planned)
        log.info("리마인드 예약 {}건을 적재했습니다. tripId={}", planned.size, tripId)
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
