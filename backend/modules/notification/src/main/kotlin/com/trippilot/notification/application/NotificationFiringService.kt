package com.trippilot.notification.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.notification.domain.CopyBasis
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration

/** [NotificationFiringService.fire] 의 결과 — 로그·테스트가 "무엇이 일어났는지"를 구분해 볼 수 있게. */
enum class FireOutcome { FIRED, CANCELED_LATE, ALREADY_TAKEN, MUTED }

/**
 * 예약 한 건을 알림으로 옮긴다. 예약당 트랜잭션 하나 — 한 건이 실패해도 나머지 배치는 산다.
 */
@Service
class NotificationFiringService(
    private val schedules: NotificationScheduleRepository,
    private val notifications: NotificationRepository,
    private val toggles: NotificationToggleService,
    private val pushes: PushDispatchService,
    // 문구가 아직 그날 일정과 맞는지 발화 직전에 대조한다 — 문구는 적재 시점의 스냅숏이다.
    private val plans: ItineraryPlanFacade,
    private val clock: Clock,
) {
    @Transactional
    fun fire(schedule: NotificationSchedule): FireOutcome {
        val now = clock.instant()
        // INV-U6-09 — 지나 버린 예약은 발화하지 않고 닫는다.
        if (schedule.isTooLate(now, LATE_GRACE)) {
            schedules.markCanceled(schedule.scheduleId, now)
            return FireOutcome.CANCELED_LATE
        }
        // 조건부 쓰기가 곧 멱등이다 — 다중 인스턴스가 같은 행을 집어도 UPDATE 는 하나만 성공한다.
        // 표시를 먼저 하고 적재가 실패하면 같은 트랜잭션이라 둘 다 없던 일이 된다(다음 폴링이 다시 집는다).
        if (!schedules.markFired(schedule.scheduleId, now)) return FireOutcome.ALREADY_TAKEN
        // 사용자가 이 종류의 인앱 수신을 껐다(TRIP-548). 예약은 소비하되 알림함에는 쌓지 않는다 —
        // 예약을 남겨 두면 다음 폴링이 계속 집어 배치를 채운다.
        // `SYSTEM` 은 여기서 걸리지 않는다(INV-U6-03) — 보안·계정 알림은 끌 수 있는 것이 아니다.
        if (!toggles.allowsInApp(schedule.accountId, schedule.kind)) return FireOutcome.MUTED
        // 반환값을 버려도 되는 것은 [NotificationSchedule.toNotification] 이 `sourceEventId = null` 로
        // 만들기 때문이다 — UNIQUE 가 걸리지 않아 항상 삽입된다. 거기에 원천 이벤트를 싣게 되면
        // 여기서 false 를 받고도 FIRED 를 보고하게 되므로, 그때는 이 줄을 함께 고쳐야 한다.
        val matches = copyStillMatchesPlan(schedule)
        val notification = (if (matches) schedule else schedule.withoutCopy()).toNotification(now)
        notifications.appendIfAbsent(notification)
        // 사용자에게 **어떤 문구가 나갔는가** — AI 문구 / 상수 문구(채우지 못함) / 일정이 바뀌어 접음. 이 한 줄이 "학생 모델 문구가 실제로 몇 %
        // 나가는가"의 유일한 근거다(적재 로그는 만든 수일 뿐 나간 수가 아니다). 계정·여행은 싣지 않는다 — 건수를 세려는 줄이다.
        log.info("reminder.fire kind={} copy={}", schedule.kind, copySource(schedule, matches))
        // **적재가 먼저다**(INV-U6-02 · TRIP-549). 푸시가 실패해도 알림함 행은 남아 catch-up 이
        // 그것을 준다 — "누락 0"의 근거는 푸시가 아니라 이 행의 영속성이다.
        pushes.dispatch(notification)
        return FireOutcome.FIRED
    }

    private fun copySource(schedule: NotificationSchedule, matches: Boolean) = when {
        !schedule.hasCopy -> "CONSTANT"
        matches -> "AI"
        else -> "STALE"
    }

    /**
     * **문구가 아직 그날 일정과 맞는가.** 문구는 적재 시점의 그날 장소 이름·순서로 만들어져 저장되는데, 일정을 편집(직접·도우미)하거나
     * 이전 판으로 되돌려도 예약은 다시 적재되지 않는다 — 그러면 "성산일출봉에서 시작해요"가 이미 바뀐 일정의 아침 푸시에 그대로 나간다
     * (사용자에게 보이는 틀린 사실). 그래서 **발화 직전에** 지금 일정에서 같은 지문을 다시 계산해 다르면 상수 문구로 보낸다 — 참인 쪽이다.
     *
     * - 문구가 없으면 대조할 것이 없다(항상 참).
     * - 지문이 없는 문구(이 칸이 생기기 전에 붙은 것)는 대조할 근거가 없어 그대로 쓴다 — 곧 발화·재적재로 사라진다.
     * - 일정을 읽다 실패하면 **검증할 수 없으니 상수 문구**로 간다(밋밋해도 참이다).
     */
    private fun copyStillMatchesPlan(schedule: NotificationSchedule): Boolean {
        if (!schedule.hasCopy) return true
        val written = schedule.copyBasis ?: return true
        val current = runCatching {
            CopyBasis.of(plans.findPlannedPlaces(schedule.accountId, schedule.tripId)[schedule.subjectDate()].orEmpty().map { it.nameKo })
        }.getOrElse { e ->
            log.warn("리마인드 문구를 검증하려 일정을 읽다 실패했습니다 — 상수 문구로 보냅니다. tripId={}", schedule.tripId, e)
            return false
        }
        if (current == written) return true
        // 일정이 바뀌었다 — 문구가 말하는 장소가 더는 사실이 아니다. 정상 경로지만 한 번쯤은 보이게 남긴다(편집이 얼마나 잦은지의 근거).
        log.info("일정이 바뀌어 리마인드 문구를 쓰지 않고 상수 문구로 보냅니다. tripId={} kind={}", schedule.tripId, schedule.kind)
        return false
    }

    private companion object {
        private val log = LoggerFactory.getLogger(NotificationFiringService::class.java)

        /**
         * 늦게 집힌 것을 얼마까지 봐줄 것인가.
         *
         * 폴링 주기(기본 1분)보다는 넉넉해야 정상 발화가 취소되지 않고, 너무 길면 INV-U6-09 가 막으려던
         * "이미 지난 일정 알림"이 그 길이만큼 새어 나간다. `SLOT_PRE` 기본 리드타임이 30분이라
         * 10분이면 아직 20분의 여유가 남는다.
         */
        private val LATE_GRACE: Duration = Duration.ofMinutes(10)
    }
}
