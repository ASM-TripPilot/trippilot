package com.trippilot.reflection.application

import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.profile.api.overriddenBy
import com.trippilot.reflection.domain.port.ReflectionEvent
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.destinationOn
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 AI 요청의 재료(TRIP-1463) — 그날 지역 · 사용자 성향 한 줄 · 그날 있었던 일.
 *
 * 하루 회고([ReflectionService])가 쓰고, 여행 요약 회고(TRIP-1488)가 같은 재료를 여행 전체로 쓴다 — 그래서 서비스 밖에 둔다.
 *
 * **재료를 못 구하면 비운다 — 회고를 막지 않는다.** 상대는 빈 값을 "(요약 없음)"·"(이벤트 없음)"으로 받고 그 줄을 쓰지 않는다.
 * 대신 못 구한 사실은 로그로 남긴다(INV-4 침묵 금지).
 *
 * **트랜잭션 밖에서 부른다**(호출자 몫 — [ReflectionService] 는 쓰기 트랜잭션을 열기 전에 재료를 구한다). 쓰기 트랜잭션에 참여한 채 조회가
 * 실패하면 `runCatching` 으로 잡아도 그 트랜잭션이 rollback-only 가 되고(PG 는 SQL 오류 뒤 그 트랜잭션의 문장을 전부 거절한다) 회고 저장까지
 * 무너진다. 밖에서 부르면 각 퍼사드가 자기 읽기 트랜잭션을 열고 닫으므로 실패가 그 조회 안에서 끝나고, 커넥션도 한 번에 하나만 쓴다.
 *
 * **날씨는 싣지 않는다**(`weather_summary` 는 계속 빈 값). weather-context 가 저장하는 것은 **예보**뿐이다 — `weather_snapshot` 은
 * 묻는 날의 최대 강수확률(발표분마다), `weather_grid_forecast` 는 격자당 최신 발표분 한 행(지난 시각은 덮인다). 그날 실제로 어땠는지는
 * 어디에도 없고, `WEATHER_MODE=fake` 에서 쓴 해시 값도 같은 표에 섞인다. 예보를 "그날 날씨"로 넘기면 상대가 "비가 내린 날"이라 쓰는데,
 * 그것은 근거 밖 문장이다(BR-U5-31). 관측값 저장이 생기면 그때 채운다.
 */
@Component
class ReflectionMaterials(
    private val preferences: PreferenceFacade,
    private val changeLogs: ChangeLogFacade,
) {
    /** 그날의 목적지 이름 — 다목적지 여행이면 박수로 펼친 그날의 것이다(FE `regionForDay` 와 같은 규칙). 모르면 빈 문자열. */
    fun regionOn(ctx: TripGenerationContext?, date: LocalDate): String =
        ctx?.destinationRefs?.destinationOn(ctx.startDate, date)?.name.orEmpty()

    /** 여행 전체의 지역 — 목적지 이름을 순서대로 `·` 로 잇는다(같은 이름은 한 번). 상대 `region` 은 한 칸뿐이다. 모르면 빈 문자열. */
    fun regionOfTrip(ctx: TripGenerationContext?): String =
        ctx?.destinationRefs?.map { it.name.trim() }?.filter(String::isNotEmpty)?.distinct()?.joinToString("·").orEmpty()

    /**
     * 사용자 성향 한 줄 — **그 여행의 취향**이다: 계정 취향 위에 여행 생성 때 고른 축을 얹는다(BR-U1-38, 일정 생성과 같은 [overriddenBy]).
     * 동행은 여행에 적힌 것이 계정의 평소 동행보다 우선한다(상대 `_inline_persona` 와 같은 우선순위).
     *
     * 예산·이동수단은 넣지 않는다 — 회고 문장의 재료가 아니다. 여행 스냅숏은 클라이언트가 보낸 자유 맵이라 길이를 [PERSONA_MAX] 로 자른다.
     */
    fun personaOf(accountId: UUID, ctx: TripGenerationContext?): String {
        val prefs = runCatching { preferences.findPreferences(accountId) }
            .onFailure { log.warn("회고 성향 재료를 읽지 못해 비웁니다. accountId={}", accountId, it) }
            .getOrNull() ?: return ""
        return personaLine(prefs.overriddenBy(ctx?.preferenceSnapshot.orEmpty()), ctx?.companionType)
    }

    /**
     * 그날 있었던 일 — 건너뛴 곳이 있었다는 사실 한 건([ReflectionEvent.SKIPPED])과 그날 적용된 재계획([ReflectionEvent.PLAN_B]).
     *
     * 재계획은 변경 이력에서 읽는다 — 적용될 때 같은 트랜잭션에서 `PLAN_B` 한 행이 남는다(BR-U4-30). 그 행의 전후 스냅숏에서
     * **그날 칸이 실제로 바뀐 것만** 그날의 사건이다(재계획은 대상 일자 하나만 교체한다).
     *
     * **사유 문장은 싣지 않는다.** 그 행의 `reason` 은 세션의 사유·지시·**자유 입력**을 한 문자열로 이은 것이라(`ReplanSessionService.changeReason`)
     * 자유 입력만 떼어 낼 수 없다. 자유 입력에는 뺀 장소의 이름("○○ 대신 실내로")이 들어올 수 있고, 그 이름은 [HallucinationGate] 의 금지 목록
     * (건너뛴 방문)에 없어 카드에 그대로 실린다. 그래서 detail 은 고정 문장이고, 트리거로 연 재계획인지(`reason` 첫머리 `자동 감지` — 같은 함수가
     * 맨 앞에 붙인다)만 가른다.
     *
     * 이력은 최신 [TIMELINE_LIMIT] 건만 본다(소유 모듈의 상한) — 상한을 채워 받으면 그보다 오래된 재계획이 빠졌을 수 있어 WARN 을 남긴다.
     */
    fun eventsOn(accountId: UUID, tripId: UUID, date: LocalDate, skippedCount: Int): List<ReflectionEvent> =
        eventsIn(accountId, tripId, mapOf(date to skippedCount))

    /**
     * 여러 날의 사건 — [eventsOn] 을 날마다 부른 것과 같다(날짜순, 날마다 건너뜀 → 재계획). 여행 요약 회고(TRIP-1488)가 쓴다.
     * 변경 이력은 **한 번만** 읽는다 — 날마다 읽으면 여행 하루마다 최대 [TIMELINE_LIMIT] 행씩 같은 조회가 반복된다.
     */
    fun eventsIn(accountId: UUID, tripId: UUID, skippedByDate: Map<LocalDate, Int>): List<ReflectionEvent> {
        val dates = skippedByDate.keys.sorted()
        val timeline = runCatching { changeLogs.findTimeline(accountId, tripId, TIMELINE_LIMIT) }
            .onFailure { log.warn("회고 재계획 재료를 읽지 못해 비웁니다. tripId={} date={}", tripId, dates.joinToString(","), it) }
            .getOrNull().orEmpty()
        if (timeline.size >= TIMELINE_LIMIT) {
            log.warn("변경 이력이 조회 상한({}건)을 채웠습니다 — 더 오래된 재계획은 회고 재료에서 빠졌을 수 있습니다. tripId={} date={}", TIMELINE_LIMIT, tripId, dates.joinToString(","))
        }
        val replans = timeline.filter { it.sourceType == ChangeSourceType.PLAN_B }.sortedBy { it.at }
        return dates.flatMap { date ->
            val skippedCount = skippedByDate.getValue(date)
            val skipped = if (skippedCount > 0) listOf(ReflectionEvent(ReflectionEvent.SKIPPED, date, "계획한 곳 중 ${skippedCount}곳을 들르지 못했다")) else emptyList()
            skipped + replans
                .filter { it.before.slotsOn(date) != it.after.slotsOn(date) }
                .map { ReflectionEvent(ReflectionEvent.PLAN_B, date, if (it.reason?.startsWith(AUTO_DETECTED) == true) "상황 변화를 감지해 일정을 바꿨다" else "일정을 다시 짰다") }
        }
    }

    private fun ItinerarySnapshotView.slotsOn(date: LocalDate) = days.firstOrNull { it.date == date }?.slots

    companion object {
        private val log = LoggerFactory.getLogger(ReflectionMaterials::class.java)

        /** 변경 이력 한 번 조회의 상한 — 소유 모듈이 1..500 으로 조인다(ChangeLogFacade.findTimeline). */
        private const val TIMELINE_LIMIT = 500
        /** `ReplanSessionService.changeReason` 이 트리거로 연 세션의 사유 맨 앞에 붙이는 말. */
        private const val AUTO_DETECTED = "자동 감지"
        private const val PERSONA_MAX = 200

        /** 앞에서 [max] 자까지 — 자르는 자리가 대리 쌍 한가운데면 그 반쪽을 버린다(깨진 문자를 상대에 보내지 않는다). */
        private fun String.clip(max: Int): String =
            if (length <= max) this else take(if (this[max - 1].isHighSurrogate()) max - 1 else max)

        /** 축이 하나도 없으면 빈 문자열이다 — 상대가 "(요약 없음)"으로 받는다. */
        internal fun personaLine(p: PreferenceSnapshot, tripCompanion: String?): String {
            fun axis(label: String, values: List<String>) =
                values.map(String::trim).filter(String::isNotEmpty).takeIf { it.isNotEmpty() }?.let { "$label ${it.joinToString("·")}" }
            val companions = tripCompanion?.trim()?.takeIf(String::isNotEmpty)?.let(::listOf) ?: p.companionTypes
            return listOfNotNull(
                axis("여행 스타일", p.styles),
                axis("좋아하는 것", p.activities),
                axis("음식", p.foodTastes),
                p.pace?.trim()?.takeIf(String::isNotEmpty)?.let { "일정 $it" },
                axis("동행", companions),
                "반려동물 동반".takeIf { p.petFriendly },
            ).joinToString(", ").clip(PERSONA_MAX)
        }
    }
}
