package com.trippilot.planbdetection.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.weathercontext.api.HourlyForecastFacade
import com.trippilot.weathercontext.api.HourlyForecastUnavailable
import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.PointForecast
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.Collections
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 단기예보 감지기(SituationDetector `kma-forecast` · 설계서 §4.2 · BR-SA-15) — 슬롯 좌표의 격자 예보로 (여행, 날짜) 하나를 본다.
 *
 * 판정 규칙의 경계는 [com.trippilot.planbdetection.domain.WeatherHazardsTest] 가 본다. 여기서는 감지기의 몫 —
 * 신호의 모양(대표·심각도·범위·출처·payload·문구), 실패의 갈래(게이트웨이·장애·자료 없음·좌표 없음), 회차 범위 기억을 본다.
 * 퍼사드 대역은 실물처럼 고장을 예외로 낸다(대역에 방어를 더하지 않는다).
 */
class KmaForecastDetectorTest : StringSpec({

    "출처는 kma-forecast · 종류는 WEATHER · 모든 회차를 본다 · live 는 격자 예보를 따른다" {
        val forecasts = FakeForecasts()
        val detector = KmaForecastDetector(forecasts)

        detector.source shouldBe SweepSource.KMA_FORECAST
        detector.kind shouldBe TriggerKind.WEATHER
        SweepPhase.entries.forEach { phase -> (0..1).forEach { detector.wants(phase, it) shouldBe true } }
        detector.isLive() shouldBe true
        forecasts.live = false
        detector.isLive() shouldBe false
    }

    "남은 실외 슬롯이 없으면 확인(날짜 전체)이고 예보를 부르지 않는다 — 실내·중립만 남은 날" {
        val forecasts = FakeForecasts()

        val got = KmaForecastDetector(forecasts).detect(target(slot("국립제주박물관", "문화", "14:00", "16:00", JEJU), slot("동문시장", "쇼핑", "17:00", "18:00", JEJU)))

        got shouldBe Detection.Checked(setOf(null), emptyList())
        forecasts.calls.shouldBeEmpty()
    }

    /** 카테고리가 없는 슬롯 = 표면이 없다(이름·좌표도 없다) — 실외인지 모르므로 그 날을 확인하지 않는다(INV-SA-2). */
    "카테고리를 모르는 슬롯이 남으면 확인하지 않는다 — 실외가 없어도 모름, 다른 슬롯의 신호는 낸다" {
        val forecasts = FakeForecasts().answer(JEJU, weather { _, w -> w })
        val detector = KmaForecastDetector(forecasts)
        val ghost = slot(null, null, "17:00", "18:00", null)

        detector.detect(target(slot("국립제주박물관", "문화", "14:00", "16:00", JEJU), ghost)) shouldBe Detection.Unknown("forecast-unknown")
        forecasts.calls.shouldBeEmpty()
        detector.detect(target(slot("우도", "자연", "14:00", "16:00", JEJU), ghost)) shouldBe Detection.Unknown("forecast-unknown")

        val rainy = KmaForecastDetector(FakeForecasts().answer(JEJU, rainAt(14..16))).detect(target(slot("우도", "자연", "14:00", "16:00", JEJU), ghost))
        (rainy as Detection.Checked).signals.single().variant shouldBe TriggerVariant.RAIN
    }

    /**
     * 문구의 이름·곳 수는 **대표 변형으로 걸린 슬롯**만 센다 — 13시 폭염(주의)에 걸린 성산일출봉은 비 영향이 아니다.
     * 선계산 재료(payload slotKeys · poiIds · coverage)는 영향 슬롯 전부를 그대로 싣는다.
     */
    "문구의 이름·곳 수는 대표 변형으로 걸린 슬롯만 — payload·영향 POI 는 걸린 슬롯 전부" {
        val f = weather(MORNING_BASE) { h, w ->
            when (h.hour) {
                13 -> w.copy(tmp = 33.5)
                16 -> w.copy(pop = 80, precipitation = Precipitation.RAIN)
                else -> w
            }
        }
        val hot = slot("성산일출봉", "자연", "13:00", "14:00", JEJU)
        val wet = slot("우도", "자연", "16:00", "17:00", JEJU)

        val s = (KmaForecastDetector(FakeForecasts().answer(JEJU, f)).detect(target(hot, wet, now = kst("2026-10-20T07:20"))) as Detection.Checked)
            .signals.single()

        s.variant shouldBe TriggerVariant.RAIN
        s.reason shouldBe "오후에 비 소식이 있어요. 우도 일정이 영향을 받을 수 있어요."
        s.payload["variants"] shouldBe listOf("RAIN", "HEAT")
        s.payload["slotKeys"] shouldBe listOf(hot.slotKey, wet.slotKey)
        s.payload["coverage"] shouldBe "MOST"
        s.poiIds shouldBe listOf(hot.poiId, wet.poiId)
    }

    /** 정본 문구 예(BR-SA-12 · 설계서 §4.2) 그대로 — 오늘은 날짜어 없이, 범위는 PARTIAL_SLOTS(CD7). */
    "오늘 오후 비 — 신호 하나(날짜 전체) · 위험 · RAIN · 정본 문구 · 출처 · 영향 POI · payload" {
        val forecasts = FakeForecasts().answer(JEJU, rainAt(14..16))
        val seongsan = slot("성산일출봉", "자연", "14:00", "16:00", JEJU)

        val got = KmaForecastDetector(forecasts).detect(target(seongsan)).shouldBeInstanceOf<Detection.Checked>()

        got.checked.shouldBeEmpty()
        val s = got.signals.single()
        s.kind shouldBe TriggerKind.WEATHER
        s.affectedDate shouldBe DAY
        s.slotKey shouldBe null
        s.scope shouldBe TriggerScope.PARTIAL_SLOTS
        s.severity shouldBe TriggerSeverity.RISK
        s.variant shouldBe TriggerVariant.RAIN
        s.dataSource shouldBe DataSource.KMA_VILAGE
        s.poiIds shouldBe listOf(seongsan.poiId)
        s.reason shouldBe "오후에 비 소식이 있어요. 성산일출봉 일정이 영향을 받을 수 있어요."
        s.payload shouldBe mapOf(
            "variants" to listOf("RAIN"), "coverage" to "MOST", "slotKeys" to listOf(seongsan.slotKey),
            "baseAt" to "2026-10-20T11:00+09:00", "popMax" to 80,
        )
    }

    "저녁 회차의 내일 비 두 곳 — 'M월 d일(E)' 머리 · '등 야외 일정 N곳' · FULL_DAY · 시작 순 대표 이름" {
        val forecasts = FakeForecasts().answer(JEJU, rainAt(9..11, base = PREV_EVENING_BASE)).answer(UDO, rainAt(9..11, base = PREV_EVENING_BASE))
        val seongsan = slot("성산일출봉", "액티비티", "10:00", "12:00", JEJU)
        val udo = slot("우도", "자연", "09:00", "11:00", UDO)

        val got = KmaForecastDetector(forecasts).detect(target(seongsan, udo, now = kst("2026-10-19T20:20"), round = kst("2026-10-19T20:15")))

        val s = (got as Detection.Checked).signals.single()
        s.reason shouldBe "10월 20일(화) 오전에 비 소식이 있어요. 우도 등 야외 일정 2곳이 영향을 받을 수 있어요."
        s.scope shouldBe TriggerScope.FULL_DAY
        s.poiIds shouldBe listOf(udo.poiId, seongsan.poiId)
        s.payload["slotKeys"] shouldBe listOf(udo.slotKey, seongsan.slotKey)
    }

    "변형마다 문구 — 시간대·기온·흐림, 전부 문구 가드를 지나고 특보 이름을 쓰지 않는다" {
        val cases = listOf(
            Triple(slot("한라산", "자연", "09:00", "11:00", JEJU), weather(MORNING_BASE) { h, w -> if (h.hour in 9..11) w.copy(precipitation = Precipitation.SNOW) else w },
                "오전에 눈 소식이 있어요. 한라산 일정이 영향을 받을 수 있어요."),
            Triple(slot("우도", "자연", "14:00", "15:00", JEJU), weather(MORNING_BASE) { _, w -> w.copy(wsd = 15.5) },
                "오후에 바람이 강하게 불 것으로 보여요. 우도 일정이 영향을 받을 수 있어요."),
            Triple(slot("서울숲", "자연", "13:00", "15:00", JEJU), weather(MORNING_BASE) { _, w -> w.copy(tmp = 35.4) },
                "한낮 기온이 35도 안팎까지 올라요. 서울숲 일정이 영향을 받을 수 있어요."),
            Triple(slot("남이섬", "자연", "14:00", "15:00", JEJU), weather(MORNING_BASE) { _, w -> w.copy(tmp = -12.6) },
                "기온이 영하 13도 안팎까지 내려가요. 남이섬 일정이 영향을 받을 수 있어요."),
            Triple(slot("남산서울타워", "야경", "18:00", "20:00", JEJU), weather(MORNING_BASE) { _, w -> w.copy(sky = Sky.OVERCAST) },
                "저녁에 하늘이 흐려 야경이 잘 보이지 않을 수 있어요. 남산서울타워 일정이 영향을 받을 수 있어요."),
            Triple(slot("밤바다", "야경", "21:00", "23:00", JEJU), weather(MORNING_BASE) { _, w -> w.copy(precipitation = Precipitation.SHOWER) },
                "밤에 비 소식이 있어요. 밤바다 일정이 영향을 받을 수 있어요."),
        )
        for ((s, f, expected) in cases) {
            val reason = (KmaForecastDetector(FakeForecasts().answer(JEJU, f)).detect(target(s, now = kst("2026-10-20T07:20"))) as Detection.Checked)
                .signals.single().reason
            reason shouldBe expected
            SituationCopy.violation(reason, listOfNotNull(s.nameKo)) shouldBe null
            reason shouldNotContain "주의보"
            reason shouldNotContain "경보"
        }
    }

    "주의 변형(흐림)은 주의 심각도로 내고, 시간대가 둘에 걸치면 시간대를 뺀다 · 이름이 없으면 '야경 일정 한 곳'" {
        val f = weather(MORNING_BASE) { _, w -> w.copy(sky = Sky.OVERCAST) }
        val s = slot(null, "야경", "19:00", "21:00", JEJU)

        val signal = (KmaForecastDetector(FakeForecasts().answer(JEJU, f)).detect(target(s, now = kst("2026-10-20T07:20"))) as Detection.Checked).signals.single()

        signal.severity shouldBe TriggerSeverity.CAUTION
        signal.variant shouldBe TriggerVariant.CLOUD
        signal.reason shouldBe "하늘이 흐려 야경이 잘 보이지 않을 수 있어요. 야경 일정 한 곳이 영향을 받을 수 있어요."
    }

    "이름 없는 슬롯이 대표면 '야외 일정 N곳' · 빈 이름도 이름이 아니다" {
        val forecasts = FakeForecasts().answer(JEJU, rainAt(14..16))
        val first = slot(null, "자연", "14:00", "15:00", JEJU)
        val second = slot("우도", "자연", "15:00", "16:00", JEJU)

        val two = (KmaForecastDetector(forecasts).detect(target(first, second)) as Detection.Checked).signals.single()
        val blank = (KmaForecastDetector(forecasts).detect(target(slot(" ", "자연", "14:00", "15:00", JEJU))) as Detection.Checked).signals.single()

        two.reason shouldBe "오후에 비 소식이 있어요. 야외 일정 2곳이 영향을 받을 수 있어요."
        blank.reason shouldBe "오후에 비 소식이 있어요. 야외 일정 한 곳이 영향을 받을 수 있어요."
    }

    "live 가 아니면(격자 키를 못 정하면) 부르지 않고 모름이다" {
        val forecasts = FakeForecasts().answer(JEJU, rainAt(14..16)).also { it.live = false }

        KmaForecastDetector(forecasts).detect(target(slot("우도", "자연", "14:00", "16:00", JEJU))).shouldBeInstanceOf<Detection.Unknown>()
        forecasts.calls.shouldBeEmpty()
    }

    "이름이 길어 200자를 넘기면 이름 없이 쓴다 — 가드에 걸려 신호를 통째로 잃지 않게" {
        val long = "제주".repeat(90)
        val s = slot(long, "자연", "14:00", "16:00", JEJU)

        val reason = (KmaForecastDetector(FakeForecasts().answer(JEJU, rainAt(14..16))).detect(target(s)) as Detection.Checked).signals.single().reason

        reason shouldBe "오후에 비 소식이 있어요. 야외 일정 한 곳이 영향을 받을 수 있어요."
        reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
    }

    "해제 임계 아래로 다 확인되면 날짜 전체 확인 · 두 임계 사이면 신호도 확인도 없다" {
        val calm = KmaForecastDetector(FakeForecasts().answer(JEJU, weather { _, w -> w })).detect(target(slot("우도", "자연", "14:00", "16:00", JEJU)))
        calm shouldBe Detection.Checked(setOf(null), emptyList())

        val between = KmaForecastDetector(FakeForecasts().answer(JEJU, weather { _, w -> w.copy(pop = 55) })).detect(target(slot("우도", "자연", "14:00", "16:00", JEJU)))
        between shouldBe Detection.Checked(emptySet(), emptyList())
    }

    "한 대상 안에서 같은 격자는 한 번만 묻는다" {
        val forecasts = FakeForecasts().answer(JEJU, weather { _, w -> w })

        KmaForecastDetector(forecasts).detect(target(slot("우도", "자연", "14:00", "15:00", JEJU), slot("성산", "자연", "16:00", "17:00", JEJU)))

        forecasts.calls shouldBe listOf(JEJU)
    }

    "좌표 없는 실외 슬롯은 모름이다 — 부르지도 확인하지도 않는다" {
        val forecasts = FakeForecasts()

        val got = KmaForecastDetector(forecasts).detect(target(slot("우도", "자연", "14:00", "16:00", null)))

        got.shouldBeInstanceOf<Detection.Unknown>()
        forecasts.calls.shouldBeEmpty()
    }

    /**
     * 자료 없음(null — 03 소진·상한)은 **그 슬롯**만 모름이다. 다른 슬롯에 신호가 있으면 발화하고, 없으면 모름이다.
     * 같은 회차에서 그 격자는 다시 묻지 않는다(03 이면 격자마다 HTTP 3건이 든다).
     */
    "자료 없는 격자는 그 슬롯만 모름 — 다른 슬롯 신호는 발화, 같은 회차엔 다시 묻지 않는다" {
        val forecasts = FakeForecasts().answer(JEJU, null).answer(UDO, rainAt(14..16))
        val detector = KmaForecastDetector(forecasts)

        detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU))).shouldBeInstanceOf<Detection.Unknown>()
        val mixed = detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU), slot("우도", "자연", "14:00", "16:00", UDO)))

        (mixed as Detection.Checked).signals.single().reason shouldBe "오후에 비 소식이 있어요. 우도 일정이 영향을 받을 수 있어요."
        forecasts.calls shouldBe listOf(JEJU, UDO)

        detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU), round = NEXT_ROUND))
        forecasts.calls shouldBe listOf(JEJU, UDO, JEJU) // 다음 회차에는 다시 묻는다
    }

    /**
     * 게이트웨이 거절(키 미등록 30 등)은 **출처 전체**의 모름이다 — 그 회차의 남은 대상은 부르지 않는다(COST-SA-05 회차당 1~2콜).
     * 캐시하지 않으므로 다음 회차에 다시 묻는다.
     */
    "게이트웨이 거절 — 그 대상 모름, 같은 회차의 다른 여행은 부르지 않고, 다음 회차에 다시 묻는다" {
        val forecasts = FakeForecasts().fail(JEJU, HourlyForecastUnavailable("${JEJU.first},${JEJU.second}", "30")).answer(UDO, rainAt(14..16))
        val detector = KmaForecastDetector(forecasts)

        detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU))) shouldBe Detection.Unknown("gateway:30")
        detector.detect(target(slot("우도", "자연", "14:00", "16:00", UDO))) shouldBe Detection.Unknown("gateway:30")
        forecasts.calls shouldBe listOf(JEJU)

        detector.detect(target(slot("우도", "자연", "14:00", "16:00", UDO), round = NEXT_ROUND)).shouldBeInstanceOf<Detection.Checked>()
        forecasts.calls shouldBe listOf(JEJU, UDO)
    }

    /** 거절 기억은 예보가 필요한 판정만 막는다 — 실외가 없는 날은 부를 것이 없으니 그대로 확인이다(BR-SA-15). */
    "게이트웨이 거절을 기억한 회차에도 실외 슬롯이 없는 날은 확인이다" {
        val forecasts = FakeForecasts().fail(JEJU, HourlyForecastUnavailable("${JEJU.first},${JEJU.second}", "22"))
        val detector = KmaForecastDetector(forecasts)

        detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU))) shouldBe Detection.Unknown("gateway:22")

        detector.detect(target(slot("국립제주박물관", "문화", "14:00", "16:00", JEJU))) shouldBe Detection.Checked(setOf(null), emptyList())
        forecasts.calls shouldBe listOf(JEJU)
    }

    /**
     * 장애(시한·5xx·형식)는 던진다 — 스윕이 그 (출처, 여행, 날짜)만 모름으로 격리하고 연속 실패를 회로 차단으로 센다.
     * 실패한 격자는 그 회차 동안 다시 부르지 않는다 — 그 슬롯은 모름이고 다른 격자의 신호는 산다.
     */
    "장애는 던지고, 같은 회차에 그 격자는 다시 부르지 않는다 — 다른 격자 신호는 발화" {
        val forecasts = FakeForecasts().fail(JEJU, HourlyForecastUnavailable("${JEJU.first},${JEJU.second}", null)).answer(UDO, rainAt(14..16))
        val detector = KmaForecastDetector(forecasts)

        shouldThrow<HourlyForecastUnavailable> { detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU))) }
        val next = detector.detect(target(slot("성산", "자연", "14:00", "16:00", JEJU), slot("우도", "자연", "14:00", "16:00", UDO)))

        (next as Detection.Checked).signals.single().poiIds.size shouldBe 1
        forecasts.calls shouldBe listOf(JEJU, UDO)
    }

    /**
     * 전면 장애에서 지연 상한(PERF-SA-04 '3 × 상한')을 감지기가 지킨다 — 기억한 격자로 돌려준 모름은 예외가 아니라서 스윕의
     * 연속 실패 수를 0 으로 되돌린다. 그래서 **서로 다른 격자**의 장애가 회차 안에서 연속 3번이면 그 회차의 남은 대상은
     * 부르지 않고 모름이다(RES-SA-04). 기억한 격자만 걸린 여행은 장애를 세지도 되돌리지도 않는다.
     */
    "서로 다른 격자 장애가 연속 3번이면 그 회차의 남은 대상은 부르지 않는다 — 다음 회차에 다시 묻는다" {
        val a = 33.10 to 126.10
        val b = 33.20 to 126.20
        val c = 33.30 to 126.30
        val forecasts = FakeForecasts()
        listOf(a, b, c, JEJU).forEach { forecasts.fail(it, HourlyForecastUnavailable("${it.first},${it.second}", null)) }
        val detector = KmaForecastDetector(forecasts)
        fun trip(at: Pair<Double, Double>, round: Instant = ROUND) = target(slot("성산", "자연", "14:00", "16:00", at), round = round)

        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(a)) }
        detector.detect(trip(a)).shouldBeInstanceOf<Detection.Unknown>() // 기억한 격자 — 부르지 않는다
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(b)) }
        detector.detect(trip(b)).shouldBeInstanceOf<Detection.Unknown>()
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(c)) }

        detector.detect(trip(JEJU)) shouldBe Detection.Unknown("grid-circuit")
        forecasts.calls shouldBe listOf(a, b, c)

        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(JEJU, round = NEXT_ROUND)) }
        forecasts.calls shouldBe listOf(a, b, c, JEJU)
    }

    "격자 장애 사이에 받은 예보가 있으면 연속이 끊긴다 — 일부 격자 장애로는 출처를 닫지 않는다" {
        val a = 33.10 to 126.10
        val b = 33.20 to 126.20
        val c = 33.30 to 126.30
        val forecasts = FakeForecasts().answer(UDO, weather { _, w -> w })
        listOf(a, b, c).forEach { forecasts.fail(it, HourlyForecastUnavailable("${it.first},${it.second}", null)) }
        val detector = KmaForecastDetector(forecasts)
        fun trip(at: Pair<Double, Double>) = target(slot("성산", "자연", "14:00", "16:00", at))

        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(a)) }
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(b)) }
        detector.detect(trip(UDO)) shouldBe Detection.Checked(setOf(null), emptyList())
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(c)) }

        detector.detect(trip(UDO)) shouldBe Detection.Checked(setOf(null), emptyList())
        forecasts.calls shouldBe listOf(a, b, UDO, c, UDO)
    }

    /** 여행 단위 병렬이라 같은 새 격자를 두 여행이 함께 부를 수 있다 — 그 장애는 '서로 다른 격자' 하나로 센다. */
    "같은 격자를 두 여행이 동시에 처음 불러 둘 다 실패해도 장애는 한 번만 센다" {
        val a = 33.10 to 126.10
        val b = 33.20 to 126.20
        val together = CyclicBarrier(2)
        val forecasts = object : HourlyForecastFacade {
            val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
            override fun isLive() = true
            override fun gridKeyOf(lat: Double, lng: Double) = "$lat,$lng"
            override fun forecastForTrigger(lat: Double, lng: Double, at: Instant): PointForecast? {
                val key = "$lat,$lng"
                calls += key
                if (key == "${a.first},${a.second}") together.await(5, TimeUnit.SECONDS) // 두 여행이 함께 들어온 뒤에 실패한다
                throw HourlyForecastUnavailable(key, null)
            }
        }
        val detector = KmaForecastDetector(forecasts)
        fun trip(at: Pair<Double, Double>) = target(slot("성산", "자연", "14:00", "16:00", at))
        val pool = Executors.newFixedThreadPool(2)

        val errors = try {
            List(2) { pool.submit(Callable { runCatching { detector.detect(trip(a)) }.exceptionOrNull() }) }.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
        errors.forEach { it.shouldBeInstanceOf<HourlyForecastUnavailable>() }
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(b)) }

        // a 를 한 번만 셌으면 연속 2번이라 아직 열리지 않았다 — 다음 격자를 부른다
        shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(JEJU)) }
        forecasts.calls.count { it == "${JEJU.first},${JEJU.second}" } shouldBe 1
    }

    /**
     * 회로가 열리는 것은 상태 변화다 — 그 회차에 WARN 한 번(OBS-SA-03). 열린 뒤 돌려주는 모름은 다시 적지 않는다.
     * 스윕의 회로 WARN 은 이 경우에 뜨지 않을 수 있다(기억한 격자의 모름이 스윕의 연속 실패 수를 되돌린다) — 그래서 여기서 적는다.
     * 좌표·격자 키는 싣지 않는다(SEC-SA-05).
     */
    "격자 회로가 열리면 그 회차에 WARN 한 번 — 열린 뒤의 모름은 다시 적지 않고, 다음 회차에 다시 열리면 다시 적는다" {
        val broken = listOf(33.10 to 126.10, 33.20 to 126.20, 33.30 to 126.30)
        val forecasts = FakeForecasts()
        broken.forEach { forecasts.fail(it, HourlyForecastUnavailable("${it.first},${it.second}", null)) }
        val detector = KmaForecastDetector(forecasts)
        fun trip(at: Pair<Double, Double>, round: Instant = ROUND) = target(slot("성산", "자연", "14:00", "16:00", at), round = round)

        val first = detectorWarns {
            broken.forEach { shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(it)) } }
            repeat(2) { detector.detect(trip(JEJU)) shouldBe Detection.Unknown("grid-circuit") }
        }
        val next = detectorWarns { broken.forEach { shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(it, NEXT_ROUND)) } } }

        first.size shouldBe 1
        next.size shouldBe 1
        first.single() shouldNotContain "33."
        first.single() shouldNotContain "126."
    }

    /** 여행 단위 병렬이라 회로가 열리는 순간 이미 부르고 있던 여행의 장애가 뒤따른다 — 그것은 세어도 WARN 을 다시 남기지 않는다. */
    "회로가 열리는 순간 함께 실패한 여행들이 있어도 WARN 은 한 번이다" {
        val first = 33.10 to 126.10
        val together = listOf(33.20 to 126.20, 33.30 to 126.30, 33.40 to 126.40)
        val barrier = CyclicBarrier(together.size)
        val forecasts = object : HourlyForecastFacade {
            override fun isLive() = true
            override fun gridKeyOf(lat: Double, lng: Double) = "$lat,$lng"
            override fun forecastForTrigger(lat: Double, lng: Double, at: Instant): PointForecast? {
                if (lat to lng in together) barrier.await(5, TimeUnit.SECONDS) // 셋이 모두 부른 뒤에 함께 실패한다
                throw HourlyForecastUnavailable("$lat,$lng", null)
            }
        }
        val detector = KmaForecastDetector(forecasts)
        fun trip(at: Pair<Double, Double>) = target(slot("성산", "자연", "14:00", "16:00", at))
        val pool = Executors.newFixedThreadPool(together.size)

        val warns = detectorWarns {
            shouldThrow<HourlyForecastUnavailable> { detector.detect(trip(first)) }
            val errors = try {
                together.map { at -> pool.submit(Callable { runCatching { detector.detect(trip(at)) }.exceptionOrNull() }) }.map { it.get(10, TimeUnit.SECONDS) }
            } finally {
                pool.shutdownNow()
            }
            errors.forEach { it.shouldBeInstanceOf<HourlyForecastUnavailable>() }
            detector.detect(trip(JEJU)) shouldBe Detection.Unknown("grid-circuit")
        }

        warns.size shouldBe 1
    }

    "한 슬롯 칸만 비고 다른 신호가 없으면 모름이다" {
        val holey = weather { h, w -> if (h.hour == 15) w.copy(wsd = null) else w }

        KmaForecastDetector(FakeForecasts().answer(JEJU, holey)).detect(target(slot("우도", "자연", "14:00", "16:00", JEJU))) shouldBe
            Detection.Unknown("forecast-unknown")
    }
}) {
    companion object {
        val DAY: LocalDate = LocalDate.parse("2026-10-20") // 화
        private val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        fun kst(local: String): Instant = LocalDateTime.parse(local).atZone(ZONE).toInstant()

        /** 회차 13:15 · 판정 13:20 — 11시 발표분이 최신이다. */
        val ROUND: Instant = kst("2026-10-20T13:15")
        val NOW: Instant = kst("2026-10-20T13:20")
        val NEXT_ROUND: Instant = kst("2026-10-20T14:15")
        val BASE: Instant = kst("2026-10-20T11:00")
        val PREV_EVENING_BASE: Instant = kst("2026-10-19T20:00")
        /** 07:20 회차의 최신 발표(05시). */
        val MORNING_BASE: Instant = kst("2026-10-20T05:00")

        /** 격자 둘 — 성산(제주 동쪽)과 우도. 대역의 격자 키는 좌표 그대로다. */
        val JEJU = 33.46 to 126.94
        val UDO = 33.50 to 126.95

        val CALM = HourlyWeather(pop = 10, precipitation = Precipitation.NONE, sky = Sky.CLEAR, tmp = 20.0, wsd = 2.0)

        fun weather(base: Instant = BASE, edit: (LocalDateTime, HourlyWeather) -> HourlyWeather): PointForecast =
            PointForecast(
                "grid", base,
                (0L..47L).map { DAY.atStartOfDay().plusHours(it) }.filter { it.atZone(ZONE).toInstant() > base }.associateWith { edit(it, CALM) },
            )

        fun rainAt(hours: IntRange, base: Instant = BASE) =
            weather(base) { h, w -> if (h.toLocalDate() == DAY && h.hour in hours) w.copy(pop = 80, precipitation = Precipitation.RAIN) else w }

        fun slot(name: String?, category: String?, start: String, end: String, at: Pair<Double, Double>?): PlannedSlotView {
            val poi = UUID.randomUUID()
            return PlannedSlotView(
                slotKey = "$DAY#$poi", date = DAY, poiId = poi, orderIndex = 0,
                startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
                isFixed = false, endsNextDay = false, hasViolation = false,
                nameKo = name, category = category, lat = at?.first, lng = at?.second,
            )
        }

        fun target(vararg slots: PlannedSlotView, now: Instant = NOW, round: Instant = ROUND) = SweepTarget(
            tripId = UUID.randomUUID(), accountId = UUID.randomUUID(), date = DAY, phase = SweepPhase.DAYTIME,
            round = round, now = now, slots = slots.toList(), active = emptyList(),
        )
    }
}

/** [block] 동안 감지기가 남긴 WARN 문장. */
private fun detectorWarns(block: () -> Unit): List<String> {
    val logger = LoggerFactory.getLogger(KmaForecastDetector::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().also { it.start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.filter { it.level == Level.WARN }.map { it.formattedMessage }
}

/** 격자 예보 퍼사드 대역 — 격자 키는 좌표 쌍이다. 고장은 실물처럼 예외로 낸다. 부른 격자를 [calls] 에 적는다. */
private class FakeForecasts : HourlyForecastFacade {
    var live = true
    val calls = mutableListOf<Pair<Double, Double>>()
    private val answers = HashMap<String, () -> PointForecast?>()

    fun answer(at: Pair<Double, Double>, forecast: PointForecast?) = apply { answers[keyOf(at.first, at.second)] = { forecast } }
    fun fail(at: Pair<Double, Double>, error: HourlyForecastUnavailable) = apply { answers[keyOf(at.first, at.second)] = { throw error } }

    override fun isLive() = live
    override fun gridKeyOf(lat: Double, lng: Double): String? = if (live) keyOf(lat, lng) else null
    override fun forecastForTrigger(lat: Double, lng: Double, at: Instant): PointForecast? {
        calls += lat to lng
        return answers[keyOf(lat, lng)]?.invoke()
    }

    private fun keyOf(lat: Double, lng: Double) = "$lat,$lng"
}
