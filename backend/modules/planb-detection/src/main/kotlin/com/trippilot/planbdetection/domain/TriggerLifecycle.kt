package com.trippilot.planbdetection.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 트리거 생명주기 — 한 여행의 판정 한 번(순수 함수 · 설계서 §4.1 규칙 6~12).
 *
 * 입력은 그 여행의 행(ACTIVE·이력)·억제·슬롯 시각·이번 관측이고, 출력은 **무엇을 쓰고 무엇을 알릴지**다.
 * 저장·발행은 호출자(`TriggerService`)가 한다. 규칙이 한곳에 있어야 날씨 확인(단건)과 스윕(회차)이 같은 말을 한다.
 *
 * 순서
 * 1. 만료(지난 날·끝난 슬롯·빠진 슬롯·빠진 날짜·그 날 남은 슬롯 없음)와 '오늘이 된 FULL_DAY' 교정 — 스윕만, WEATHER·CLOSURE 만
 * 2. 대상별 관측 접기(가장 무거운 신호 하나)와 출처별 해제(그 트리거의 detector 가 해소를 확인 ∧ 아무도 신호 없음)
 * 3. 결정표 — 발화+알림 / 조용한 발화 / 제자리 격상+알림 / 제자리 갱신 / 무발화 1번
 * 4. 알림 사건 ≤ 1 — 대표(위험 → 이른 날짜 → 날짜 전체 → 이른 슬롯) + 외 N건 + 그 날 위험, 푸시는 위험 대표 ∧ 하루 상한 안
 *
 * **모름은 아무것도 바꾸지 않는다**(INV-U4-09): `Look.checked == null`, 이번 회차 미호출, 신호 없음은 해제가 아니다.
 */
object TriggerLifecycle {

    /** 여행 '오늘'·남은 슬롯은 여행지 기준이다(서버 UTC 아님). */
    val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

    /** 스윕이 열고 닫는 종류. DELAY·MANUAL 은 스윕이 만료·해제하지 않는다(U10 확정 전 — 규칙 8). */
    val SWEPT_KINDS: Set<TriggerKind> = setOf(TriggerKind.WEATHER, TriggerKind.CLOSURE)

    /** 대상 = (kind, 영향 날짜, 슬롯). 대상당 ACTIVE 는 1개다(규칙 6). */
    data class Target(val kind: TriggerKind, val date: LocalDate, val slotKey: String?)

    /** 계획 슬롯의 시각. 단건 판정(요약 일정)은 시각을 몰라 null — 그 날 슬롯은 끝나지 않은 것으로 본다. */
    data class SlotTime(
        val slotKey: String,
        val date: LocalDate,
        val startAt: LocalTime?,
        val endAt: LocalTime?,
        val endsNextDay: Boolean,
    ) {
        /** 끝났는가 — 지난 날이거나, 오늘이고 끝 시각이 지났다(자정을 넘기는 슬롯은 오늘 안에 끝나지 않는다). */
        fun endedAt(today: LocalDate, nowTime: LocalTime): Boolean =
            date < today || (date == today && endAt != null && !endsNextDay && endAt <= nowTime)
    }

    /** 판정할 신호 한 건. [payload] 에 변형·해제 자격(detector)·원천·영향 POI 가 이미 실려 있다. */
    data class Sighting(
        val target: Target,
        val severity: TriggerSeverity,
        val variant: TriggerVariant?,
        val scope: TriggerScope,
        val reason: String,
        val payload: Map<String, Any>,
    ) {
        val detector: String? get() = payload[PlanBTrigger.PAYLOAD_DETECTOR] as? String
    }

    /** 출처 하나가 (kind, 날짜) 하나를 본 결과. [checked] null = 모름 — 그 출처는 이번에 해제할 자격이 없다. */
    data class Look(val source: String, val kind: TriggerKind, val date: LocalDate, val checked: Set<String?>?)

    data class Input(
        val tripId: UUID,
        /** 현재 일정. null = 일정 없음 — 새 행을 만들 수 없다(행이 itinerary_id 를 요구한다). */
        val itineraryId: UUID?,
        val now: Instant,
        /** 이 판정이 받는 날짜(규칙 12) — 밖의 신호는 행도 만들지 않는다. */
        val allowedDates: Set<LocalDate>,
        val slots: List<SlotTime>,
        /** 그 여행의 ACTIVE 전부. */
        val actives: List<PlanBTrigger>,
        /** 판정 날짜와 그 전날의 행(상태 무관) — 알린 최고 심각도·연일 반복·무발화 중복의 근거. */
        val history: List<PlanBTrigger>,
        val suppressions: List<Suppression>,
        /** 민감도 하루 상한 — 푸시만 묶는다. */
        val pushCap: Int,
        /** 오늘(KST) 이미 푸시 대상이었던 사건 수. */
        val pushedToday: Int,
        val looks: List<Look>,
        val sightings: List<Sighting>,
        /** true = 스윕 회차(만료·교정·출처별 해제). false = 단건 판정(날씨 확인·U10). */
        val sweep: Boolean,
    ) {
        val today: LocalDate get() = LocalDate.ofInstant(now, TRAVEL_ZONE)
        val nowTime: LocalTime get() = LocalTime.ofInstant(now, TRAVEL_ZONE)
    }

    /** 알림 사건 한 건(규칙 11). [dateRisks] = 대표 날짜의 ACTIVE 위험 전부(대표 포함) — 선계산(C10) 재료. */
    data class Announcement(
        val representative: PlanBTrigger,
        val others: Int,
        val dateRisks: List<PlanBTrigger>,
        val push: Boolean,
    )

    /** [updates] 는 기존 행의 새 모습이다 — **[inserts] 보다 먼저 저장**한다(같은 대상 유니크가 순서를 본다). */
    data class Plan(
        val updates: List<PlanBTrigger>,
        val inserts: List<PlanBTrigger>,
        val announcement: Announcement?,
        val expired: Int,
        val quiet: Int,
    )

    /** 허용 날짜(규칙 12) = {오늘, (지평이 열면) 내일} ∩ [시작, 종료]. 시작 전날(D-1)이면 첫날 하나다. */
    fun allowedDates(today: LocalDate, start: LocalDate, end: LocalDate, includeTomorrow: Boolean): Set<LocalDate> =
        listOfNotNull(today, today.plusDays(1).takeIf { includeTomorrow }).filter { it in start..end }.toSet()

    /** 스윕 신호의 범위(CD7) — 오늘은 PARTIAL_SLOTS(날짜 전체 신호 포함), 미래일은 FULL_DAY. 감지기 출력을 판정이 교정한다. */
    fun sweepScope(date: LocalDate, today: LocalDate): TriggerScope =
        if (date == today) TriggerScope.PARTIAL_SLOTS else TriggerScope.FULL_DAY

    fun plan(input: Input): Plan {
        val today = input.today
        val nowTime = input.nowTime
        val changed = LinkedHashMap<UUID, PlanBTrigger>() // 기존 행의 새 모습(id → 행)
        val inserts = mutableListOf<PlanBTrigger>()
        val active = LinkedHashMap<Target, PlanBTrigger>().apply { input.actives.forEach { put(it.target, it) } }
        val known = (input.history + input.actives).distinctBy { it.triggerId }
        var expired = 0
        var quiet = 0

        fun close(t: PlanBTrigger) {
            changed[t.triggerId] = t.expired()
            active.remove(t.target)
            expired++
        }

        // ① 만료(규칙 8)와 '오늘이 된 FULL_DAY' 교정(CD7) — 스윕만, WEATHER·CLOSURE 만
        if (input.sweep) {
            for (t in input.actives.filter { it.kind in SWEPT_KINDS }) {
                if (isStale(t, input.slots, today, nowTime)) {
                    close(t)
                } else if (t.affectedDate == today && t.scope == TriggerScope.FULL_DAY) {
                    val fixed = t.copy(scope = TriggerScope.PARTIAL_SLOTS)
                    changed[t.triggerId] = fixed
                    active[t.target] = fixed
                }
            }
        }

        // ② 관측 접기 — 대상마다 가장 무거운 신호 하나
        val folded = input.sightings
            .filter { it.target.date in input.allowedDates && (!input.sweep || it.target.kind in SWEPT_KINDS) }
            .groupBy { it.target }
            .mapValues { (target, list) -> list.minWith(foldOrder(active[target])) }

        // 해제(규칙 7) — 그 트리거의 detector 가 이번에 그 대상을 해소로 확인했고, 어떤 출처도 그 대상에 신호를 내지 않았다
        if (input.sweep) {
            val looks = input.looks.associateBy { Triple(it.source, it.kind, it.date) }
            active.values.toList()
                .filter { it.kind in SWEPT_KINDS && it.target !in folded }
                .filter { t -> t.detector?.let { looks[Triple(it, t.kind, t.affectedDate)]?.checked }?.contains(t.slotKey) == true }
                .forEach(::close)
        }

        // ③ 결정표(규칙 9)
        val alerted = mutableListOf<UUID>()
        for ((target, s) in folded) {
            val alertedMax = known.filter { it.target == target }.mapNotNull { it.alertedSeverity }.maxByOrNull { it.rank }
            val current = active[target]
            if (current != null) {
                val next = current.copy(severity = s.severity, scope = s.scope, reason = s.reason, payload = s.payload)
                if (next != current) {
                    changed[current.triggerId] = next // 제자리 갱신 — triggerId 유지(CD9)
                    active[target] = next
                }
                val covered = input.suppressions.any {
                    it.isEffectiveAt(input.now) && it.covers(target.kind, target.slotKey, target.date, s.severity)
                }
                // 제자리 격상 + 알림 — 떠 있는 것보다 무겁고, 그 대상에 알린 최고보다 무겁고, 끈 범위 밖일 때만
                if (s.severity.rank > current.severity.rank && s.severity.isAbove(alertedMax) && !covered) {
                    alerted += current.triggerId
                }
                continue
            }
            val itineraryId = input.itineraryId ?: continue
            val remaining = input.slots.filter { it.date == target.date && !it.endedAt(today, nowTime) }.map { it.slotKey }.toSet()
            val verdict = TriggerEvaluator.verdict(
                target.kind, target.slotKey, target.date, s.severity, remaining, input.suppressions, input.now,
            )
            if (verdict != TriggerEvaluator.Verdict.RAISE) {
                // 무발화 행은 대상·변형·판정당 한 번만 — 매 회차 같은 행이 쌓이지 않게(행은 남겨 '왜 안 왔나'에 답한다)
                val seen = known.any { it.target == target && !it.shouldReplan && it.variant == s.variant && it.state == verdict.state }
                if (!seen) {
                    inserts += PlanBTrigger.silent(
                        input.tripId, itineraryId, target.kind, target.date, target.slotKey,
                        s.payload, s.reason, verdict.state, input.now, s.severity,
                    )
                }
                continue
            }
            val fired = PlanBTrigger.active(
                input.tripId, itineraryId, target.kind, target.date, target.slotKey,
                s.payload, s.scope, s.reason, input.now, s.severity,
            )
            inserts += fired
            active[target] = fired
            // 같은 위험이 연일 이어지면 둘째 날부터 조용히(UQ11) — 날짜 전체 신호만
            val repeated = target.slotKey == null && known.any {
                it.kind == target.kind && it.slotKey == null && it.affectedDate == target.date.minusDays(1) &&
                    it.alertedSeverity == s.severity && it.variant == s.variant
            }
            if (s.severity.isAbove(alertedMax) && !repeated) alerted += fired.triggerId else quiet++
        }

        // ④ 알림 사건 ≤ 1(규칙 11)
        if (alerted.isEmpty()) return Plan(changed.values.toList(), inserts, null, expired, quiet)
        fun rowOf(id: UUID): PlanBTrigger = inserts.firstOrNull { it.triggerId == id } ?: changed.getValue(id)
        val starts = input.slots.associate { it.slotKey to it.startAt }
        val rows = alerted.map(::rowOf).sortedWith(
            compareByDescending<PlanBTrigger> { it.severity.rank }
                .thenBy { it.affectedDate }
                .thenBy { it.slotKey != null } // 날짜 전체 먼저
                .thenBy(nullsLast<LocalTime>()) { it.slotKey?.let { key -> starts[key] } }
                .thenBy(nullsLast<String>()) { it.slotKey },
        )
        val representative = rows.first()
        val push = representative.severity == TriggerSeverity.RISK && input.pushedToday < input.pushCap
        for (row in rows) {
            val marked = row.copy(
                alertedSeverity = if (row.severity.isAbove(row.alertedSeverity)) row.severity else row.alertedSeverity,
                pushedAt = if (push && row.triggerId == representative.triggerId) input.now else row.pushedAt,
            )
            val i = inserts.indexOfFirst { it.triggerId == row.triggerId }
            if (i >= 0) inserts[i] = marked else changed[row.triggerId] = marked
            active[row.target] = marked
        }
        val dateRisks = active.values.filter { it.affectedDate == representative.affectedDate && it.severity == TriggerSeverity.RISK }
        return Plan(
            changed.values.toList(), inserts,
            Announcement(rowOf(representative.triggerId), rows.size - 1, dateRisks, push),
            expired, quiet,
        )
    }

    /** 시간·일정으로 끝났는가(규칙 8). 빈 `ofDay` = 일정에서 빠진 날짜. */
    private fun isStale(t: PlanBTrigger, slots: List<SlotTime>, today: LocalDate, nowTime: LocalTime): Boolean {
        if (t.affectedDate < today) return true
        val ofDay = slots.filter { it.date == t.affectedDate }
        val slotKey = t.slotKey ?: return ofDay.all { it.endedAt(today, nowTime) }
        val slot = ofDay.firstOrNull { it.slotKey == slotKey } ?: return true
        return slot.endedAt(today, nowTime)
    }

    /** 접기 순서 — 무거운 것, 같으면 지금 떠 있는 것과 같은 출처·변형(문구가 회차마다 뒤집히지 않게), 그다음 이름순(결정론). */
    private fun foldOrder(current: PlanBTrigger?): Comparator<Sighting> =
        compareByDescending<Sighting> { it.severity.rank }
            .thenBy { if (current != null && it.detector == current.detector && it.variant == current.variant) 0 else 1 }
            .thenBy(nullsLast<String>()) { it.detector }
            .thenBy(nullsLast<String>()) { it.variant?.name }
            .thenBy { it.reason }
}
