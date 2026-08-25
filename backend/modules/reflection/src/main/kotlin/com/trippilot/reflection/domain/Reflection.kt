package com.trippilot.reflection.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 한 장(U5 정본 §4.1) — 하루 하나(BR-U5-35).
 *
 * **초안과 수정본을 나눠 둔다**(INV-U5-06). 사용자가 고친 문장으로 초안을 덮으면 "무엇이 생성됐고
 * 무엇을 사람이 바꿨나"가 사라지고, 화면의 2열 비교가 성립하지 않는다.
 */
data class Reflection(
    val reflectionId: UUID,
    val tripId: UUID,
    val dayDate: LocalDate,
    val draftNarrative: String,
    val editedNarrative: String?,
    val source: ReflectionSource,
    val stats: ReflectionStats,
    val generatedAt: Instant,
    val updatedAt: Instant,
) {
    init {
        require(draftNarrative.isNotBlank()) { "회고 본문은 비어 있을 수 없습니다(INV-U5-07)." }
    }

    /** 화면이 보여 줄 문장 — 고친 것이 있으면 그것, 없으면 초안. */
    val narrative: String get() = editedNarrative ?: draftNarrative

    fun edit(text: String, at: Instant): Reflection {
        require(text.isNotBlank()) { "수정본은 비어 있을 수 없습니다." }
        return copy(editedNarrative = text.trim(), updatedAt = at)
    }

    /**
     * 초안을 다시 만든다 — **수정본은 건드리지 않는다**(INV-U5-06 · TRIP-553).
     *
     * INV-U5-06 은 "수정이 초안을 덮지 않는다"로 읽히지만 **반대 방향도 같은 규칙이다.**
     * 재생성이 매번 새 행을 만들어 얹으면 `edited_narrative` 가 null 로 덮여 **사용자가 쓴 글이
     * 사라진다.** 초안이 사라지는 것보다 나쁘다 — 초안은 다시 만들 수 있지만 사용자의 문장은
     * 어디에도 없다.
     *
     * `generatedAt` 도 그대로다: "언제 처음 만들어졌나"는 재생성으로 바뀌는 사실이 아니다.
     */
    fun regenerate(draft: String, source: ReflectionSource, stats: ReflectionStats, at: Instant): Reflection =
        copy(draftNarrative = draft, source = source, stats = stats, updatedAt = at)

    companion object {
        fun of(
            tripId: UUID,
            dayDate: LocalDate,
            draft: String,
            source: ReflectionSource,
            stats: ReflectionStats,
            at: Instant,
        ) = Reflection(UUID.randomUUID(), tripId, dayDate, draft, null, source, stats, at, at)
    }
}

/**
 * 문장이 어느 단에서 나왔나(BR-U5-32·33).
 *
 * 폴백은 3단이다 — AI → 규칙 → 기본 카드. **어느 단에서 멈춰도 빈 화면을 그리지 않는다.**
 * 값을 응답에 항상 싣는 이유는 품질 관측이다: 규칙 문장이 몇 %인지 모르면 AI 를 붙일 근거가 없다.
 */
enum class ReflectionSource { AI, RULE, BASIC }

/**
 * 근거 수치(INV-U5-07) — **비어 있을 수 없다.** 방문 0곳이어도 0으로 채운다.
 * 기본 카드는 이 값만으로 그려진다.
 *
 * @property distanceSource `ROUTE` | `VISIT_LINE`. 1차는 방문점 연결선 근사다(BR-U5-43) —
 *   `actual_route_point` 가 미실장이라 서버가 실제 이동 경로를 모른다. **어느 쪽인지 밝히지 않으면
 *   사용자가 근사값을 실측으로 읽는다.**
 * @property avgDwellMinutes **여기 없다.** 개별·일별 체류는 화면에 나가지 않는다(BR-U5-08).
 *   누적 통계의 평균 체류만 예외이고 그것은 스타일 분석 소관이다(BR-U5-08a).
 */
data class ReflectionStats(
    val visitCount: Int,
    val distanceKm: Double,
    val distanceSource: DistanceSource,
    val photoCount: Int,
) {
    init {
        require(visitCount >= 0 && photoCount >= 0) { "근거 수치는 음수일 수 없습니다." }
        require(distanceKm >= 0.0) { "이동 거리는 음수일 수 없습니다." }
    }

    companion object {
        /** 아무 근거도 없을 때. **이것이 있어야 기본 카드가 성립한다**(BR-U5-32 3단). */
        fun empty() = ReflectionStats(0, 0.0, DistanceSource.VISIT_LINE, 0)
    }
}

/** 거리의 출처(BR-U5-43). 근사와 실측을 계약에서 가른다. */
enum class DistanceSource { ROUTE, VISIT_LINE }

/** 회고 영속 포트. */
interface ReflectionRepository {
    /** 하루 한 장 — 있으면 덮고 없으면 만든다. UNIQUE `(trip_id, day_date)` 가 그것을 보장한다. */
    fun upsert(reflection: Reflection): Reflection

    fun find(tripId: UUID, dayDate: LocalDate): Reflection?

    fun findByTrip(tripId: UUID): List<Reflection>
}
