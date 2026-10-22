package com.trippilot.recalculation.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 재계획 세션(C10 · 정본 §3.2) — `i10` 제출부터 `i18` 확정/취소까지의 수명.
 *
 * **INV-U4-05**: `APPLIED` 가 되기 전에는 `itinerary`·`visit_slot` 에 어떤 쓰기도 발생하지 않는다.
 * 재계획안은 [draft] 에만 있고, 취소는 세션만 닫는다. 그래서 "확정 전에 원 일정이 흔들리는" 일이 없다.
 *
 * 상태: `COLLECTING`(입력 모으는 중) → `SOLVING`(산출 중) → `DRAFT`(제안 완료, 사용자가 고르는 중)
 * → `APPLIED` | `CANCELED`, 그리고 산출 실패는 `FAILED`(오류) · `NO_SOLUTION`(해가 없음)로 갈린다.
 * 실패를 하나로 뭉치지 않는 이유: 사용자가 할 일이 다르다 — 전자는 재시도, 후자는 조건 완화다.
 */
data class ReplanSession(
    val sessionId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    /** 자동 진입이면 근거 트리거. 수동 진입이면 null. */
    val triggerId: UUID?,
    val scope: ReplanScope,
    /**
     * 다시 짤 일자(TRIP-1182). 종전에는 [fromInstant] 에서 파생한 '오늘'이 코드에 박혀 있었다 —
     * 그래서 내일·모레를 다시 짜는 길이 없었다.
     *
     * **정본 이탈**: DEC-U4-3 은 범위를 `지금 이후`·`오늘 전체` 2종으로 적고 "다일 재계획 없음"이라 한다.
     * 다일은 그대로 금지다(한 세션이 한 날짜만 바꾼다) — 바뀐 것은 그 하루가 **반드시 오늘이어야 하는가**뿐이다.
     * 미래일에는 '지금 이후'가 뜻을 잃으므로 `FULL_DAY` 만 받는다(진입 검증).
     */
    val targetDate: LocalDate,
    /** '지금 이후'의 기준점 — 이 시각 이전 슬롯은 재계획 대상이 아니다. */
    val fromInstant: Instant,
    val origin: ReplanOrigin,
    /** `i10` 의 '왜'(다중). 서버가 어휘를 강제하지 않는다 — 화면이 고른 값을 그대로 싣는다. */
    val reasons: List<String>,
    /** `i10` 의 '어떻게'(다중). */
    val directives: List<String>,
    val freeText: String?,
    /** '건너뛰기'가 채운다 — 재계획 시 후보에서 뺀다. */
    val excludedPoiIds: List<UUID>,
    val status: ReplanStatus,
    /** 산출된 재계획안. 확정 전에는 여기에만 존재한다(INV-U4-05). */
    val draft: Map<String, Any>?,
    val createdAt: Instant,
    val closedAt: Instant?,
    /**
     * 누가 계산을 시작했나(situation-awareness BR-SA-18). [ReplanInitiator.SYSTEM] = 위험 알림 사건으로 서버가 미리 연 세션.
     * **적용은 여전히 사용자만 한다**(INV-U4-05 · INV-SA-1) — 이 칸은 낡음 판정·트리거당 1개·하루 상한의 범위를 가를 뿐이다.
     * 기본값을 두지 않는다 — 재구성(저장소)이 값을 빠뜨리면 컴파일이 막는다(기본값이 있으면 조용히 USER 로 뒤바뀐다).
     */
    val initiatedBy: ReplanInitiator,
    /**
     * 반영 시점의 비교 기준(TRIP-1412) — 반영 **직전** 그 날의 슬롯 표면. 원탭 [다시 짜기]는 초안을 보자마자 반영하므로
     * 사용자가 "무엇이 빠졌나"를 볼 수 있는 때는 반영 뒤뿐이고, 그때 원 일정은 이미 바뀌어 다시 계산할 원본이 없다.
     * 그래서 반영하는 순간 떠서 둔다. 이 기능 이전에 반영된 세션은 null 이다(비교를 지어내지 않는다).
     */
    val appliedBefore: List<ReplanDiff.SlotView>?,
    /** 되돌리기 지점(TRIP-1412) — C8 이 반영하며 돌려준 그 날의 직전 모습([com.trippilot.itinerarygeneration.api.ReplanProposal] map). */
    val restorePoint: Map<String, Any>?,
    /** 이 재계획을 되돌린 시각. 한 번만 된다 — 되돌린 뒤의 되돌리기는 "재계획 다시 적용"이라 그 경로(새 세션)로 간다. */
    val revertedAt: Instant?,
) {
    init {
        // 근거 없는 선계산은 '왜 이 대안인가'를 잃는다 — DB CHECK(chk_replan_session_system_trigger)와 같은 규칙이다.
        require(initiatedBy != ReplanInitiator.SYSTEM || triggerId != null) { "선계산 세션에는 근거 트리거가 있어야 합니다." }
    }

    companion object {
        /** 수집·산출이 이만큼 넘으면 고착으로 본다(파드 재시작) — 앱이 같은 입력으로 다시 요청한다(BR-SA-19). */
        private val STUCK_AFTER: Duration = Duration.ofMinutes(2)

        /** 여행 "오늘"·"지금"은 여행지 기준이다(서버 UTC 아님). */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        fun start(
            tripId: UUID,
            itineraryId: UUID,
            triggerId: UUID?,
            scope: ReplanScope,
            targetDate: LocalDate,
            fromInstant: Instant,
            origin: ReplanOrigin,
            reasons: List<String>,
            directives: List<String>,
            freeText: String?,
            excludedPoiIds: List<UUID>,
            at: Instant,
            /** 말하지 않으면 사용자다 — 종전 진입은 모두 사용자 진입이었다. */
            initiatedBy: ReplanInitiator = ReplanInitiator.USER,
        ) = ReplanSession(
            UUID.randomUUID(), tripId, itineraryId, triggerId, scope, targetDate, fromInstant, origin,
            reasons, directives, freeText, excludedPoiIds,
            ReplanStatus.COLLECTING, null, at, null, initiatedBy,
            appliedBefore = null, restorePoint = null, revertedAt = null,
        )
    }

    /**
     * 낡음(BR-SA-19 · INV-SA-7) — **선계산(SYSTEM)만**, 시간 창이 아니라 사실로 판정한다. 사용자 세션은 늘 null 이다.
     *
     * ① 대상 날이 지났다 → EXPIRED ② 오늘이고 초안이 바꾸는 슬롯의 계획 시작이 지났다 → EXPIRED
     * ③ 그 날 완료한 방문이 초안에 없다 → STALE ④ 대체돼 닫혔다(CANCELED) → STALE.
     * 수집·산출이 [STUCK_AFTER] 를 넘으면 STALE 로 보인다(적용 대상은 아니다 — 초안이 없다).
     *
     * 시각을 다시 추정해 옮기지 않는다(DEC-U4-9) — 낡았으면 거절하고 앱이 새로 계산한다. 시간에 단조다(PBT-SA-16):
     * 날짜가 지나면 ①, 그 날 안에서는 지금 시각이 커질수록 ②가 성립하기 쉬워질 뿐 풀리지 않는다.
     */
    fun stalenessAt(now: Instant, facts: DraftFacts): Staleness? {
        if (initiatedBy != ReplanInitiator.SYSTEM) return null
        return when (status) {
            ReplanStatus.APPLIED -> null // 이미 반영됐다 — 낡음은 적용 전 초안의 말이다
            ReplanStatus.CANCELED -> Staleness.STALE
            else -> {
                val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
                when {
                    targetDate < today -> Staleness.EXPIRED
                    status == ReplanStatus.COLLECTING || status == ReplanStatus.SOLVING ->
                        Staleness.STALE.takeIf { Duration.between(createdAt, now) > STUCK_AFTER }
                    status != ReplanStatus.DRAFT -> null // 대안 없음·실패 — 초안이 없어 날짜만 본다
                    targetDate == today && facts.firstChangeAt?.let { it < LocalTime.ofInstant(now, TRAVEL_ZONE) } == true ->
                        Staleness.EXPIRED
                    facts.completedMissing -> Staleness.STALE
                    else -> null
                }
            }
        }
    }

    fun isStaleAt(now: Instant, facts: DraftFacts): Boolean = stalenessAt(now, facts) != null

    /** 열린 세션인가 — INV-U4-06 의 "최대 1개" 판정 기준이며, DB 부분 유니크 인덱스와 **같은 집합**이어야 한다. */
    val isOpen: Boolean
        get() = status == ReplanStatus.COLLECTING || status == ReplanStatus.SOLVING || status == ReplanStatus.DRAFT

    fun solving(): ReplanSession {
        require(status == ReplanStatus.COLLECTING) { "산출은 COLLECTING 에서만 시작합니다(현재 $status)." }
        return copy(status = ReplanStatus.SOLVING)
    }

    /** 재계획안이 나왔다. 원 일정에는 아직 아무것도 쓰지 않는다(INV-U4-05). */
    fun drafted(draft: Map<String, Any>): ReplanSession {
        require(status == ReplanStatus.SOLVING) { "제안은 SOLVING 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.DRAFT, draft = draft)
    }

    /** 해가 없다 — 조건을 완화해야 한다. 오류(FAILED)와 구분해야 사용자가 할 일을 안다. */
    fun noSolution(at: Instant): ReplanSession {
        require(status == ReplanStatus.SOLVING) { "해 없음은 SOLVING 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.NO_SOLUTION, closedAt = at)
    }

    /** 산출 자체가 실패했다 — 재시도하면 달라질 수 있다. */
    fun failed(at: Instant): ReplanSession {
        require(isOpen) { "실패 표시는 열린 세션에만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.FAILED, closedAt = at)
    }

    /**
     * 확정 — 여기서 비로소 원 일정에 반영된다. 반영 직전의 비교 기준과 되돌리기 지점을 함께 남긴다(TRIP-1412).
     */
    fun applied(at: Instant, before: List<ReplanDiff.SlotView>, restorePoint: Map<String, Any>): ReplanSession {
        require(status == ReplanStatus.DRAFT) { "확정은 DRAFT 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.APPLIED, closedAt = at, appliedBefore = before, restorePoint = restorePoint)
    }

    /** 되돌릴 수 있는 세션인가 — 반영됐고, 아직 안 되돌렸고, 되돌리기 지점이 있다(이 기능 이전 반영분은 없다). */
    val isRevertible: Boolean
        get() = status == ReplanStatus.APPLIED && revertedAt == null && restorePoint != null

    /** 반영한 재계획을 되돌렸다(TRIP-1412). 상태는 APPLIED 그대로다 — 반영이 있었다는 사실은 지우지 않는다. */
    fun reverted(at: Instant): ReplanSession {
        require(isRevertible) { "되돌리기는 되돌리기 지점이 있는 반영 세션에 한 번만 가능합니다(현재 $status, revertedAt=$revertedAt)." }
        return copy(revertedAt = at)
    }

    /** 취소는 **세션만** 닫는다(INV-U4-05). 열린 상태 어디서나 가능하다 — 산출 중 이탈도 취소다. */
    fun canceled(at: Instant): ReplanSession {
        require(isOpen) { "취소는 열린 세션에만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.CANCELED, closedAt = at)
    }
}

/** 재계획 범위(DEC-U4-3). ai `ReplanScope` 어휘를 그대로 쓴다 — 백엔드가 별도 taxonomy 를 만들지 않는다(DEC-U4-4). */
enum class ReplanScope { PARTIAL_SLOTS, FULL_DAY }

enum class ReplanStatus { COLLECTING, SOLVING, DRAFT, APPLIED, CANCELED, FAILED, NO_SOLUTION }

/** 누가 계산을 시작했나 — 사용자 진입 · 위험 알림 사건으로 서버가 미리 연 선계산(BR-SA-18). */
enum class ReplanInitiator { USER, SYSTEM }

/** 낡은 선계산 초안의 거절 사유(BR-SA-19) — 기존 오류 어휘 `ErrorCode.EXPIRED`·`STALE` 와 이름이 같다. */
enum class Staleness { EXPIRED, STALE }

/**
 * 낡음 판정 재료 — 그 날의 사실(BR-SA-19 ②③). 서비스가 지금 일정·초안·방문 실적을 모아 [of] 로 만든다.
 *
 * @property firstChangeAt 초안이 바꾸는 슬롯(추가·삭제·이동)의 계획 시작 중 가장 이른 것. 지금 일정 쪽 시각과 초안 쪽
 *   시각을 둘 다 본다 — 지난 시각에 있던 슬롯을 지우는 초안도, 지난 시각에 새 방문을 넣는 초안도 지난 하루를 다시 쓴다.
 *   바꾸는 것이 없으면 null.
 * @property completedMissing 그 날 완료한 방문 중 초안에 없는 것이 있는가(INV-U4-04 — 적용하면 다녀온 곳이 사라진다).
 */
data class DraftFacts(val firstChangeAt: LocalTime?, val completedMissing: Boolean) {
    companion object {
        /** 초안이 없는 상태(산출 중·대안 없음·닫힘) — 날짜·상태만으로 판정한다. */
        val NONE = DraftFacts(null, false)

        private val CHANGES = setOf(ReplanDiff.Change.ADDED, ReplanDiff.Change.REMOVED, ReplanDiff.Change.MOVED)

        /**
         * [before] = 그 날의 지금 일정, [after] = 초안, [completedSlotKeys] = 여행의 완료 슬롯 키(`{date}#{poiId}`).
         * 무엇이 '바뀐 슬롯'인지는 전후 비교([ReplanDiff])와 같은 판정이다 — 두 곳이 다른 말을 하면 화면의 비교와 거절이 어긋난다.
         */
        fun of(date: LocalDate, before: List<ReplanDiff.SlotView>, after: List<ReplanDiff.SlotView>, completedSlotKeys: Collection<String>): DraftFacts {
            val changed = ReplanDiff.of(before, after).entries.filter { it.change in CHANGES }
            val inDraft = after.map { it.slotKey }.toSet()
            return DraftFacts(
                firstChangeAt = changed.flatMap { listOfNotNull(it.beforeStart, it.afterStart) }.minOrNull(),
                completedMissing = completedSlotKeys.any { it.substringBefore('#') == date.toString() && it !in inDraft },
            )
        }
    }
}

/**
 * 출발 기준점(정본 §5 사다리). GPS 가 없으면 수동 핀 → 마지막 방문지 → 숙소 순으로 내려간다.
 * 어느 단계에서 왔는지 남기는 이유: 화면이 "추정 출발지"임을 밝혀야 하기 때문이다(US-PLANB-10).
 */
data class ReplanOrigin(val kind: OriginKind, val lat: Double?, val lng: Double?) {
    init {
        // GPS·수동은 좌표가 있어야 뜻이 있다. 나머지는 서버가 유도하므로 좌표 없이 올 수 있다.
        require(kind !in COORD_REQUIRED || (lat != null && lng != null)) {
            "$kind 기준점에는 좌표가 필요합니다."
        }
    }

    /** 사용자에게 "추정 출발지"로 밝혀야 하는가 — GPS 가 아니면 전부 추정이다. */
    val isEstimated: Boolean get() = kind != OriginKind.GPS

    private companion object {
        private val COORD_REQUIRED = setOf(OriginKind.GPS, OriginKind.MANUAL)
    }
}

/** [PURGED] = 위치 동의 철회로 좌표가 파기됨(TRIP-992) — 원래 GPS/MANUAL 이었다는 사실만 남는다. */
enum class OriginKind { GPS, MANUAL, LAST_VISIT, STAY_ANCHOR, PURGED }

interface ReplanSessionRepository {
    fun save(session: ReplanSession): ReplanSession

    /**
     * 위치 동의 철회 파기(TRIP-992 · INV-L4) — 저장된 GPS·MANUAL 기준점 좌표를 지우고
     * kind 를 PURGED 로 바꾼다. 지운 행 수를 돌려준다(파기 로그의 건수가 된다).
     */
    fun purgeOrigins(tripIds: List<UUID>): Int

    fun findById(sessionId: UUID): ReplanSession?

    /**
     * 열린 세션(COLLECTING·SOLVING·DRAFT)을 **행 잠금**으로 읽는다 — INV-U4-06 판정 입력이자 그 세션을 닫는 쪽(시작·선계산)의 읽기.
     * 잠금 없이 읽어 두었다가 닫으면 그 사이 사용자가 적용한 세션을 CANCELED 로 덮는다(행 통째 UPDATE). 잠그면 상대의 커밋을
     * 기다린 뒤 다시 보고, 이미 닫혔으면 없는 것으로 답한다. 트랜잭션 안에서, 그 세션을 처음 읽는 자리에서 부른다
     * (먼저 읽어 둔 행은 잠가도 영속성 컨텍스트의 옛 값이 돌아온다).
     */
    fun findOpenByTripForUpdate(tripId: UUID): ReplanSession?

    /**
     * **행 잠금**으로 읽는다 — 산출(비동기)과 취소·재진입이 같은 세션을 두고 경합한다.
     * 잠금 없이 "읽고→검사하고→쓰면" 그 사이에 취소가 끼어들어 **닫힌 세션이 초안으로 되살아난다**
     * (실측: 취소 직후 두 번째 취소가 409 대신 200 이 됐고, 재진입에서는 열린 세션이 둘이 되어
     * 부분 유니크 인덱스 위반으로 터졌다).
     */
    fun findByIdForUpdate(sessionId: UUID): ReplanSession?

    /** 그 트리거로 연 선계산 세션 — 트리거당 1개다(`ux_replan_session_system_trigger` · 아웃박스 재배달 멱등). */
    fun findSystemByTrigger(triggerId: UUID): ReplanSession?

    /** 그 날짜의 가장 최근 선계산 세션(닫힌 것 포함) — 앱이 알림의 날짜로 준비된 대안을 찾는다(BR-SA-23). */
    fun findLatestSystem(tripId: UUID, targetDate: LocalDate): ReplanSession?

    /** [since] 이후 연 선계산 세션 수 — 하루 상한(BR-SA-18). [tripId] 가 null 이면 전체. */
    fun countSystemSince(tripId: UUID?, since: Instant): Int
}
