package com.trippilot.planbdetection.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 감지 기록(C9 · 정본 §2.1). **발화하지 않은 판정도 남긴다** —
 * "왜 알림이 안 왔나"를 답하려면 억제됐는지·영향이 없다고 봤는지가 서로 다른 사실로 남아야 한다.
 *
 * **INV-U4-01**: `shouldReplan=false` 인 판정은 사용자에게 어떤 형태로도 노출되지 않는다.
 * **BR-U4-09**: 트리거는 제안까지만 한다 — 어떤 트리거도 일정을 자동으로 바꾸지 않는다.
 */
data class PlanBTrigger(
    val triggerId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    val kind: TriggerKind,
    val affectedDate: LocalDate,
    /** 영향받는 슬롯의 경계 키. 날짜 전체 영향이면 null. */
    val slotKey: String?,
    /** 직렬화 가능 원시값만(ai 규약). 예: `{"pop":70}` · `{"delayMin":18}` */
    val payload: Map<String, Any>,
    val shouldReplan: Boolean,
    val scope: TriggerScope?,
    val reason: String,
    val state: TriggerState,
    val detectedAt: Instant,
    /** 위험(일정을 막는다 — 푸시 대상)·주의(앱 안에만). 열 하나에만 둔다 — payload 에 겹쳐 적지 않는다. */
    val severity: TriggerSeverity = TriggerSeverity.RISK,
    /** 이 행을 실은 알림 사건의 최고 심각도. null = 조용한 발화(배너만)·무발화 — 같은 대상·같은 심각도로 두 번 알리지 않는 근거. */
    val alertedSeverity: TriggerSeverity? = null,
    /** 푸시 대상 사건의 대표였던 시각 — 여행·하루(KST) 푸시 상한을 센다. */
    val pushedAt: Instant? = null,
    /** 낙관적 잠금 판. null = 아직 저장 안 된 행(저장소가 INSERT 와 UPDATE 를 이것으로 가른다). */
    val version: Long? = null,
) {
    companion object {
        /** payload 키 — 한 키 한 뜻(CD5). 심각도는 열이라 여기 없다. */
        const val PAYLOAD_VARIANT = "variant"
        const val PAYLOAD_DETECTOR = "detector"
        const val PAYLOAD_DATA_SOURCE = "dataSource"
        const val PAYLOAD_POI_IDS = "poiIds"
        /** 장소 신호의 대상 POI(domain-entities §3.4) — 날씨의 [PAYLOAD_POI_IDS] 와 다른 키다. */
        const val PAYLOAD_POI_ID = "poiId"
        /** 날씨의 영향 범위(`MOST`·`SOME` — situation-awareness domain-entities §3.4). 감지기가 싣고 사건 항목이 옮긴다. */
        const val PAYLOAD_COVERAGE = "coverage"
        /** 발화한다 — 사용자에게 배너로 보인다. */
        fun active(
            tripId: UUID, itineraryId: UUID, kind: TriggerKind, affectedDate: LocalDate, slotKey: String?,
            payload: Map<String, Any>, scope: TriggerScope, reason: String, at: Instant,
            severity: TriggerSeverity = TriggerSeverity.RISK,
        ): PlanBTrigger {
            // 발화했는데 범위가 NONE 이면 모순이다 — 배너는 뜨는데 [대안 보기] 가 열 세션의 범위를 못 정한다.
            // 재계획 세션의 범위는 PARTIAL_SLOTS·FULL_DAY 뿐이라 NONE 을 옮길 자리가 없다.
            require(scope != TriggerScope.NONE) { "발화하는 트리거의 범위는 NONE 일 수 없습니다." }
            return PlanBTrigger(
                UUID.randomUUID(), tripId, itineraryId, kind, affectedDate, slotKey, payload,
                shouldReplan = true, scope = scope, reason = reason, state = TriggerState.ACTIVE, detectedAt = at,
                severity = severity,
            )
        }

        /**
         * 판정은 했으나 발화하지 않는다. 억제(INV-U4-02) 또는 영향 없음(BR-U4-06)이 그 이유다.
         * [shouldReplan] 을 false 로 두는 것이 핵심 — ACTIVE 로 남으면 화면에 노출된다(DB CHECK 도 막는다).
         */
        fun silent(
            tripId: UUID, itineraryId: UUID, kind: TriggerKind, affectedDate: LocalDate, slotKey: String?,
            payload: Map<String, Any>, reason: String, state: TriggerState, at: Instant,
            severity: TriggerSeverity = TriggerSeverity.RISK,
        ): PlanBTrigger {
            require(state != TriggerState.ACTIVE) { "발화하지 않는 판정은 ACTIVE 일 수 없습니다." }
            return PlanBTrigger(
                UUID.randomUUID(), tripId, itineraryId, kind, affectedDate, slotKey, payload,
                shouldReplan = false, scope = TriggerScope.NONE, reason = reason, state = state, detectedAt = at,
                severity = severity,
            )
        }
    }

    /** 변형(CD6) — payload["variant"] 에 둔다(열을 늘리지 않는다). 모르는 값이면 null — 응답도 null, 화면은 kind 라벨. */
    val variant: TriggerVariant? get() = TriggerVariant.of(payload[PAYLOAD_VARIANT] as? String)

    /** 해제 자격(CD5) — 이 트리거를 띄운 스윕 출처. 없으면(날씨 확인·U10·옛 행) 시간·일정 만료로만 닫힌다. */
    val detector: String? get() = payload[PAYLOAD_DETECTOR] as? String

    /** 원천(CD5) — 화면 출처 표기(`attribution`)의 재료. */
    val dataSource: String? get() = payload[PAYLOAD_DATA_SOURCE] as? String

    /** 영향 POI(선계산 재료 `dateRisks.poiIds`). payload 에 없으면 슬롯 키(`{date}#{poiId}`)의 POI, 날짜 전체면 없음. */
    val poiIds: List<String>
        get() = (payload[PAYLOAD_POI_IDS] as? List<*>)?.filterIsInstance<String>()
            ?: listOfNotNull(slotKey?.substringAfter('#', "")?.takeIf { it.isNotEmpty() })

    /** 날씨 영향 범위(G-SA-11) — 선계산 재료 `dateRisks.coverage`. 없으면 null. */
    val coverage: String? get() = payload[PAYLOAD_COVERAGE] as? String

    /** 대상(규칙 6) — (kind, 영향 날짜, 슬롯). 대상당 ACTIVE 는 1개다(`ux_plan_b_trigger_active`). */
    val target: TriggerLifecycle.Target get() = TriggerLifecycle.Target(kind, affectedDate, slotKey)

    /** 재계획 확정에 쓰였다 — 같은 신호로 다시 알리지 않는다. */
    fun consumed() = copy(state = TriggerState.CONSUMED)

    /** 대상 슬롯이 지났다 — 더는 유효하지 않다(BR-U4-06). */
    fun expired() = copy(state = TriggerState.EXPIRED)
}

/**
 * BR-U4-01 — **4종뿐이다.** ai `TriggerKind` 가 정본이며 백엔드가 종류를 늘리지 않는다(DEC-U4-4).
 * '체류 초과'는 [DELAY] 의 payload 변형이고, '교통'은 존재하지 않는다.
 */
enum class TriggerKind { WEATHER, CLOSURE, DELAY, MANUAL }

/** ai `ReplanScope` 그대로. 발화하지 않는 판정은 [NONE]. */
enum class TriggerScope { FULL_DAY, PARTIAL_SLOTS, NONE }

enum class TriggerState { ACTIVE, SUPPRESSED, CONSUMED, EXPIRED }

/**
 * 심각도 — 위험(일정을 막는다, 푸시 대상)·주의(앱 안에만). 기회(행사·인기)는 심각도가 아니라 트리거 밖이다.
 * 비교는 [rank] 로 한다 — enum 선언 순서에 기대지 않는다.
 */
enum class TriggerSeverity(val rank: Int) {
    RISK(2), CAUTION(1);

    /** [other] 보다 무거운가. 아직 알린 적 없음(null)보다는 늘 무겁다. */
    fun isAbove(other: TriggerSeverity?): Boolean = other == null || rank > other.rank
}

/**
 * 변형 — 닫힌 12종(CD6 · C9 소유 → openapi enum → FE codegen). 종류(4종)는 늘리지 않는다(DEC-U4-4).
 * 특보는 기존 변형으로 사상한다 — 호우 RAIN · 대설 SNOW · 강풍·태풍 WIND · 한파 COLD · 폭염 HEAT · 황사 DUST.
 * DELAY 의 OVERSTAY·TRANSIT 은 U10 이 이 enum 에 더한다.
 */
enum class TriggerVariant(val kind: TriggerKind) {
    RAIN(TriggerKind.WEATHER), SNOW(TriggerKind.WEATHER), WIND(TriggerKind.WEATHER), HEAT(TriggerKind.WEATHER),
    COLD(TriggerKind.WEATHER), CLOUD(TriggerKind.WEATHER), DUST(TriggerKind.WEATHER),
    CLOSED_DAY(TriggerKind.CLOSURE), OUT_OF_HOURS(TriggerKind.CLOSURE), HOURS_MISMATCH(TriggerKind.CLOSURE),
    HOLIDAY(TriggerKind.CLOSURE), PERMANENTLY_CLOSED(TriggerKind.CLOSURE),
    ;

    companion object {
        /** 저장된 문자열 → 변형. 모르는 값(옛 행·다른 판)은 null — 지어내지 않는다. */
        fun of(raw: String?): TriggerVariant? = entries.firstOrNull { it.name == raw }
    }
}

/** 스윕 출처 이름(CD5 `payload.detector` — 해제 자격). 감시 상태 묶음: 날씨 = [KMA_FORECAST], 휴무 = [PLACE]. */
object SweepSource {
    const val KMA_FORECAST = "kma-forecast"
    const val KMA_WARNING = "kma-warning"
    const val AIRKOREA = "airkorea"
    const val PLACE = "place"

    /** 닫힌 집합(domain-entities §6.1) — 설정의 출처·관찰 전용 목록은 이 안의 이름만 받는다. */
    val ALL: Set<String> = setOf(KMA_FORECAST, KMA_WARNING, AIRKOREA, PLACE)
}

/**
 * 원천 이름(CD5 `payload.dataSource`) — 감지기가 쓰고 응답 `attribution` 이 읽는다.
 * 표기 문구는 공공누리 표시 의무가 있는 기상 원천만 갖는다(BR-SA-24) — 장소 원천(AI 검증·장소 상태)은 표기 없이 원천만 남긴다.
 */
object DataSource {
    const val KMA_VILAGE = "KMA_VILAGE"
    const val KMA_WARNING = "KMA_WARNING"
    const val AIRKOREA = "AIRKOREA"
    /** 장소 — AI 하루 검증의 영업시간 위반(HC1). */
    const val AI_VALIDATE = "AI_VALIDATE"
    /** 장소 — POI 상태 `CLOSED`(폐업). */
    const val PLACE_STATUS = "PLACE_STATUS"
}

/** 억제 레코드(정본 §2.2). `[끄기]` 는 화면에서 배너를 감추는 게 아니라 이 행을 만든다(BR-U4-15). */
data class Suppression(
    val suppressionId: UUID,
    val tripId: UUID,
    val kind: TriggerKind,
    val slotKey: String?,
    val scopeType: SuppressionScope,
    val suppressedAt: Instant,
    /** 없으면 여행 종료까지. */
    val expiresAt: Instant?,
    /** 끈 트리거의 날짜(DAY 범위의 날짜). null = 옛 행 — 날짜를 가리지 않는다. */
    val affectedDate: LocalDate? = null,
    /** 이 심각도 이하만 덮는다. null = 전부(옛 행 동작 그대로). */
    val maxSeverity: TriggerSeverity? = null,
) {
    init {
        require(scopeType != SuppressionScope.SLOT || slotKey != null) {
            "슬롯 범위 억제에는 대상 슬롯이 필요합니다."
        }
    }

    /** 이 억제가 지금 유효한가. 만료된 억제는 없는 것과 같다(BR-U4-07 "억제가 만료되면 재발화"). */
    fun isEffectiveAt(at: Instant): Boolean = expiresAt == null || at < expiresAt

    /**
     * 이 신호를 덮는가(규칙 10) — 같은 kind ∧ (SLOT: 같은 슬롯 / DAY: 같은 날짜 / TRIP: 전부) ∧ 심각도 ≤ [maxSeverity].
     * 주의를 끈 것이 같은 날 위험 격상을, 오늘을 끈 것이 내일 대상을 막지 않는다.
     * 날짜·심각도가 없는 옛 행은 전부를 덮는다(종전 동작 — 날짜는 [expiresAt] 이 끊었다).
     */
    fun covers(kind: TriggerKind, slotKey: String?, affectedDate: LocalDate, severity: TriggerSeverity): Boolean =
        this.kind == kind &&
            when (scopeType) {
                SuppressionScope.SLOT -> this.slotKey == slotKey
                SuppressionScope.DAY -> this.affectedDate == null || this.affectedDate == affectedDate
                SuppressionScope.TRIP -> true
            } &&
            (maxSeverity == null || severity.rank <= maxSeverity.rank)

    companion object {
        fun of(
            tripId: UUID, kind: TriggerKind, slotKey: String?, scopeType: SuppressionScope, at: Instant,
            expiresAt: Instant? = null, affectedDate: LocalDate? = null, maxSeverity: TriggerSeverity? = null,
        ) = Suppression(UUID.randomUUID(), tripId, kind, slotKey, scopeType, at, expiresAt, affectedDate, maxSeverity)
    }
}

enum class SuppressionScope { SLOT, DAY, TRIP }

/**
 * 알림 민감도. [dailyCap] 은 **여행·하루(KST) 푸시 상한** — 푸시 대상 사건의 대표가 될 수 있는 수다(규칙 11).
 * 넘어도 사건·알림함·배너는 남는다(push=false). 값(코드 2·5·10 vs NFR 1·3·6)은 설계서 UQ9 — 코드값 유지.
 */
enum class Sensitivity(val dailyCap: Int) {
    LOW(2), NORMAL(5), HIGH(10)
}

interface PlanBTriggerRepository {
    fun save(trigger: PlanBTrigger): PlanBTrigger

    fun findById(triggerId: UUID): PlanBTrigger?

    /** 발화 중인 것만 — INV-U4-01 때문에 화면에는 이것만 나간다. */
    fun findActiveByTrip(tripId: UUID): List<PlanBTrigger>

    /** 그 날짜들의 행 전부(상태 무관) — 알린 최고 심각도·연일 반복·무발화 중복 판정의 근거. */
    fun findByTripOn(tripId: UUID, dates: Collection<LocalDate>): List<PlanBTrigger>

    /** 그 날(KST) 푸시 대상 사건의 대표였던 수(`pushed_at`) — 하루 푸시 상한의 입력. */
    fun countPushedOn(tripId: UUID, date: LocalDate): Int
}

interface SuppressionRepository {
    fun save(suppression: Suppression): Suppression

    fun findByTrip(tripId: UUID): List<Suppression>
}

interface SensitivityRepository {
    /** 없으면 [Sensitivity.NORMAL] — 설정이 없다고 알림이 멈추면 안 된다. */
    fun of(accountId: UUID): Sensitivity

    /** 계정당 1행 upsert. 되돌릴 수 있어야 하므로 단방향이 아니다. */
    fun set(accountId: UUID, sensitivity: Sensitivity): Sensitivity
}

/**
 * 감시 상태 — (여행, 출처)의 마지막 관측(plan_b_watch). 스윕이 쓰고 GET /triggers 의 `watch` 가 읽는다.
 * [checkedAt] 은 이 상태를 관측한 시각이다.
 */
data class PlanBWatch(val tripId: UUID, val source: String, val status: WatchStatus, val checkedAt: Instant)

/** 관측 결과. '꺼짐(OFF)'은 저장하지 않는다 — 설정에서 그때그때 읽는다. */
enum class WatchStatus { CHECKED, UNKNOWN }

interface PlanBWatchRepository {
    /** (여행, 출처)당 1행 — 있으면 덮는다. */
    fun upsert(watch: PlanBWatch)

    fun findByTrip(tripId: UUID): List<PlanBWatch>
}
