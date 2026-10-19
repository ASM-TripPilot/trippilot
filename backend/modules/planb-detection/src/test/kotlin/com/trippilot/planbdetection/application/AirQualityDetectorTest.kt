package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.application.AlertFixtures.DAY
import com.trippilot.planbdetection.application.AlertFixtures.JEJU
import com.trippilot.planbdetection.application.AlertFixtures.NEXT_ROUND
import com.trippilot.planbdetection.application.AlertFixtures.POHANG
import com.trippilot.planbdetection.application.AlertFixtures.kst
import com.trippilot.planbdetection.application.AlertFixtures.slot
import com.trippilot.planbdetection.application.AlertFixtures.target
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.time.LocalDate
import java.util.UUID

/**
 * 대기질 감지기(SituationDetector `airkorea` · 설계서 §4.2 · BR-SA-16) — 그 날 목적지 예보 권역의 PM10·PM25 중 나쁜 쪽:
 * 나쁨 = 주의 · 매우나쁨 = 위험(O-SA-3) · 보통 이하 = 확인. 등급 문자열은 바꾸지 않는다(BR-SA-24 — 공공누리 3유형 변경 금지).
 */
class AirQualityDetectorTest : StringSpec({

    val tripId = UUID.randomUUID()

    /** 10월 19일(월) 저녁 회차 — 내일(10월 20일 화)을 본다. 정본 문구 예가 이 날짜다. */
    val evening = kst("2026-10-19T20:20")
    val eveningRound = kst("2026-10-19T20:15")
    val monday = LocalDate.parse("2026-10-19")

    fun jejuTrip() = FakeTripDestinations().put(tripId, monday, DAY.plusDays(1), JEJU)
    fun graded(date: LocalDate, vararg grades: Pair<AirRegion, AirGrade>) = FakeAlerts().also { it.airByDate[date] = AlertRead.Ok(grades.toMap()) }

    "출처는 airkorea · 종류는 WEATHER · 오늘은 모든 회차, 내일은 저녁 회차만 본다 · live 는 원천을 따른다" {
        val alerts = FakeAlerts()
        val detector = AirQualityDetector(alerts, jejuTrip())

        detector.source shouldBe SweepSource.AIRKOREA
        detector.kind shouldBe TriggerKind.WEATHER
        SweepPhase.entries.forEach { detector.wants(it, 0) shouldBe true }
        detector.wants(SweepPhase.EVENING, 1) shouldBe true
        detector.wants(SweepPhase.MORNING, 1) shouldBe false
        detector.wants(SweepPhase.DAYTIME, 1) shouldBe false
        detector.isLive() shouldBe true
        alerts.live = false
        detector.isLive() shouldBe false
    }

    /** 정본 문구 예(BR-SA-12) — 미래일은 `M월 d일(E)` 머리, 등급은 따옴표 안에 원문 그대로. 미래일 범위는 FULL_DAY. */
    "내일 제주 PM10 '나쁨' — 주의 DUST 하나 · 정본 문구 · 출처 에어코리아 · payload 에 원문 등급" {
        val udo = slot("우도", "자연", "10:00", "12:00", DAY)
        val seongsan = slot("성산일출봉", "액티비티", "14:00", "16:00", DAY)
        val alerts = graded(DAY, AirRegion.JEJU to AirGrade(pm10 = "나쁨", pm25 = "보통"))

        val got = AirQualityDetector(alerts, jejuTrip())
            .detect(target(tripId, seongsan, udo, date = DAY, phase = SweepPhase.EVENING, now = evening, round = eveningRound))
            .shouldBeInstanceOf<Detection.Checked>()

        got.checked.shouldBeEmpty()
        val s = got.signals.single()
        s.kind shouldBe TriggerKind.WEATHER
        s.affectedDate shouldBe DAY
        s.slotKey shouldBe null
        s.scope shouldBe TriggerScope.FULL_DAY
        s.severity shouldBe TriggerSeverity.CAUTION
        s.variant shouldBe TriggerVariant.DUST
        s.dataSource shouldBe DataSource.AIRKOREA
        s.poiIds shouldBe listOf(udo.poiId, seongsan.poiId)
        s.reason shouldBe "10월 20일(화) 제주 미세먼지 예보가 '나쁨'이에요. 우도 등 야외 일정 2곳이 영향을 받을 수 있어요."
        s.payload shouldBe mapOf(
            "variants" to listOf("DUST"), "coverage" to "MOST", "slotKeys" to listOf(udo.slotKey, seongsan.slotKey),
            "region" to "제주", "pm10" to "나쁨", "pm25" to "보통",
        )
        SituationCopy.violation(s.reason, listOf("우도", "성산일출봉")) shouldBe null
        alerts.airCalls shouldBe listOf(DAY)
    }

    "오늘 PM25 '매우나쁨' — 위험 · 초미세먼지 · 날짜 머리 없음 · 오늘 범위 PARTIAL_SLOTS" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)
        val alerts = graded(DAY, AirRegion.JEJU to AirGrade(pm10 = "나쁨", pm25 = "매우나쁨"))

        val s = (AirQualityDetector(alerts, trips).detect(target(tripId, slot("우도", "자연", "14:00", "16:00"))) as Detection.Checked).signals.single()

        s.severity shouldBe TriggerSeverity.RISK
        s.scope shouldBe TriggerScope.PARTIAL_SLOTS
        s.reason shouldBe "제주 초미세먼지 예보가 '매우나쁨'이에요. 우도 일정이 영향을 받을 수 있어요."
    }

    "두 오염물질이 같은 등급이면 미세먼지(PM10)로 말한다" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)
        val alerts = graded(DAY, AirRegion.JEJU to AirGrade(pm10 = "나쁨", pm25 = "나쁨"))

        (AirQualityDetector(alerts, trips).detect(target(tripId, slot("우도", "자연", "14:00", "16:00"))) as Detection.Checked).signals.single().reason shouldBe
            "제주 미세먼지 예보가 '나쁨'이에요. 우도 일정이 영향을 받을 수 있어요."
    }

    "둘 다 보통 이하면 확인(날짜 전체)이다" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)

        listOf(AirGrade("좋음", "좋음"), AirGrade("보통", "좋음"), AirGrade("보통", "보통")).forEach { grade ->
            AirQualityDetector(graded(DAY, AirRegion.JEJU to grade), trips).detect(target(tripId, slot("우도", "자연", "14:00", "16:00"))) shouldBe
                Detection.Checked(setOf(null), emptyList())
        }
    }

    /** 한쪽이라도 등급을 모르면 '보통 이하'로 확인할 수 없다(INV-SA-2) — 아는 쪽이 나쁨 이상이면 그것으로 발화한다. */
    "한쪽 등급을 모르면(없음·모르는 문자열) 확인하지 않는다 — 아는 쪽이 나쁨 이상이면 발화" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)
        val day = target(tripId, slot("우도", "자연", "14:00", "16:00"))

        AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("보통", null)), trips).detect(day).shouldBeInstanceOf<Detection.Unknown>()
        AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("좋음", "예보없음")), trips).detect(day).shouldBeInstanceOf<Detection.Unknown>()
        (AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade(null, "나쁨")), trips).detect(day) as Detection.Checked).signals.single().reason shouldBe
            "제주 초미세먼지 예보가 '나쁨'이에요. 우도 일정이 영향을 받을 수 있어요."
    }

    "권역이 응답에 없거나 목적지 권역을 모르면(코드 없음·시도 단위 경기) 모름이다" {
        val day = target(tripId, slot("우도", "자연", "14:00", "16:00"))

        AirQualityDetector(graded(DAY, AirRegion.SEOUL to AirGrade("좋음", "좋음")), FakeTripDestinations().put(tripId, DAY, DAY, JEJU)).detect(day)
            .shouldBeInstanceOf<Detection.Unknown>()
        AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("좋음", "좋음")), FakeTripDestinations().put(tripId, DAY, DAY, TripDestinationRef("고성군", null, 1))).detect(day)
            .shouldBeInstanceOf<Detection.Unknown>()
        AirQualityDetector(graded(DAY, AirRegion.GYEONGGI_SOUTH to AirGrade("좋음", "좋음")), FakeTripDestinations().put(tripId, DAY, DAY, TripDestinationRef("경기도", "41", 1))).detect(day)
            .shouldBeInstanceOf<Detection.Unknown>()
    }

    "남은 실외 슬롯이 없으면 확인이고 원천을 부르지 않는다 · 미분류만 남은 날은 나쁨이면 모름, 좋으면 확인" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)
        val bad = graded(DAY, AirRegion.JEJU to AirGrade("나쁨", "나쁨"))

        AirQualityDetector(bad, trips).detect(target(tripId, slot("국립제주박물관", "문화", "14:00", "16:00"))) shouldBe Detection.Checked(setOf(null), emptyList())
        bad.airCalls.shouldBeEmpty()

        val ghost = slot(null, null, "14:00", "16:00")
        AirQualityDetector(bad, trips).detect(target(tripId, ghost)).shouldBeInstanceOf<Detection.Unknown>()
        AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("좋음", "보통")), trips).detect(target(tripId, ghost)) shouldBe Detection.Checked(setOf(null), emptyList())
    }

    /** 원천 모름은 그 회차·그 날짜에 한 번만 묻는다 — 다른 날짜·다음 회차에는 다시 묻는다(캐시 없음 · COST-SA-05). */
    "원천이 모르면 모름 — 같은 회차·같은 날짜의 다른 여행은 부르지 않는다" {
        val alerts = FakeAlerts().also { it.airByDate[DAY] = AlertRead.Unknown("gateway:30") }
        val other = UUID.randomUUID()
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU).put(other, DAY, DAY.plusDays(1), POHANG)
        val detector = AirQualityDetector(alerts, trips)

        detector.detect(target(tripId, slot("우도", "자연", "14:00", "16:00"))) shouldBe Detection.Unknown("gateway:30")
        detector.detect(target(other, slot("호미곶", "자연", "14:00", "16:00"))) shouldBe Detection.Unknown("gateway:30")
        alerts.airCalls shouldBe listOf(DAY)

        detector.detect(target(other, slot("호미곶", "자연", "14:00", "16:00", DAY.plusDays(1)), date = DAY.plusDays(1), phase = SweepPhase.EVENING))
        alerts.airCalls shouldBe listOf(DAY, DAY.plusDays(1))

        alerts.airByDate[DAY] = AlertRead.Ok(mapOf(AirRegion.GYEONGBUK to AirGrade("좋음", "좋음")))
        detector.detect(target(other, slot("호미곶", "자연", "14:00", "16:00"), round = NEXT_ROUND)) shouldBe Detection.Checked(setOf(null), emptyList())
    }

    "여행을 못 읽으면 모름이다" {
        AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("나쁨", "나쁨")), FakeTripDestinations()).detect(target(tripId, slot("우도", "자연", "14:00", "16:00")))
            .shouldBeInstanceOf<Detection.Unknown>()
    }

    /** 옮기는 날은 두 목적지를 본다 — 더 나쁜 곳으로 말한다. */
    "옮기는 날은 두 목적지 가운데 더 나쁜 곳으로 말한다" {
        val trips = FakeTripDestinations().put(tripId, DAY.minusDays(1), DAY.plusDays(1), TripDestinationRef("제주", "50", 1), POHANG)
        val alerts = graded(DAY, AirRegion.JEJU to AirGrade("나쁨", "좋음"), AirRegion.GYEONGBUK to AirGrade("매우나쁨", "나쁨"))

        val s = (AirQualityDetector(alerts, trips).detect(target(tripId, slot("호미곶", "자연", "14:00", "16:00"))) as Detection.Checked).signals.single()

        s.severity shouldBe TriggerSeverity.RISK
        s.reason shouldBe "포항 미세먼지 예보가 '매우나쁨'이에요. 호미곶 일정이 영향을 받을 수 있어요."
        s.payload["region"] shouldBe "경북"
    }

    "이름이 길어 200자를 넘기면 이름 없이 쓴다" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)

        val reason = (AirQualityDetector(graded(DAY, AirRegion.JEJU to AirGrade("나쁨", "좋음")), trips).detect(target(tripId, slot("우도".repeat(100), "자연", "14:00", "16:00"))) as Detection.Checked)
            .signals.single().reason

        reason shouldBe "제주 미세먼지 예보가 '나쁨'이에요. 야외 일정 한 곳이 영향을 받을 수 있어요."
        reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
    }
})
