package com.trippilot.planbdetection.domain

import com.trippilot.itinerarygeneration.api.CheckedSlot
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.placedata.api.PoiLifeStatus
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldStartWith
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 장소 판정(PBT-SA-12 · T-D3-P1 · BR-SA-17) — 하루 점검과 장소 상태에서 슬롯마다 발견·확인을 가른다.
 *
 * 지키는 것: 근거 없는 발견 0 · 근거 있으면 발견(완전성) · 폐업이 영업시간보다 우선 · 확인 ⊆ (ACTIVE ∧ OK ∧ ¬HOLIDAY) ·
 * slotKey 중복 0 · 오늘 시작이 지난 슬롯 0 · 편집 때 이미 본 영업시간 경고는 무발화, 폐업은 경고 이력과 무관하게 발화 ·
 * 폐업 여부를 모르는 회차는 떠 있는 폐업을 영업시간 위반으로 갈아 끼우지 않는다(INV-SA-2).
 * 같은 장소를 같은 날 두 번 넣으면 slotKey 가 같다(`{date}#{poiId}`) — 생성기가 그 경우를 섞는다.
 */
class ClosureRulesTest : StringSpec({

    val zone = TriggerLifecycle.TRAVEL_ZONE
    val today = LocalDate.parse("2026-10-20") // 화요일
    val tomorrow = today.plusDays(1)
    val pois = List(4) { UUID.nameUUIDFromBytes("poi-$it".toByteArray()) }
    val longName = "4시30분왕족발 제주시청점 2층 단체석 전용 예약 매장 별관"
    val names = Arb.element(null, "", "성산일출봉", "365분식", "오늘의커피", "[폐업] 사라진 카페", longName)
    // HC1 하위 코드 — 없음·셋·모르는 값(옛 AI·오타)
    val codes = Arb.element(null, "CLOSED_DAY", "OUT_OF_HOURS", "HOLIDAY", "BOGUS")
    /** 기대 변형 — 새 위반 슬롯의 하위 코드 중 더 확실한 것, 없거나 모르면 HOURS_MISMATCH. */
    fun expectedHours(fresh: List<CheckedSlot>): TriggerVariant =
        listOf(TriggerVariant.CLOSED_DAY, TriggerVariant.HOLIDAY, TriggerVariant.OUT_OF_HOURS)
            .firstOrNull { v -> fresh.any { it.reasonCode == v.name } } ?: TriggerVariant.HOURS_MISMATCH

    fun at(date: LocalDate, hhmm: String): Instant = date.atTime(LocalTime.parse(hhmm)).atZone(zone).toInstant()

    fun slot(
        poi: UUID, start: String, hours: HoursVerdict = HoursVerdict.OK, warned: Boolean = false,
        name: String? = "성산일출봉", date: LocalDate = today, code: String? = null,
    ) = CheckedSlot("$date#$poi", poi, name, LocalTime.parse(start), hours, code, warned)

    data class Case(
        val date: LocalDate,
        val now: Instant,
        val slots: List<CheckedSlot>,
        val status: Map<UUID, PoiLifeStatus>?,
        /** 그 날 이 출처가 띄운 ACTIVE 의 변형(slotKey → variant). */
        val active: Map<String, TriggerVariant>,
    ) {
        val nowTime: LocalTime get() = LocalTime.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)

        /** 판정이 봐야 하는 슬롯 — 오늘은 계획 시작이 지금 이후인 것만. */
        val seen: List<CheckedSlot> get() = slots.filter { date != LocalDate.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE) || it.startAt > nowTime }

        fun closed(s: CheckedSlot) = status?.get(s.poiId) == PoiLifeStatus.CLOSED
        fun freshHours(s: CheckedSlot) = s.hours == HoursVerdict.VIOLATED && !s.hoursWarnedBefore
        fun holiday(key: String) = active[key] == TriggerVariant.HOLIDAY

        /** 폐업이 떠 있는데 이번에 폐업 여부를 모른다(조회 실패·행 없음·OTHER) — 영업시간 위반으로 갈아 끼우지 않는다. */
        fun heldClosure(s: CheckedSlot) = active[s.slotKey] == TriggerVariant.PERMANENTLY_CLOSED && status?.get(s.poiId) != PoiLifeStatus.ACTIVE
    }

    val cases: Arb<Case> = arbitrary {
        val date = Arb.element(today, tomorrow).bind()
        val now = today.atStartOfDay(zone).plusMinutes(Arb.int(7 * 60..20 * 60 + 59).bind().toLong()).toInstant()
        val nameOf = pois.associateWith { names.bind() } // 같은 장소는 같은 이름이다
        val slots = List(Arb.int(0..8).bind()) {
            val poi = Arb.element(pois).bind()
            CheckedSlot(
                "$date#$poi", poi, nameOf.getValue(poi), LocalTime.of(Arb.int(0..23).bind(), Arb.int(0..59).bind()),
                Arb.enum<HoursVerdict>().bind(), codes.bind(), Arb.boolean().bind(),
            )
        }
        // 상태 조회 실패(null) · 없는 POI(키 빠짐) · 상태 4갈래를 섞는다.
        val status = if (Arb.int(0..4).bind() == 0) null else pois.filter { Arb.boolean().bind() }.associateWith { Arb.enum<PoiLifeStatus>().bind() }
        // 떠 있는 장소 트리거 — 공휴일 휴무 · 폐업 · 영업시간 불일치 · 없음.
        val active = pois.mapNotNull { p ->
            Arb.element(null, null, TriggerVariant.HOLIDAY, TriggerVariant.PERMANENTLY_CLOSED, TriggerVariant.HOURS_MISMATCH).bind()?.let { "$date#$p" to it }
        }.toMap()
        Case(date, now, slots, status, active)
    }

    fun judge(c: Case) = ClosureRules.judge(c.date, c.now, c.slots, c.status, c.active)

    "근거 없는 발견 0 · 근거 있으면 발견 · 폐업 우선 · slotKey 중복 0 (PBT-SA-12)" {
        checkAll(cases) { c ->
            val v = judge(c)
            val byKey = c.seen.groupBy { it.slotKey }

            v.findings.map { it.slotKey }.distinct().size shouldBe v.findings.size
            for (f in v.findings) {
                val group = byKey[f.slotKey].orEmpty()
                when (f.variant) {
                    TriggerVariant.PERMANENTLY_CLOSED -> {
                        group.any(c::closed) shouldBe true
                        f.dataSource shouldBe DataSource.PLACE_STATUS
                    }
                    TriggerVariant.HOURS_MISMATCH, TriggerVariant.CLOSED_DAY, TriggerVariant.OUT_OF_HOURS, TriggerVariant.HOLIDAY -> {
                        (group.none(c::closed) && group.any(c::freshHours) && group.none(c::heldClosure)) shouldBe true
                        f.variant shouldBe expectedHours(group.filter(c::freshHours))
                        f.dataSource shouldBe DataSource.AI_VALIDATE
                    }
                    else -> error("장소 감지기가 내지 않는 변형: ${f.variant}")
                }
                f.poiId shouldBe group.first().poiId
            }
            // 완전성 — 근거가 있는 대상은 발견이 있다. 폐업은 이미 본 경고와 무관하게 발화한다.
            for ((key, group) in byKey) {
                val found = v.findings.singleOrNull { it.slotKey == key }
                when {
                    group.any(c::closed) -> found?.variant shouldBe TriggerVariant.PERMANENTLY_CLOSED
                    group.any(c::heldClosure) -> found.shouldBeNull() // 폐업 여부를 모르는 회차가 떠 있는 폐업을 바꾸지 않는다
                    group.any(c::freshHours) -> found?.variant shouldBe expectedHours(group.filter(c::freshHours))
                    else -> found.shouldBeNull() // 이미 본 HC1 경고·OK·모름은 발화하지 않는다
                }
            }
        }
    }

    "확인 ⊆ (ACTIVE ∧ OK ∧ ¬HOLIDAY) · 발견과 겹치지 않는다 · 오늘 시작이 지난 슬롯은 발견도 확인도 없다 (PBT-SA-12)" {
        checkAll(cases) { c ->
            val v = judge(c)
            val byKey = c.seen.groupBy { it.slotKey }

            for (key in v.checked) {
                val group = byKey[key].orEmpty()
                group.isNotEmpty() shouldBe true // 본 슬롯만 확인한다 — 지난 슬롯·다른 날은 없다
                group.all { c.status?.get(it.poiId) == PoiLifeStatus.ACTIVE && it.hours == HoursVerdict.OK } shouldBe true
                c.holiday(key) shouldBe false // 공휴일 휴무는 감지기가 해제하지 않는다
            }
            v.checked.intersect(v.findings.map { it.slotKey }.toSet()).shouldBeEmpty()
            v.findings.forEach { (it.slotKey in byKey) shouldBe true }
            if (c.status == null) {
                v.checked.shouldBeEmpty() // 상태를 모르면 확인도 없다
                v.findings.none { it.variant == TriggerVariant.PERMANENTLY_CLOSED } shouldBe true
            }
        }
    }

    "아무것도 알아내지 못했을 때만 모름이다 — 모름이면 발견도 확인도 없다" {
        checkAll(cases) { c ->
            val v = judge(c)
            val definite = c.seen.any { c.status?.get(it.poiId) == PoiLifeStatus.ACTIVE && it.hours != HoursVerdict.UNKNOWN }
            v.blind shouldBe (v.findings.isEmpty() && c.seen.isNotEmpty() && !definite)
            if (v.blind) v.checked.shouldBeEmpty()
        }
    }

    "문구는 가드를 지난다 — 판정이 아는 전체 이름으로 비워도, 200자 이하 · 상대 날짜어 없음 · 미래일은 날짜 머리 (BR-SA-12)" {
        checkAll(cases) { c ->
            val fullNames = c.slots.mapNotNull { it.nameKo }
            for (f in judge(c).findings) {
                SituationCopy.violation(f.reason, fullNames).shouldBeNull()
                f.reason.length shouldBeLessThanOrEqual SituationCopy.MAX_LENGTH
                if (c.date != today) f.reason shouldStartWith SituationCopy.dayPrefix(c.date)
            }
        }
    }

    "예 — 폐업이 영업시간보다 우선하고, 받침에 맞춰 조사를 고른다" {
        val now = at(today, "07:15")
        val v = ClosureRules.judge(
            today, now,
            listOf(slot(pois[0], "10:00", HoursVerdict.VIOLATED, name = "[폐업] 사라진 카페"), slot(pois[1], "12:00", name = "국립제주박물관")),
            mapOf(pois[0] to PoiLifeStatus.CLOSED, pois[1] to PoiLifeStatus.CLOSED),
            emptyMap(),
        )

        v.findings.map { it.variant } shouldContainExactly listOf(TriggerVariant.PERMANENTLY_CLOSED, TriggerVariant.PERMANENTLY_CLOSED)
        v.findings.map { it.reason } shouldContainExactly listOf(
            "‘[폐업] 사라진 카페’는 폐업한 곳으로 확인됐어요",
            "‘국립제주박물관’은 폐업한 곳으로 확인됐어요",
        )
    }

    "예 — 영업시간 위반은 단정하지 않는다 · 미래일은 날짜 머리 · 이름이 없으면 '방문 예정지 한 곳이' · 긴 이름은 30자" {
        val now = at(today, "20:15")
        val v = ClosureRules.judge(
            tomorrow, now,
            listOf(
                slot(pois[0], "10:00", HoursVerdict.VIOLATED, name = "흑돼지거리 식당", date = tomorrow),
                slot(pois[1], "12:00", HoursVerdict.VIOLATED, name = null, date = tomorrow),
                slot(pois[2], "14:00", name = null, date = tomorrow),
                slot(pois[3], "16:00", HoursVerdict.VIOLATED, name = longName, date = tomorrow),
            ),
            mapOf(pois[0] to PoiLifeStatus.ACTIVE, pois[1] to PoiLifeStatus.ACTIVE, pois[2] to PoiLifeStatus.CLOSED, pois[3] to PoiLifeStatus.ACTIVE),
            emptyMap(),
        )

        v.findings.map { it.reason } shouldContainExactly listOf(
            "10월 21일(수) 계획한 시간엔 ‘흑돼지거리 식당’ 영업하지 않는 것으로 나와요",
            "10월 21일(수) 계획한 시간엔 방문 예정지 한 곳이 영업하지 않는 것으로 나와요",
            "10월 21일(수) 방문 예정지 한 곳이 폐업한 곳으로 확인됐어요",
            "10월 21일(수) 계획한 시간엔 ‘${SituationCopy.shortName(longName)}’ 영업하지 않는 것으로 나와요",
        )
    }

    "예 — HC1 하위 코드로 휴무·영업시간 밖·공휴일을 가르고, 없거나 모르면 영업시간 확인이다(BR-SA-17)" {
        val now = at(today, "20:15")
        val v = ClosureRules.judge(
            tomorrow, now,
            listOf(
                slot(pois[0], "10:00", HoursVerdict.VIOLATED, name = "국립제주박물관", date = tomorrow, code = "CLOSED_DAY"),
                slot(pois[1], "12:00", HoursVerdict.VIOLATED, name = "흑돼지거리 식당", date = tomorrow, code = "OUT_OF_HOURS"),
                slot(pois[2], "14:00", HoursVerdict.VIOLATED, name = null, date = tomorrow, code = "HOLIDAY"),
                slot(pois[3], "16:00", HoursVerdict.VIOLATED, name = "오늘의커피", date = tomorrow, code = "BOGUS"),
            ),
            pois.associateWith { PoiLifeStatus.ACTIVE },
            emptyMap(),
        )

        v.findings.map { it.variant to it.reason } shouldContainExactly listOf(
            TriggerVariant.CLOSED_DAY to "10월 21일(수) ‘국립제주박물관’은 정기 휴무일로 나와요",
            TriggerVariant.OUT_OF_HOURS to "10월 21일(수) 계획한 시간엔 ‘흑돼지거리 식당’ 문을 열지 않는 것으로 나와요",
            TriggerVariant.HOLIDAY to "10월 21일(수) 공휴일이라 방문 예정지 한 곳이 쉬는 날로 나와요",
            TriggerVariant.HOURS_MISMATCH to "10월 21일(수) 계획한 시간엔 ‘오늘의커피’ 영업하지 않는 것으로 나와요",
        )
    }

    "예 — 같은 장소를 하루 두 번 넣었으면 더 확실한 하위 코드를 따른다(정기 휴무 > 공휴일 > 영업시간 밖)" {
        val now = at(today, "20:15")
        val v = ClosureRules.judge(
            tomorrow, now,
            listOf(
                slot(pois[0], "10:00", HoursVerdict.VIOLATED, date = tomorrow, code = "OUT_OF_HOURS"),
                slot(pois[0], "18:00", HoursVerdict.VIOLATED, date = tomorrow, code = "CLOSED_DAY"),
            ),
            mapOf(pois[0] to PoiLifeStatus.ACTIVE),
            emptyMap(),
        )

        v.findings.map { it.variant } shouldContainExactly listOf(TriggerVariant.CLOSED_DAY)
    }

    "예 — 한글로 끝나지 않는 이름은 조사를 둘 다 적는다(지어내지 않는다)" {
        val v = ClosureRules.judge(
            today, at(today, "07:15"),
            listOf(slot(pois[0], "10:00", name = "Cafe 1990"), slot(pois[1], "11:00", name = "바다카페😀")),
            mapOf(pois[0] to PoiLifeStatus.CLOSED, pois[1] to PoiLifeStatus.CLOSED),
            emptyMap(),
        )

        v.findings.map { it.reason } shouldContainExactly listOf(
            "‘Cafe 1990’은(는) 폐업한 곳으로 확인됐어요",
            "‘바다카페😀’은(는) 폐업한 곳으로 확인됐어요",
        )
    }

    "예 — 오늘은 시작이 지난 슬롯을 보지 않는다(같은 장소의 오후 방문은 본다)" {
        val v = ClosureRules.judge(
            today, at(today, "12:00"),
            listOf(slot(pois[0], "09:00", HoursVerdict.VIOLATED), slot(pois[1], "12:00", HoursVerdict.VIOLATED), slot(pois[0], "15:00")),
            mapOf(pois[0] to PoiLifeStatus.ACTIVE, pois[1] to PoiLifeStatus.ACTIVE),
            emptyMap(),
        )

        v.findings.shouldBeEmpty() // 09:00 은 지났고, 12:00 은 '지금 이후'가 아니다
        v.checked shouldBe setOf("$today#${pois[0]}")
    }

    "예 — 공휴일 휴무가 떠 있는 슬롯은 OK 여도 확인하지 않는다(감지기가 해제하지 않는다)" {
        val v = ClosureRules.judge(
            tomorrow, at(today, "20:15"),
            listOf(slot(pois[0], "10:00", date = tomorrow)),
            mapOf(pois[0] to PoiLifeStatus.ACTIVE),
            mapOf("$tomorrow#${pois[0]}" to TriggerVariant.HOLIDAY),
        )

        v.checked.shouldBeEmpty()
        v.blind shouldBe false // 판정은 했다 — 모름이 아니다
    }

    "예 — 폐업 여부를 모르는 회차는 떠 있는 폐업을 영업시간 위반으로 갈아 끼우지 않는다 · 다른 슬롯의 영업시간 위반은 그대로 (INV-SA-2)" {
        val now = at(today, "20:15")
        val closedKey = "$tomorrow#${pois[0]}"
        val slots = listOf(slot(pois[0], "10:00", HoursVerdict.VIOLATED, date = tomorrow), slot(pois[1], "12:00", HoursVerdict.VIOLATED, date = tomorrow))
        val raised = mapOf(closedKey to TriggerVariant.PERMANENTLY_CLOSED)

        val failed = ClosureRules.judge(tomorrow, now, slots, null, raised) // 상태 조회 실패
        val other = ClosureRules.judge(tomorrow, now, slots, mapOf(pois[0] to PoiLifeStatus.OTHER, pois[1] to PoiLifeStatus.ACTIVE), raised)
        val reopened = ClosureRules.judge(tomorrow, now, slots, mapOf(pois[0] to PoiLifeStatus.ACTIVE, pois[1] to PoiLifeStatus.ACTIVE), raised)

        failed.findings.map { it.slotKey to it.variant } shouldContainExactly listOf("$tomorrow#${pois[1]}" to TriggerVariant.HOURS_MISMATCH)
        other.findings.map { it.slotKey to it.variant } shouldContainExactly listOf("$tomorrow#${pois[1]}" to TriggerVariant.HOURS_MISMATCH)
        // 다시 영업 중으로 확인되면(상태 ACTIVE) 영업시간 위반이 폐업을 대신한다 — 아는 것으로 바꾼다
        reopened.findings.map { it.slotKey to it.variant } shouldContainExactly listOf(
            closedKey to TriggerVariant.HOURS_MISMATCH, "$tomorrow#${pois[1]}" to TriggerVariant.HOURS_MISMATCH,
        )
    }
})
