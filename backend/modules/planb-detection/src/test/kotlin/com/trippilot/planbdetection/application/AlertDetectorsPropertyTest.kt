package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.application.AlertFixtures.DAY
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.planbdetection.domain.WeatherAlerts
import com.trippilot.planbdetection.domain.WeatherHazards
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeInstanceOf
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import java.time.LocalTime
import java.util.UUID

/**
 * 특보·대기질 감지기 PBT(블로킹 게이트 — PBT-SA-02·08·09·10·11 의 이 출처 몫).
 *
 * - **모름은 절대 확인이 아니다**(INV-SA-2 · PBT-SA-02·09 대칭): 날짜 전체 확인 ⇒ 볼 것이 없었거나(실외·미분류 슬롯 0) 원천을 읽었고
 *   그 날의 목적지를 다 알며, 모든 구역이 '안 걸림'이다(걸림도, 가릴 수 없음 — 모르는 이름·산지 권역 — 도 없다) / 모든 목적지의 두
 *   등급을 알고 보통 이하다. 원천 모름이면 확인이 없다.
 * - **신호의 모양**(PBT-SA-11): 특보는 늘 위험이고 변형은 걸린 특보의 종류에서 나온다. 대기질은 가장 나쁜 등급이 매우나쁨이면 위험,
 *   나쁨이면 주의이고 문구는 그 등급 원문을 따옴표에 그대로 싣는다(BR-SA-24). 영향 POI = 남은 실외 슬롯 전부(시작 순).
 * - **문구 가드**(PBT-SA-08): 임의 장소명(숫자·`365분식`·`4시30분왕족발`·따옴표·줄바꿈·초장문)으로도 가드를 통과하고 ≤ 200자다.
 * - **무관 입력**(PBT-SA-10): 슬롯 순서를 섞어도, 실내 슬롯을 더해도 판정이 같다.
 *
 * 오라클의 매칭은 `WeatherAlerts.match`·`destinationsOn` 이다 — 그 둘의 정답표는 `WeatherAlertsTest` 가 리터럴로 본다. 여기서 재는 것은
 * 감지기가 그것들을 어떻게 엮어 확인·모름·신호를 내는가다.
 */
class AlertDetectorsPropertyTest : StringSpec({

    "특보 — 확인이면 원천을 읽었고 그 날의 목적지를 다 알며 모든 구역이 '안 걸림'이다(무시 종류 제외 — 걸림도 모름도 없다)" {
        checkAll(warningCases) { c ->
            val got = KmaWarningDetector(c.alerts(), c.trips()).detect(c.target())
            if (got == CONFIRMED && c.needsLook) {
                withClue("원천 모름인데 확인") { c.read.shouldBeInstanceOf<AlertRead.Ok<*>>() }
                val days = WeatherAlerts.destinationsOn(c.refs, c.start, DAY)
                withClue("코드 없는 목적지가 있는데 확인") { days.all { it.regionCode != null } shouldBe true }
                val places = days.map { WeatherAlerts.placeOf(it.regionCode!!, it.name)!! }
                val open = (c.read as AlertRead.Ok).value.filter { w ->
                    w.type !in WeatherAlerts.IGNORED_WARNINGS &&
                        places.any { p -> w.areas.any { WeatherAlerts.match(it, p) != WeatherAlerts.Match.MISS } }
                }
                withClue("걸리거나 가릴 수 없는 특보가 있는데 확인 $open") { open shouldBe emptyList() }
            }
            if (c.read is AlertRead.Unknown && c.needsLook) withClue("원천 모름이면 모름") { got.shouldBeInstanceOf<Detection.Unknown>() }
        }
    }

    "특보 — 신호는 늘 위험 하나 · 변형은 걸린 특보 종류에서 · 영향 = 남은 실외 슬롯 전부 · 가드 통과 · ≤ 200자" {
        checkAll(warningCases) { c ->
            val got = KmaWarningDetector(c.alerts(), c.trips()).detect(c.target())
            val signals = (got as? Detection.Checked)?.signals.orEmpty()
            withClue("신호는 날짜당 하나") { (signals.size <= 1) shouldBe true }
            signals.forEach { s ->
                s.severity shouldBe TriggerSeverity.RISK
                val kinds = (c.read as AlertRead.Ok).value.map { it.type }.mapNotNull { WeatherAlerts.WARNING_VARIANTS[it] }
                withClue("변형 ${s.variant} 이 걸린 특보 종류 $kinds 에 없다") { (s.variant in kinds) shouldBe true }
                s.poiIds shouldBe c.outdoor.sortedWith(compareBy({ it.startAt }, { it.slotKey })).map { it.poiId }.distinct()
                withClue(s.reason) {
                    SituationCopy.violation(s.reason, c.slots.mapNotNull { it.nameKo }) shouldBe null
                    s.reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
                    s.reason shouldContain "기상청이 "
                }
            }
        }
    }

    "특보 — 슬롯 순서를 섞어도 · 실내 슬롯을 더해도 판정이 같다" {
        checkAll(warningCases, Arb.boolean()) { c, more ->
            val base = KmaWarningDetector(c.alerts(), c.trips()).detect(c.target())
            val shuffled = c.copy(slots = c.slots.reversed() + if (more && c.slots.isNotEmpty()) listOf(indoor()) else emptyList())
            KmaWarningDetector(shuffled.alerts(), shuffled.trips()).detect(shuffled.target()) shouldBe base
        }
    }

    "대기질 — 확인이면 원천을 읽었고 그 날 모든 목적지의 두 등급을 알며 둘 다 보통 이하다" {
        checkAll(airCases) { c ->
            val got = AirQualityDetector(c.alerts(), c.trips()).detect(c.target())
            if (got == CONFIRMED && c.needsLook) {
                withClue("원천 모름인데 확인") { c.read.shouldBeInstanceOf<AlertRead.Ok<*>>() }
                val grades = (c.read as AlertRead.Ok).value
                for (d in WeatherAlerts.destinationsOn(c.refs, c.start, DAY)) withClue("확인인데 $d 의 등급이 보통 이하로 확인되지 않았다") {
                    val g = d.regionCode?.let { AirRegion.of(it) }?.let { grades[it] }
                    (g != null && listOf(g.pm10, g.pm25).all { (WeatherAlerts.airRank(it) ?: 9) <= 1 }) shouldBe true
                }
            }
            if (c.read is AlertRead.Unknown && c.needsLook) withClue("원천 모름이면 모름") { got.shouldBeInstanceOf<Detection.Unknown>() }
        }
    }

    "대기질 — 가장 나쁜 등급이 매우나쁨이면 위험, 나쁨이면 주의 · 원문 등급을 따옴표에 그대로 · 가드 통과" {
        checkAll(airCases) { c ->
            val got = AirQualityDetector(c.alerts(), c.trips()).detect(c.target())
            val s = (got as? Detection.Checked)?.signals?.singleOrNull() ?: return@checkAll
            val grades = (c.read as AlertRead.Ok).value
            val worst = WeatherAlerts.destinationsOn(c.refs, c.start, DAY)
                .mapNotNull { d -> d.regionCode?.let { AirRegion.of(it) }?.let { grades[it] } }
                .flatMap { listOf(it.pm10, it.pm25) }.mapNotNull { WeatherAlerts.airRank(it) }.max()
            s.variant shouldBe TriggerVariant.DUST
            s.severity shouldBe if (worst == 3) TriggerSeverity.RISK else TriggerSeverity.CAUTION
            s.reason shouldContain if (worst == 3) "'매우나쁨'" else "'나쁨'"
            s.poiIds shouldBe c.outdoor.sortedWith(compareBy({ it.startAt }, { it.slotKey })).map { it.poiId }.distinct()
            withClue(s.reason) {
                SituationCopy.violation(s.reason, c.slots.mapNotNull { it.nameKo }) shouldBe null
                s.reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
            }
        }
    }

    "대기질 — 슬롯 순서를 섞어도 · 실내 슬롯을 더해도 판정이 같다" {
        checkAll(airCases, Arb.boolean()) { c, more ->
            val base = AirQualityDetector(c.alerts(), c.trips()).detect(c.target())
            val shuffled = c.copy(slots = c.slots.reversed() + if (more && c.slots.isNotEmpty()) listOf(indoor()) else emptyList())
            AirQualityDetector(shuffled.alerts(), shuffled.trips()).detect(shuffled.target()) shouldBe base
        }
    }
})

private val CONFIRMED = Detection.Checked(setOf(null), emptyList())

/** 한 판정의 재료 — 여행(시작·목적지) · 그 날 슬롯 · 원천 답. */
private data class Case<T>(
    val tripId: UUID,
    val start: java.time.LocalDate,
    val refs: List<TripDestinationRef>,
    val slots: List<PlannedSlotView>,
    val read: AlertRead<T>,
) {
    val outdoor: List<PlannedSlotView> get() = slots.filter { WeatherHazards.isOutdoor(it.category) }

    /** 원천을 볼 일이 있는가 — 실외·미분류 슬롯이 하나라도 있다. */
    val needsLook: Boolean get() = slots.any { WeatherHazards.isOutdoor(it.category) || it.category == null }

    fun trips() = FakeTripDestinations().put(tripId, start, start.plusDays(refs.sumOf { it.nights }.toLong()), *refs.toTypedArray())

    @Suppress("UNCHECKED_CAST")
    fun alerts() = FakeAlerts().also { f ->
        when (val v = (read as? AlertRead.Ok<*>)?.value) {
            is List<*> -> f.warnings = read as AlertRead<List<ActiveWarning>>
            is Map<*, *> -> f.airByDate[DAY] = read as AlertRead<Map<AirRegion, AirGrade>>
            else -> {
                f.warnings = read as AlertRead<List<ActiveWarning>>
                f.airByDate[DAY] = read as AlertRead<Map<AirRegion, AirGrade>>
            }
        }
    }

    fun target() = AlertFixtures.target(tripId, *slots.toTypedArray())
}

private val DESTINATIONS = listOf(
    TripDestinationRef("포항시", "47110", 1), TripDestinationRef("경주시", "47130", 1), TripDestinationRef("제주", "50", 1),
    TripDestinationRef("서귀포시", "50130", 1), TripDestinationRef("해운대구", "26350", 1), TripDestinationRef("강릉시", "51150", 1),
    TripDestinationRef("수원시", "41110", 1), TripDestinationRef("양주시", "41630", 1), TripDestinationRef("동구", "12210", 1),
    TripDestinationRef("목포시", "12110", 1), TripDestinationRef("인천광역시", "28", 1), TripDestinationRef("강화군", "28710", 1),
    TripDestinationRef("중구", null, 1), TripDestinationRef("경기도", "41", 1), TripDestinationRef("옹진군", "28720", 1),
    TripDestinationRef("서해구", "28275", 1), TripDestinationRef("평창군", "51760", 1), TripDestinationRef("여수시", "12130", 1),
    TripDestinationRef("기장군", "26710", 1),
)

private val AREAS = listOf(
    WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "경주동부")), WarningArea("울산"), WarningArea("울릉도.독도"),
    WarningArea("제주도", listOf("제주도산지", "제주도남부")), WarningArea("부산", listOf("부산동부")), WarningArea("서울"),
    WarningArea("강원도", listOf("강릉시평지", "강원북부산지")), WarningArea("경기도", listOf("남양주", "가평")), WarningArea("광주"),
    WarningArea("전라남도", listOf("목포", "여수")), WarningArea("인천", listOf("강화군", "옹진군"), excluding = true),
    WarningArea("동해중부안쪽먼바다"), WarningArea("제주도남쪽먼바다"), WarningArea("경기도", listOf("수원", "양주")),
    // 섬 구역 · 산지 권역 · 광역시 군 구역 · 표에 없는 이름(통합 이름 · 전각 괄호)
    WarningArea("서해5도"), WarningArea("추자도"), WarningArea("거문도.초도"), WarningArea("강원도", listOf("강원중부산지")),
    WarningArea("인천", listOf("옹진")), WarningArea("전남광주통합특별시", listOf("목포")), WarningArea("경상북도（포항）"),
)

private val TYPES = listOf("호우", "대설", "강풍", "태풍", "한파", "폭염", "황사", "풍랑", "폭풍해일", "건조", "지진해일")

/** 문구 가드가 장소명 때문에 신호를 버리면 안 되는 이름들(PBT-SA-08) + 이름 없음. */
private val NAMES = listOf(
    "호미곶", "365분식", "4시30분왕족발", "40시간 카페", "오늘의커피", "내일도 맑음 공원", "'따옴표' 해변", "줄\n바꿈 해변",
    "127.0276 전망대", "호".repeat(120), " ", null,
)

private val CATEGORIES = listOf("자연", "야경", "액티비티", "문화", "쇼핑", "맛집", null)

private val slots: Arb<List<PlannedSlotView>> = arbitrary {
    List(Arb.int(0..5).bind()) {
        val start = Arb.int(8..20).bind()
        AlertFixtures.slot(
            Arb.element(NAMES).bind(), Arb.element(CATEGORIES).bind(),
            LocalTime.of(start, 0).toString(), LocalTime.of(minOf(start + Arb.int(1..2).bind(), 23), 0).toString(),
        )
    }
}

private val trip: Arb<Pair<java.time.LocalDate, List<TripDestinationRef>>> = arbitrary {
    // 0박 목적지(당일치기 · 경유지)도 섞는다 — 지나가는 날에 든다(destinationsOn)
    val refs = Arb.list(Arb.element(DESTINATIONS), 1..3).bind().map { it.copy(nights = Arb.int(0..2).bind()) }
    DAY.minusDays(Arb.int(0..2).bind().toLong()) to refs
}

private val warningCases: Arb<Case<List<ActiveWarning>>> = arbitrary {
    val (start, refs) = trip.bind()
    val warnings = Arb.list(
        arbitrary { ActiveWarning(Arb.element(TYPES).bind(), Arb.element("주의보", "경보").bind(), Arb.list(Arb.element(AREAS), 1..3).bind()) },
        0..4,
    ).bind()
    val read: AlertRead<List<ActiveWarning>> = if (Arb.int(0..9).bind() == 0) AlertRead.Unknown("gateway:30") else AlertRead.Ok(warnings)
    Case(UUID.randomUUID(), start, refs, slots.bind(), read)
}

private val GRADES = listOf("좋음", "보통", "나쁨", "매우나쁨", "예보없음")

private val airCases: Arb<Case<Map<AirRegion, AirGrade>>> = arbitrary {
    val (start, refs) = trip.bind()
    val grades = AirRegion.entries.filter { Arb.int(0..4).bind() > 0 }.associateWith {
        AirGrade(Arb.element(GRADES).orNull(0.1).bind(), Arb.element(GRADES).orNull(0.1).bind())
    }
    val read: AlertRead<Map<AirRegion, AirGrade>> = if (Arb.int(0..9).bind() == 0) AlertRead.Unknown("unavailable") else AlertRead.Ok(grades)
    Case(UUID.randomUUID(), start, refs, slots.bind(), read)
}

private fun indoor() = AlertFixtures.slot("국립박물관", "문화", "10:00", "11:00")
