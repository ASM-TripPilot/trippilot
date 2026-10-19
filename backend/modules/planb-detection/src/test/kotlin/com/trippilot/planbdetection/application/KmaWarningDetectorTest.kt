package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.application.AlertFixtures.DAY
import com.trippilot.planbdetection.application.AlertFixtures.JEJU
import com.trippilot.planbdetection.application.AlertFixtures.NEXT_ROUND
import com.trippilot.planbdetection.application.AlertFixtures.POHANG
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
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.util.UUID

/**
 * 기상특보 감지기(SituationDetector `kma-warning` · 설계서 §4.2 · BR-SA-16) — 오늘 발효 중 특보가 그 날의 목적지에 걸리면 오늘
 * 실외 슬롯 전부에 위험 신호 하나. 매칭 규칙의 표는 [com.trippilot.planbdetection.domain.WeatherAlertsTest] 가 본다 — 여기서는 신호의
 * 모양(대표·심각도·범위·출처·payload·정본 문구)과 모름의 갈래(원천 모름·목적지 모름·모르는 종류·미분류 슬롯)와 회차 기억을 본다.
 */
class KmaWarningDetectorTest : StringSpec({

    val tripId = UUID.randomUUID()
    fun pohangTrip() = FakeTripDestinations().put(tripId, DAY.minusDays(1), DAY.plusDays(1), POHANG)
    fun warned(vararg warnings: ActiveWarning) = FakeAlerts().also { it.warnings = AlertRead.Ok(warnings.toList()) }
    fun gale(vararg areas: WarningArea) = ActiveWarning("강풍", "주의보", areas.toList())
    val gyeongbuk = WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "울진산지", "경주동부"))

    "출처는 kma-warning · 종류는 WEATHER · 오늘만 본다(특보현황에 종료 시각이 없다) · live 는 원천을 따른다" {
        val alerts = FakeAlerts()
        val detector = KmaWarningDetector(alerts, pohangTrip())

        detector.source shouldBe SweepSource.KMA_WARNING
        detector.kind shouldBe TriggerKind.WEATHER
        SweepPhase.entries.forEach { detector.wants(it, 0) shouldBe true }
        detector.wants(SweepPhase.EVENING, 1) shouldBe false
        detector.isLive() shouldBe true
        alerts.live = false
        detector.isLive() shouldBe false
    }

    /** 정본 문구 예(BR-SA-12) 그대로 — 특보 감지기는 기상청 발표 사실이라 특보 이름을 쓴다. 범위는 오늘이라 PARTIAL_SLOTS(CD7). */
    "포항 강풍주의보 — 오늘 실외 슬롯 전부에 위험 WIND 하나 · 정본 문구 · 출처 기상청 기상특보 · payload" {
        val homigot = slot("호미곶", "자연", "14:00", "15:00")
        val guryongpo = slot("구룡포 해안", "액티비티", "16:00", "17:00")
        val museum = slot("포항시립미술관", "문화", "15:00", "16:00")

        val got = KmaWarningDetector(warned(gale(gyeongbuk, WarningArea("울산"))), pohangTrip())
            .detect(target(tripId, guryongpo, museum, homigot)).shouldBeInstanceOf<Detection.Checked>()

        got.checked.shouldBeEmpty()
        val s = got.signals.single()
        s.kind shouldBe TriggerKind.WEATHER
        s.affectedDate shouldBe DAY
        s.slotKey shouldBe null
        s.scope shouldBe TriggerScope.PARTIAL_SLOTS
        s.severity shouldBe TriggerSeverity.RISK
        s.variant shouldBe TriggerVariant.WIND
        s.dataSource shouldBe DataSource.KMA_WARNING
        s.poiIds shouldBe listOf(homigot.poiId, guryongpo.poiId)
        s.reason shouldBe "기상청이 포항에 강풍주의보를 발표했어요. 호미곶 등 야외 일정 2곳이 영향을 받을 수 있어요."
        s.payload shouldBe mapOf(
            "variants" to listOf("WIND"), "coverage" to "MOST",
            "slotKeys" to listOf(homigot.slotKey, guryongpo.slotKey), "warnings" to listOf("강풍주의보"),
        )
        SituationCopy.violation(s.reason, listOf("호미곶", "구룡포 해안", "포항시립미술관")) shouldBe null
    }

    "목적지에 걸린 특보가 없으면 확인(날짜 전체) — 다른 지역 특보 · 특보 없음(실응답 'o 없 음' = 빈 목록)" {
        val day = target(tripId, slot("호미곶", "자연", "14:00", "15:00"))

        KmaWarningDetector(warned(ActiveWarning("호우", "경보", listOf(WarningArea("서울")))), pohangTrip()).detect(day) shouldBe
            Detection.Checked(setOf(null), emptyList())
        KmaWarningDetector(warned(), pohangTrip()).detect(day) shouldBe Detection.Checked(setOf(null), emptyList())
    }

    "바다 구역과 풍랑·폭풍해일·건조는 무시한다 — 확인이다" {
        val alerts = warned(
            ActiveWarning("풍랑", "주의보", listOf(WarningArea("동해남부북쪽안쪽먼바다"))),
            ActiveWarning("건조", "경보", listOf(gyeongbuk)),
            ActiveWarning("폭풍해일", "주의보", listOf(gyeongbuk)),
            ActiveWarning("강풍", "주의보", listOf(WarningArea("동해중부먼바다"))),
        )

        KmaWarningDetector(alerts, pohangTrip()).detect(target(tripId, slot("호미곶", "자연", "14:00", "15:00"))) shouldBe
            Detection.Checked(setOf(null), emptyList())
    }

    /** 모르는 종류가 목적지에 걸리면 뜻을 몰라 '특보 없음'으로 확인할 수 없다(INV-SA-2) — 아는 종류가 같이 걸리면 그것은 발화한다. */
    "모르는 종류가 걸리면 모름 — 아는 종류가 같이 걸리면 그것은 발화" {
        val odd = ActiveWarning("지진해일", "주의보", listOf(gyeongbuk))
        val day = target(tripId, slot("호미곶", "자연", "14:00", "15:00"))

        KmaWarningDetector(warned(odd), pohangTrip()).detect(day).shouldBeInstanceOf<Detection.Unknown>()
        (KmaWarningDetector(warned(odd, gale(gyeongbuk)), pohangTrip()).detect(day) as Detection.Checked).signals.single().variant shouldBe
            TriggerVariant.WIND
    }

    "여럿이 걸리면 대표 = SNOW > RAIN > WIND > COLD > HEAT > DUST, 같은 종류면 경보가 주의보를 이긴다" {
        val alerts = warned(
            ActiveWarning("폭염", "주의보", listOf(gyeongbuk)),
            gale(gyeongbuk),
            ActiveWarning("호우", "주의보", listOf(WarningArea("경상북도", listOf("포항")))),
            ActiveWarning("호우", "경보", listOf(WarningArea("경상북도", listOf("영덕", "포항")))),
            ActiveWarning("황사", "경보", listOf(gyeongbuk)),
        )

        val s = (KmaWarningDetector(alerts, pohangTrip()).detect(target(tripId, slot("호미곶", "자연", "14:00", "15:00"))) as Detection.Checked)
            .signals.single()

        s.variant shouldBe TriggerVariant.RAIN
        s.reason shouldBe "기상청이 포항에 호우경보를 발표했어요. 호미곶 일정이 영향을 받을 수 있어요."
        s.payload["variants"] shouldBe listOf("RAIN", "WIND", "HEAT", "DUST")
        s.payload["warnings"] shouldBe listOf("폭염주의보", "강풍주의보", "호우주의보", "호우경보", "황사경보")
    }

    "남은 실외 슬롯이 없으면 확인이고 원천을 부르지 않는다 — 실내로 바꾼 날은 해제된다" {
        val alerts = warned(gale(gyeongbuk))

        KmaWarningDetector(alerts, pohangTrip()).detect(target(tripId, slot("포항시립미술관", "문화", "15:00", "16:00"))) shouldBe
            Detection.Checked(setOf(null), emptyList())
        alerts.warningCalls.shouldBeEmpty()
    }

    /** 카테고리가 없는 슬롯은 실외인지 모른다 — 특보가 걸려도 그 슬롯을 지어내 넣지 않고, 걸린 특보가 없으면 그 날은 확인이다. */
    "미분류 슬롯만 남은 날 — 특보가 걸리면 모름, 안 걸리면 확인" {
        val ghost = slot(null, null, "14:00", "15:00")

        KmaWarningDetector(warned(gale(gyeongbuk)), pohangTrip()).detect(target(tripId, ghost)).shouldBeInstanceOf<Detection.Unknown>()
        KmaWarningDetector(warned(gale(WarningArea("서울"))), pohangTrip()).detect(target(tripId, ghost)) shouldBe
            Detection.Checked(setOf(null), emptyList())
    }

    "미분류 슬롯이 섞여도 실외 슬롯 신호는 낸다 — 영향은 실외 슬롯만" {
        val homigot = slot("호미곶", "자연", "14:00", "15:00")

        val s = (KmaWarningDetector(warned(gale(gyeongbuk)), pohangTrip()).detect(target(tripId, homigot, slot(null, null, "16:00", "17:00"))) as Detection.Checked)
            .signals.single()

        s.poiIds shouldBe listOf(homigot.poiId)
    }

    /** 원천 모름(게이트웨이 거절 30 등)은 그 출처 전체다 — 그 회차의 다른 여행은 부르지 않고 모름, 다음 회차에 다시 묻는다(COST-SA-05). */
    "원천이 모르면 모름 — 같은 회차의 다른 여행은 부르지 않고, 다음 회차에 다시 묻는다" {
        val alerts = FakeAlerts().also { it.warnings = AlertRead.Unknown("gateway:30") }
        val other = UUID.randomUUID()
        val trips = pohangTrip().put(other, DAY, DAY, POHANG)
        val detector = KmaWarningDetector(alerts, trips)

        detector.detect(target(tripId, slot("호미곶", "자연", "14:00", "15:00"))) shouldBe Detection.Unknown("gateway:30")
        detector.detect(target(other, slot("호미곶", "자연", "14:00", "15:00"))) shouldBe Detection.Unknown("gateway:30")
        alerts.warningCalls.size shouldBe 1

        alerts.warnings = AlertRead.Ok(emptyList())
        detector.detect(target(other, slot("호미곶", "자연", "14:00", "15:00"), round = NEXT_ROUND)) shouldBe Detection.Checked(setOf(null), emptyList())
        alerts.warningCalls.size shouldBe 2
    }

    "여행을 못 읽거나(없음·타 계정) 목적지가 없으면 모름이다" {
        val alerts = warned()
        val day = slot("호미곶", "자연", "14:00", "15:00")

        KmaWarningDetector(alerts, FakeTripDestinations()).detect(target(tripId, day)).shouldBeInstanceOf<Detection.Unknown>()
        KmaWarningDetector(alerts, FakeTripDestinations().put(tripId, DAY, DAY)).detect(target(tripId, day)).shouldBeInstanceOf<Detection.Unknown>()
    }

    /** 코드 없는 목적지(동명이지역 — 서버가 코드를 확정하지 못했다)는 어디인지 모른다 — 다른 목적지의 신호는 낸다. */
    "코드 없는 목적지는 모름 — 그 날 다른 목적지에 걸리면 발화한다" {
        val ambiguous = TripDestinationRef("중구", null, 1)
        val day = slot("호미곶", "자연", "14:00", "15:00")
        val alone = FakeTripDestinations().put(tripId, DAY, DAY, ambiguous)
        // 첫날 중구(1박) → 둘째 날 포항으로 옮긴다 — 옮기는 날은 두 목적지를 본다
        val moving = FakeTripDestinations().put(tripId, DAY.minusDays(1), DAY.plusDays(1), ambiguous, POHANG)

        KmaWarningDetector(warned(), alone).detect(target(tripId, day)).shouldBeInstanceOf<Detection.Unknown>()
        KmaWarningDetector(warned(), moving).detect(target(tripId, day)).shouldBeInstanceOf<Detection.Unknown>()
        (KmaWarningDetector(warned(gale(gyeongbuk)), moving).detect(target(tripId, day)) as Detection.Checked).signals.single().variant shouldBe
            TriggerVariant.WIND
    }

    /** 다목적지 — 다른 날의 목적지 특보로 오늘 일정을 경보하지 않는다. 옮기는 날은 전날 목적지도 본다(아침 일정). */
    "그 날의 목적지만 본다 — 제주 2박 뒤 포항이면 셋째 날(옮기는 날)부터 포항 특보가 걸린다" {
        val trips = FakeTripDestinations().put(tripId, DAY.minusDays(1), DAY.plusDays(3), JEJU, POHANG)
        val alerts = warned(gale(gyeongbuk))
        val detector = KmaWarningDetector(alerts, trips)
        fun on(date: java.time.LocalDate) = target(
            tripId, slot("호미곶", "자연", "14:00", "15:00", date), date = date,
            now = AlertFixtures.kst("${date}T13:20"), round = AlertFixtures.kst("${date}T13:15"),
        )

        detector.detect(on(DAY)) shouldBe Detection.Checked(setOf(null), emptyList()) // 둘째 날 — 제주
        (detector.detect(on(DAY.plusDays(1))) as Detection.Checked).signals.single().reason shouldBe
            "기상청이 포항에 강풍주의보를 발표했어요. 호미곶 일정이 영향을 받을 수 있어요."
    }

    "광역 목적지는 광역 이름으로 말한다 — 제주에 대설경보" {
        val trips = FakeTripDestinations().put(tripId, DAY, DAY.plusDays(1), JEJU)
        val alerts = warned(ActiveWarning("대설", "경보", listOf(WarningArea("제주도", listOf("제주도산지")))))

        val s = (KmaWarningDetector(alerts, trips).detect(target(tripId, slot("한라산", "자연", "09:00", "15:00"), slot("우도", "자연", "16:00", "17:00"))) as Detection.Checked)
            .signals.single()

        s.variant shouldBe TriggerVariant.SNOW
        s.reason shouldBe "기상청이 제주에 대설경보를 발표했어요. 한라산 등 야외 일정 2곳이 영향을 받을 수 있어요."
    }

    "이름이 길어 200자를 넘기면 이름 없이 쓴다 — 가드에 걸려 신호를 통째로 잃지 않게" {
        val long = "호미곶".repeat(70)

        val reason = (KmaWarningDetector(warned(gale(gyeongbuk)), pohangTrip()).detect(target(tripId, slot(long, "자연", "14:00", "15:00"))) as Detection.Checked)
            .signals.single().reason

        reason shouldBe "기상청이 포항에 강풍주의보를 발표했어요. 야외 일정 한 곳이 영향을 받을 수 있어요."
        reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
    }
})
