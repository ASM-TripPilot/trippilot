package com.trippilot.notification.application

import com.trippilot.notification.domain.CopyBasis
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import com.trippilot.notification.domain.ReminderSlot
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripOwnerFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/** [NotificationScheduleService.fillMissing] 의 결과 — 재시도 사슬을 이어 갈지 정한다. */
sealed interface FillOutcome {
    /** 채울 행이 더는 없다(전부 문구가 있거나, 기능이 꺼져 있다). */
    data object Done : FillOutcome

    /** 여행이 없다 — 더 할 일이 없다. */
    data object Gone : FillOutcome

    /** 문구 없는 행이 [remaining] 건 남았다. [noMaterial] 은 그중 재료(그 날 일정)가 아직 없어 묻지도 못한 수. */
    data class Retry(val remaining: Int, val noMaterial: Int) : FillOutcome
}

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
    // 문구를 하나도 못 받은 적재를 몇 분 뒤 한 번 더 — 모델 콜드스타트 대응([ReminderCopyRetries]).
    private val retries: ReminderCopyRetries,
) {
    @Transactional
    fun reload(tripId: UUID) {
        // 같은 여행의 다른 적재(릴레이)와 겹치지 않게 — 겹치면 하루 리마인드가 두 벌이 된다.
        schedules.lockTrip(tripId)
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
            planned.size, tripId, planned.count { it.hasCopy },
        )
        if (copies.enabled && planned.any { !it.hasCopy }) {
            // 문구 없는 행이 남았다 — 모델이 안 떠 있었거나, 일부만 받았거나, 아직 일정이 안 만들어진 날이다.
            // 잠시 뒤 **제자리에서** 빠진 행만 다시 채운다([ReminderCopyRetries]).
            retries.later(tripId, now, attempt = 0)
            log.info("문구 없는 리마인드 예약이 남았습니다 — 잠시 뒤 빠진 행만 다시 채웁니다. tripId={}", tripId)
        }
    }

    /**
     * 가까운 시일([horizon] 안)에 울릴 예약 중 문구가 아직 없는 것이 있는 여행들 — 재시작으로 사라진 채움 대기열을 되살릴 입력.
     * 기능이 꺼져 있으면 채울 수 없으므로 비어 있다.
     */
    fun tripsLackingCopy(now: Instant, horizon: Duration, limit: Int): List<UUID> =
        if (copies.enabled) schedules.findTripsLackingCopy(now, now.plus(horizon), limit) else emptyList()

    /**
     * 문구가 **아직 없는** 미발화 예약만 골라 제자리에서 채운다 — 재시도 전용(TRIP-836 후속).
     *
     * [reload] 와 달리 **행을 지우고 다시 만들지 않는다.** 그래서 (1) 앞서 받은 문구를 잃지 않고 빠진 행만 메우며,
     * (2) 일부만 받은 적재도 안전하게 재시도할 수 있고, (3) 같은 여행의 적재와 겹쳐도 조건부 쓰기([attachCopy])라
     * 지워진 행엔 아무 일도 안 일어난다. 트랜잭션도 안 건다 — AI 호출이 DB 트랜잭션·잠금을 쥐고 기다리지 않는다.
     *
     * 재료(그 날 갈 곳)는 **지금 일정에서 다시 읽는다** — 적재 때 비어 있던 날(다일 여행은 1차 저장 직후라 2일차 이후가 비었다)이
     * 그 사이 생겼으면 이제 물을 수 있다. 재료가 아직 없는 행은 안 묻고 [FillOutcome.Retry] 의 `noMaterial` 로 센다 — 빈 재료로
     * 물으면 상대가 "일정 없음"을 지어낸다(어댑터가 거른다).
     */
    fun fillMissing(tripId: UUID): FillOutcome {
        if (!copies.enabled) return FillOutcome.Done
        val now = clock.instant()
        val trip = trips.findOwnedPeriod(tripId) ?: return FillOutcome.Gone
        // 이미 시각이 지난 행은 발화기가 곧 집는다 — 지금 채워도 의미가 없다.
        val lacking = schedules.findPendingByTrip(tripId).filter { it.fireAt.isAfter(now) && !it.hasCopy }
        if (lacking.isEmpty()) return FillOutcome.Done

        val placesByDate = plans.findPlannedPlaces(trip.accountId, tripId)
        val requests = lacking.map { requestOf(it, placesByDate) }
        val askable = requests.filter { it.slots.isNotEmpty() }
        val received = if (askable.isEmpty()) {
            emptyMap()
        } else {
            runCatching { copies.copiesFor(tripTitle = null, items = askable) }
                .onFailure { log.warn("리마인드 문구를 받지 못했습니다 — 다음 기회에 다시 묻습니다. tripId={}", tripId, it) }
                .getOrDefault(emptyMap())
        }
        // 우리 행 id 로만 찾는다 — 상대가 보낸 적 없는 키를 돌려줘도 엉뚱한 행에 붙지 않는다.
        val attached = lacking.count { row ->
            // 지문은 **물을 때 실은 재료**로 만든다 — 그 사이 일정이 바뀌었으면 발화가 어긋남을 알아본다.
            received[row.scheduleId.toString()]?.let {
                schedules.attachCopy(row.scheduleId, it.title, it.body, basisOf(row, placesByDate))
            } == true
        }
        val remaining = lacking.size - attached
        log.info(
            "리마인드 문구 채움 tripId={} 대상={}건 물음={}건 받음={}건 붙임={}건 남음={}건",
            tripId, lacking.size, askable.size, received.size, attached, remaining,
        )
        return if (remaining == 0) FillOutcome.Done else FillOutcome.Retry(remaining, noMaterial = requests.size - askable.size)
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
     * 사라지기** 때문이다. 밋밋한 문구보다 그쪽이 훨씬 나쁘다(INV-4). 못 받은 행은 [fillMissing] 이 나중에 메운다.
     */
    private fun withCopies(
        tripId: UUID,
        trip: OwnedTripPeriod,
        planned: List<NotificationSchedule>,
    ): List<NotificationSchedule> {
        if (!copies.enabled || planned.isEmpty()) return planned
        // 한 번만 묻는다 — 예약마다 부르면 여행 일수만큼 조회가 늘고, 그 사이 일정이 바뀌면
        // 같은 적재 안에서 날짜별로 다른 일정을 말하게 된다.
        var placesByDate: Map<LocalDate, List<PlannedPlaceView>> = emptyMap()
        val received = runCatching {
            placesByDate = plans.findPlannedPlaces(trip.accountId, tripId)
            // 여행 제목은 trip.api 가 아직 안 준다 — 상대는 선택 필드로 받는다
            copies.copiesFor(tripTitle = null, items = planned.map { requestOf(it, placesByDate) })
        }.onFailure { log.warn("리마인드 문구를 받지 못했습니다 — 상수 문구로 갑니다.", it) }
            .getOrDefault(emptyMap())

        if (received.isEmpty()) return planned
        return planned.map { row ->
            received[row.scheduleId.toString()]
                // 문구를 만들 때 본 그날 장소 목록의 지문을 같이 남긴다 — 발화가 지금 일정과 대조해 낡은 이름이 나가지 않게 한다.
                ?.let { row.copy(title = it.title, body = it.body, copyBasis = basisOf(row, placesByDate)) }
                ?: row
        }
    }

    /** 그날 장소 이름 목록의 지문 — 문구에 실리는 순서 그대로(요청의 slots 와 같은 소스다). */
    private fun basisOf(row: NotificationSchedule, placesByDate: Map<LocalDate, List<PlannedPlaceView>>): String =
        CopyBasis.of(placesByDate[row.subjectDate()].orEmpty().map { it.nameKo })

    private fun requestOf(row: NotificationSchedule, placesByDate: Map<LocalDate, List<PlannedPlaceView>>): ReminderCopyRequest {
        val subject = subjectDate(row)
        return ReminderCopyRequest(
            scheduleKey = row.scheduleId.toString(),
            kind = row.kind,
            date = subject,
            slots = placesByDate[subject].orEmpty().map { p -> ReminderSlot(p.nameKo, p.categoryCode) },
        )
    }

    /**
     * **문구가 말하는 날**. 발화일과 다를 수 있다 — `TRIP_PRE` 는 D-1 에 울리면서 *"내일은 …"* 을
     * 말하므로 여행 첫날을 가리킨다. 발화일을 그대로 넘기면 아직 시작도 안 한 날의 일정을 묻게 되고,
     * 그 날은 슬롯이 없어 **재료가 비어 문구가 통째로 안 나온다**(어댑터가 빈 재료를 거른다).
     */
    private fun subjectDate(row: NotificationSchedule): LocalDate = row.subjectDate()

    private fun fireAt(date: LocalDate): Instant = date.atTime(REMIND_TIME).atZone(TRAVEL_ZONE).toInstant()

    private companion object {
        private val log = LoggerFactory.getLogger(NotificationScheduleService::class.java)

        /** 여행지 기준 시각. 사용자의 기기 시간대가 아니라 여행이 벌어지는 곳의 아침이어야 한다. */
        private val TRAVEL_ZONE: ZoneId = NotificationSchedule.TRAVEL_ZONE

        /**
         * BR-U6-04 는 `TRIP_DAY` 를 "당일 오전 기본 8시"로 못박고 `TRIP_PRE` 는 "D-1" 까지만 정한다.
         * 사용자별 시각 설정은 O-U6-1 로 열려 있으므로, 둘 다 이 기본 시각을 쓴다 — 값을 둘로 나누면
         * 설정이 붙을 때 고칠 자리가 둘이 된다.
         */
        private val REMIND_TIME: LocalTime = LocalTime.of(8, 0)
    }
}
