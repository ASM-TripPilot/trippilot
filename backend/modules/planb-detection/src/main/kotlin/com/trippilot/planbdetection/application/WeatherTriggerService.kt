package com.trippilot.planbdetection.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.trip.api.TripFacade
import com.trippilot.weathercontext.api.ContextFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 날씨 신호 생성(C9 · 정본 §2.1 신호원 매핑 · G-U4-2).
 *
 * **임계 판정은 C9 가 소유한다** — ai 도 클라이언트도 임계를 모른다(G-U4-2 · BR-U4-03). 그래서 강수확률을
 * 직접 읽어 여기서 자르고, 넘을 때만 신호를 만들어 [TriggerService] 의 억제·상한 판정에 넘긴다.
 * 다른 신호원(`DELAY`·`CLOSURE`)과 달리 **클라이언트가 보낼 것이 없다** — 신호원이 서버 쪽(기상청)이다.
 *
 * **조회 실패는 무발화다**(BR-U4-05 · INV-U4-09). [ContextFacade.precipProbabilityForTrigger] 의 null 은
 * "비가 안 온다"가 아니라 **"모른다"** 이므로, 임계와 비교하지 않고 그 자리에서 끝낸다. 만료 스냅숏으로
 * 발화하지 않는 것도 그쪽 계약이 이미 보장한다 — 여기서 다시 판단하지 않는다.
 */
@Service
class WeatherTriggerService(
    private val trips: TripFacade,
    private val context: ContextFacade,
    private val triggers: TriggerService,
    private val clock: Clock,
) {

    /**
     * 오늘 날씨를 확인해 필요하면 트리거를 만든다. 발화하지 않으면 **null** —
     * 비가 안 오는 것도, 조회를 못 한 것도, 억제된 것도 모두 여기서는 null 이다(호출자가 할 일이 같다).
     *
     * 억제·상한·남은 일정 판정은 [TriggerService.evaluate] 가 한다. 여기서는 **신호를 만들지 말지**만 정한다 —
     * 두 판정을 한곳에 합치면 "왜 알림이 없었나"를 되짚을 때 임계 때문인지 억제 때문인지 갈리지 않는다.
     */
    fun checkToday(accountId: UUID, tripId: UUID): PlanBTrigger? {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val now = clock.instant()

        // 격자 키로 여행 목적지명을 쓴다. 스키마가 "격자 좌표 또는 **지역 키**"를 허용하고(V2.19),
        // 좌표→격자 변환은 어댑터 소유다(WeatherPort). C9 는 좌표 출처가 없어(TripFacade·ItineraryFacade
        // 어느 쪽도 좌표를 주지 않는다) 좌표를 쓰려면 모듈 의존을 새로 늘려야 하는데, 표시 키 하나 때문에
        // 그러지 않는다. 실 벤더 어댑터가 붙으면 지역명→격자 매핑이 그 어댑터 안에서 필요해진다.
        //
        // **한계 — 다도시 여행이면 첫 목적지 날씨만 본다.** 시드 POI 가 다도시 이동 시나리오를 일부러
        // 지원하므로(제주+부산) 실재하는 경우다. 오늘 사용자가 어느 도시에 있는지는 일자별 거점(trip_base)이
        // 아는데 C9 는 그 모듈에 의존하지 않는다 — 거점으로 격자를 고르려면 경계를 하나 더 열어야 하고
        // 그건 이 칸의 범위가 아니다. 지금은 "여행지 날씨"의 근사로 두고, 어긋남이 실제로 문제가 되면 연다.
        val gridKey = ctx.destinations.firstOrNull()?.takeIf { it.isNotBlank() }
            ?: run {
                log.debug("여행에 목적지가 없어 날씨를 확인하지 않습니다. tripId={}", tripId)
                return null
            }

        val pop = context.precipProbabilityForTrigger(gridKey, now)
            ?: run {
                // 실패·만료는 **무발화**다. 임계와 비교하지 않는다 — null 을 0 으로 읽으면 "비 안 옴"이 되어
                // 없는 사실을 근거로 판단하게 된다(BR-U4-05 허위 알림 금지).
                log.debug("강수확률을 확인하지 못해 무발화합니다. tripId={} gridKey={}", tripId, gridKey)
                return null
            }

        if (pop < RAIN_THRESHOLD_PCT) return null // 조회는 됐고 비는 안 온다 — 신호 자체가 없다

        // 강수는 하루 전체에 걸린다 — 특정 슬롯을 짚을 근거가 없으므로 slotKey 는 null 이고 범위는 FULL_DAY 다
        // (BR-U4-31 예시 `날씨(비 예보 70%) · 실내로` 와 같은 결).
        return triggers.evaluate(
            accountId, tripId,
            DetectionSignal(
                kind = TriggerKind.WEATHER,
                affectedDate = LocalDate.ofInstant(now, TRAVEL_ZONE),
                slotKey = null,
                payload = mapOf("pop" to pop),
                reason = "비 예보 $pop%",
                scope = TriggerScope.FULL_DAY,
            ),
        )
    }

    private companion object {
        private val log = LoggerFactory.getLogger(WeatherTriggerService::class.java)

        /**
         * 강수확률 임계(G-U4-2 · US-PLANB-02 인셉션 값). 설정으로 뺄지는 NFR 단계 몫이라 상수로 둔다 —
         * 요청되지 않은 설정화를 미리 만들지 않는다.
         */
        private const val RAIN_THRESHOLD_PCT = 60

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜다(서버 UTC 아님) — [TriggerService] 와 같은 기준. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
