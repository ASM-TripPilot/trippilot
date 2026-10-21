package com.trippilot.reflection.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 카드 한 장(**DEC-U5-14**).
 *
 * **백엔드는 카드 내부를 모델링하지 않는다.** [payload] 는 상대가 만든 카드 원문(JSON)이고 우리는
 * 해석하지 않는다 — 우리가 `cover`/`scenes` 안쪽을 재검증하면 상대가 템플릿을 하나 늘릴 때마다
 * 우리 마이그레이션이 된다. [templateId]·[format] 이 그 버전 키다.
 *
 * 우리가 아는 것은 [title]·[subtitle] 뿐이다 — 목록 화면이 짧은 문구를 필요로 하기 때문이다.
 * 값은 어댑터가 `cover` 에서 뽑아 넣는다(도메인은 JSON 을 파싱하지 않는다 — 프레임워크 무의존, R2).
 */
data class ReflectionCard(
    val templateId: String,
    val format: String,
    val title: String,
    val subtitle: String,
    val payload: String,
) {
    init {
        // PBT-U5-F1 — 표시본 카드는 비어 있을 수 없다. **장면 개수는 조건이 아니다**:
        // 방문 0곳인 기본 카드는 근거가 없어 장면을 만들 수 없고, 요구하면 지어내야 한다(BR-U5-31 환각 금지).
        require(title.isNotBlank()) { "회고 카드 제목은 비어 있을 수 없습니다(PBT-U5-F1)." }
        require(payload.isNotBlank()) { "회고 카드 원문은 비어 있을 수 없습니다(INV-U5-07)." }
    }
}

/**
 * 회고 한 장(U5 정본 §4.1) — 하루 하나(BR-U5-35).
 *
 * **초안과 수정본을 나눠 둔다**(INV-U5-06). 사용자가 고친 카드로 초안을 덮으면 "무엇이 생성됐고
 * 무엇을 사람이 바꿨나"가 사라지고, 화면의 2열 비교가 성립하지 않는다.
 * 편집 단위는 **카드 통째**다(BR-U5-35 · 2026-09-01) — 장면·캡션 단위는 화면이 정해진 뒤에 정한다.
 */
data class Reflection(
    val reflectionId: UUID,
    val tripId: UUID,
    val dayDate: LocalDate,
    val draftCard: ReflectionCard,
    val editedCard: ReflectionCard?,
    val source: ReflectionSource,
    val stats: ReflectionStats,
    val generatedAt: Instant,
    val updatedAt: Instant,
    /**
     * 그날의 기분·한 줄 메모(TRIP-828) — **카드와 별개인 사용자 입력**이라 null 이 정상이다(INV-U5-07 밖).
     *
     * U5 정본(§4.1)에는 없는 필드다. 화면(j03 · Figma)이 받는데 저장할 자리가 없어 프론트가 입력을
     * 아예 빼 두고 있었다 — 다시 들어오면 사라지는 입력이었기 때문이다.
     */
    val mood: String? = null,
    val shortMemo: String? = null,
) {
    /** 화면이 보여 줄 카드 — 고친 것이 있으면 그것, 없으면 초안. */
    val card: ReflectionCard get() = editedCard ?: draftCard

    /**
     * 기분·한 줄을 남긴다. **null 은 "그대로", 빈 문자열은 "지운다"** — 둘을 한 값으로 뭉치면
     * 메모만 고치는 요청이 기분을 지운다.
     *
     * [mood] 를 닫힌 enum 으로 두지 않았다: 값 집합의 정본은 화면(Figma)이고 백엔드는 그것을 못 본다.
     * 다만 **자유 문장은 막는다**(코드 모양만) — 열어 두면 60자 상한이 걸린 메모 옆에 상한 없는 두 번째
     * 메모 칸이 생긴다. 집합이 굳으면 그때 좁힌다(넓히는 것은 쉽고 좁히는 것은 마이그레이션이다).
     */
    fun note(mood: String?, shortMemo: String?, at: Instant): Reflection {
        // 앞뒤 공백은 글자 수에 넣지 않는다 — 화면에 안 보이는 것으로 60자를 깎으면 사용자가 이유를 모른다.
        val memo = shortMemo?.trim()
        val errors = buildList {
            if (!mood.isNullOrEmpty() && !MOOD_CODE.matches(mood)) {
                add(FieldError("mood", "영문·숫자·밑줄·하이픈 ${MOOD_MAX}자 이내의 코드여야 합니다"))
            }
            // DB 의 varchar(60) 은 **문자** 수를 센다 — `length`(UTF-16 단위)로 재면 이모지가 둘로 세어진다.
            if (memo != null && memo.codePointCount(0, memo.length) > SHORT_MEMO_MAX) {
                add(FieldError("shortMemo", "${SHORT_MEMO_MAX}자를 넘을 수 없습니다"))
            }
            // **한 줄**이다 — 줄바꿈·탭을 받으면 화면의 한 줄 자리가 깨진다. NUL 은 더 나쁘다:
            // PostgreSQL 이 text 에 거부해 400 이어야 할 입력이 500 으로 나간다.
            // 줄·문단 구분자(U+2028·2029)도 줄바꿈이고, 짝 없는 서로게이트는 UTF-8 로 못 옮겨 저장에서 터진다.
            if (memo != null && memo.codePoints().anyMatch { Character.getType(it).toByte() in ONE_LINE_FORBIDDEN }) {
                add(FieldError("shortMemo", "줄바꿈·제어 문자는 쓸 수 없습니다"))
            }
        }
        if (errors.isNotEmpty()) throw ValidationFailed(errors)
        return copy(
            mood = if (mood == null) this.mood else mood.ifEmpty { null },
            shortMemo = if (memo == null) this.shortMemo else memo.ifEmpty { null },
            updatedAt = at,
        )
    }

    fun edit(card: ReflectionCard, at: Instant): Reflection = copy(editedCard = card, updatedAt = at)

    /** 수정본을 비우면 초안 카드로 돌아간다(frontend-components §검증 — BR-U5-35). */
    fun clearEdit(at: Instant): Reflection = copy(editedCard = null, updatedAt = at)

    /**
     * 초안을 다시 만든다 — **수정본은 건드리지 않는다**(INV-U5-06 · TRIP-553).
     *
     * INV-U5-06 은 "수정이 초안을 덮지 않는다"로 읽히지만 **반대 방향도 같은 규칙이다.**
     * 재생성이 매번 새 행을 만들어 얹으면 `edited_card` 가 null 로 덮여 **사용자가 쓴 것이
     * 사라진다.** 초안이 사라지는 것보다 나쁘다 — 초안은 다시 만들 수 있지만 사용자가 고친 카드는
     * 어디에도 없다.
     *
     * `generatedAt` 도 그대로다: "언제 처음 만들어졌나"는 재생성으로 바뀌는 사실이 아니다.
     */
    fun regenerate(draft: ReflectionCard, source: ReflectionSource, stats: ReflectionStats, at: Instant): Reflection =
        copy(draftCard = draft, source = source, stats = stats, updatedAt = at)

    companion object {
        fun of(
            tripId: UUID,
            dayDate: LocalDate,
            draft: ReflectionCard,
            source: ReflectionSource,
            stats: ReflectionStats,
            at: Instant,
        ) = Reflection(UUID.randomUUID(), tripId, dayDate, draft, null, source, stats, at, at)

        const val MOOD_MAX = 20
        const val SHORT_MEMO_MAX = 60
        private val ONE_LINE_FORBIDDEN = setOf(
            Character.CONTROL, Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR, Character.SURROGATE,
        )
        private val MOOD_CODE = Regex("[A-Za-z0-9_-]{1,$MOOD_MAX}")
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

    /** 잠그지도 싣지도 않고 있는지만 본다 — 잠그기 전에 행을 실어 두면 잠근 뒤에도 그 옛 값이 읽힌다. */
    fun exists(tripId: UUID, dayDate: LocalDate): Boolean

    /**
     * **고치려고** 읽는다 — 행을 잠근다. 쓰기는 행 전체를 덮으므로(카드·기분·한 줄), 잠그지 않고 읽으면
     * 겹친 두 요청이 같은 옛 값을 읽고 나중 쪽이 먼저 쪽의 필드를 되돌린다(TRIP-828).
     */
    fun findForUpdate(tripId: UUID, dayDate: LocalDate): Reflection?

    /**
     * **초안을 갈아끼우려고** 잠그고 읽는다 — [findForUpdate] 와 같되, 저장된 초안·출처 대신 [draft]·[source] 를 얹어 읽는다.
     * 갈아끼울 값이라 저장된 것을 읽을 필요가 없고, 그래서 초안·출처를 못 읽는 하루([UnreadableDraft])도 다시 만들면 낫는다 —
     * 수정본·기분·메모·최초 생성 시각은 저장된 그대로 실린다(TRIP-553). 수정본을 못 읽으면 [findForUpdate] 처럼 거절한다.
     */
    fun findForRedraft(tripId: UUID, dayDate: LocalDate, draft: ReflectionCard, source: ReflectionSource): Reflection?

    fun findByTrip(tripId: UUID): List<Reflection>
}

/**
 * 그 하루의 **초안·출처를** 못 읽는다(TRIP-1476 — 손상·수동 변경·이 버전이 모르는 단). 사용자가 쓴 것(수정본·기분·메모)은 읽혔다 —
 * 초안을 다시 만들면([ReflectionRepository.findForRedraft]) 낫는다. 수정본을 못 읽는 하루는 이것이 아니라 409(`REFLECTION_UNREADABLE`)다.
 */
class UnreadableDraft(message: String) : IllegalArgumentException(message)
