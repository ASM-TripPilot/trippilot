package com.trippilot.planbdetection.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.weathercontext.api.ContextFacade
import com.trippilot.weathercontext.api.WeatherReading
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 날씨 신호 생성(C9 · G-U4-2).
 *
 * 여기서 지키는 것은 둘이다.
 * 1. **임계를 서버가 가진다** — 클라이언트도 ai 도 60%를 모른다. 이 판정이 여기 없으면 임계가 화면으로 샌다.
 * 2. **"모른다"를 "비 안 옴"으로 읽지 않는다** — 조회 실패에 0 을 대입하면 임계 비교가 통과해 버리고,
 *    없는 사실을 근거로 알림을 만들지 않는다는 원칙(INV-U4-09)이 조용히 깨진다.
 */
class WeatherTriggerServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val itineraryId = UUID.randomUUID()
    // KST 정오 — 여행 "오늘"이 UTC 와 어긋나지 않는 시각을 고른다.
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-11T03:00:00Z"), ZoneOffset.UTC)
    val today = LocalDate.parse("2026-08-11")
    val slotA = "$today#${UUID.randomUUID()}"

    class Triggers : PlanBTriggerRepository {
        val stored = mutableListOf<PlanBTrigger>()
        override fun save(trigger: PlanBTrigger) = trigger.also { stored += it }
        override fun findById(triggerId: UUID) = stored.firstOrNull { it.triggerId == triggerId }
        override fun findActiveByTrip(tripId: UUID) =
            stored.filter { it.tripId == tripId && it.state == TriggerState.ACTIVE }
        override fun countActivatedOn(tripId: UUID, date: LocalDate) = stored.count { it.shouldReplan }
    }

    fun trips(destinations: List<String> = listOf("제주")) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(today.minusDays(1), today.plusDays(1)) else null

        override fun findGenerationContext(accountId: UUID, tripId: UUID) =
            if (accountId == acc) {
                TripGenerationContext(today.minusDays(1), today.plusDays(1), destinations, "친구", null, emptyList())
            } else {
                null
            }
    }

    val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(today), listOf(slotA))
    }

    /** [pop] 이 null 이면 "확인하지 못했다" — 조회 실패·만료를 퍼사드가 이미 그렇게 접어 준다. */
    class Weather(private val pop: Int?) : ContextFacade {
        val askedGridKeys = mutableListOf<String>()
        override fun precipProbabilityForTrigger(gridKey: String, at: Instant): Int? {
            askedGridKeys += gridKey
            return pop
        }

        override fun readingForDisplay(gridKey: String, at: Instant): WeatherReading? = null
    }

    fun service(weather: Weather, triggers: Triggers, destinations: List<String> = listOf("제주")): WeatherTriggerService {
        val trips = trips(destinations)
        val inner = TriggerService(
            trips, itineraries, triggers,
            object : SuppressionRepository {
                val stored = mutableListOf<Suppression>()
                override fun save(suppression: Suppression) = suppression.also { stored += it }
                override fun findByTrip(tripId: UUID) = stored.toList()
            },
            object : SensitivityRepository {
                override fun of(accountId: UUID) = Sensitivity.NORMAL

                /** 이 대역은 읽기만 흉내 낸다 — 쓰기는 이 테스트의 관심이 아니다. */
                override fun set(accountId: UUID, sensitivity: Sensitivity) = error("쓰기를 쓰지 않는 대역입니다.")
            },
            NoEvents,
            clock,
        )
        return WeatherTriggerService(trips, weather, inner, clock)
    }

    "임계를 넘으면 발화한다 — 하루 전체 범위" {
        val triggers = Triggers()
        val fired = service(Weather(pop = 70), triggers).checkToday(acc, tripId)

        fired.shouldNotBeNullAnd {
            it.kind shouldBe TriggerKind.WEATHER
            it.shouldReplan shouldBe true
            // 강수는 특정 슬롯을 짚을 근거가 없다 — 날짜 전체다.
            it.slotKey.shouldBeNull()
            it.scope shouldBe TriggerScope.FULL_DAY
            it.reason shouldBe "비 예보 70%"
            it.payload["pop"] shouldBe 70
        }
    }

    // 경계값을 박아 둔다 — 임계가 조용히 바뀌면 알림 양이 통째로 달라진다.
    "정확히 60% 면 발화하고 59% 면 발화하지 않는다" {
        service(Weather(pop = 60), Triggers()).checkToday(acc, tripId)?.kind shouldBe TriggerKind.WEATHER
        service(Weather(pop = 59), Triggers()).checkToday(acc, tripId).shouldBeNull()
    }

    /**
     * 이 테스트가 이 클래스의 핵심이다. null 은 **숫자로 바꿔 비교하는 순간 틀린다** — 어떤 기본값을 넣든
     * "확인하지 못했다"가 "확인해 보니 이렇더라"로 바뀐다. 특히 위쪽으로 접으면(예: 100) 없는 예보로
     * 알림이 나가고, 아래로 접으면(예: 0) "비 안 옴"이라는 없는 사실이 기록된다.
     * 그래서 비교 이전에 끝낸다(INV-U4-09 · BR-U4-05).
     */
    "확인하지 못하면 무발화 — 행조차 만들지 않는다" {
        val triggers = Triggers()

        service(Weather(pop = null), triggers).checkToday(acc, tripId).shouldBeNull()

        // 억제·무영향과 달리 여기는 판정 자체가 없었다 — 관측 기록도 남기지 않는다(신호가 없다).
        triggers.stored shouldBe emptyList()
    }

    "임계 미만이면 신호를 만들지 않는다 — 억제 판정까지 가지 않는다" {
        val triggers = Triggers()

        service(Weather(pop = 10), triggers).checkToday(acc, tripId).shouldBeNull()

        triggers.stored shouldBe emptyList()
    }

    "격자 키로 여행 목적지를 쓴다" {
        val weather = Weather(pop = 70)
        service(weather, Triggers(), destinations = listOf("부산", "제주")).checkToday(acc, tripId)

        weather.askedGridKeys shouldBe listOf("부산")
    }

    // 목적지가 없으면 어디 날씨를 물어야 할지 정할 수 없다 — 아무 격자나 고르면 엉뚱한 지역으로 알린다.
    "목적지가 없으면 묻지 않는다" {
        val weather = Weather(pop = 70)

        service(weather, Triggers(), destinations = emptyList()).checkToday(acc, tripId).shouldBeNull()

        weather.askedGridKeys shouldBe emptyList()
    }

    "타 계정이면 404 — 존재를 숨긴다" {
        shouldThrow<ResourceNotFound> {
            service(Weather(pop = 70), Triggers()).checkToday(UUID.randomUUID(), tripId)
        }
    }
})

/** null 이면 실패시키고, 아니면 블록을 돌린다 — 단언이 여러 줄일 때 읽기 쉽다. */
private fun <T : Any> T?.shouldNotBeNullAnd(block: (T) -> Unit) {
    this ?: error("발화를 기대했는데 null 입니다.")
    block(this)
}
