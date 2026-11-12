package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RepairContext
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.profile.api.overriddenBy
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 편집 수리(repair)에 실을 여행 컨텍스트(2026-10-05) — **generate 가 AI 에 보내는 것과 같은 출처**다.
 * 앵커 = [RegionAnchors.dayAnchors](숙소 → 그 날 목적지 중심 → 첫 목적지 중심), 수단 = 그 여행의 취향
 * `transport_modes`(여행 스냅숏 우선·없으면 계정 — [overriddenBy]. 생성 프로필과 같은 값 — 개인화는 수단을 건드리지 않는다). 새로 계산하지 않는다.
 * 취향 프로필(2026-11-03)도 생성과 **같은 함수**다([overriddenBy] → [toProfile], 기록 기반 개인화 포함) — 상대가 액티비티 취향의 도보 상한을
 * 생성과 같게 건다. 개인화 조회가 깨지면 개인화 없이(보탬이라 컨텍스트 전체를 잃지 않는다).
 *
 * 앵커는 [dates] 의 날만 싣는다 — 앵커가 실린 날은 상대가 첫 슬롯을 앵커 이동만큼 밀 수 있어서,
 * 첫 구간이 안 바뀐 날까지 실으면 사용자가 옮겨 둔 시각이 그 편집과 무관하게 움직인다.
 * 그 날들의 창도 편집 제안과 같은 기본 일과 창([baseDayWindow])이다(2026-11-05) — 상대는 그 시작을 앵커 출발 시각으로만 쓴다.
 */
@Component
class RepairContexts(
    private val trips: TripFacade,
    private val baseAnchors: BaseAnchorFacade,
    private val regions: RegionLookupFacade,
    private val preferences: PreferenceFacade,
    private val personalization: PersonalizationPort,
) {
    fun of(accountId: UUID, tripId: UUID, dates: Set<LocalDate>): RepairContext {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return RepairContext.NONE
        val anchors = if (dates.isEmpty()) {
            emptyList()
        } else {
            val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
            RegionAnchors.dayAnchors(regions, ctx.startDate, ctx.endDate, stays, ctx.destinationRefs).filter { it.date in dates }
        }
        val prefs = prefsOf(accountId, ctx)
        return RepairContext(anchors, prefs.transportModes, profileOf(accountId, ctx, prefs), anchors.mapNotNull { ctx.openWindowOn(it.date) })
    }

    /**
     * 재검증(validate)에 실을 수단(2026-10-30) — [of] 와 **같은 출처**의 취향 `transport_modes` 를, 상대가 **자차로 풀 때만**(아는 첫 값이
     * 렌터카) 목록 그대로 싣는다. 앵커는 안 싣는다(상대 HC2 는 앵커→첫 슬롯 구간을 재지 않는다).
     * 도보·대중교통 여행은 비운다 = 종전 재검증(상대 기본 대중교통). 도보로 재면 오탐이 새로 생긴다 — 재계획이 수단을 싣기 전(TRIP-1709 F7,
     * 2026-11-03)에 다시 짠 날은 대중교통으로 짜였고(손 안 댄 그 날의 1.5km 미만 구간이 대개 HC2 가 된다), 상대 도보 추정은 걷는 구간에도 여유 15분을
     * 더해 대중교통의 걷기(도로 700m 이하, 여유 없음)보다 길다. 자차(계획 없는 추정)는 어느 구간도 대중교통보다 더 요구하지 않는다.
     * 취향 프로필(2026-11-03)은 수단과 무관하게 싣는다 — 상대가 대중교통일 때만 액티비티 도보 상한을 건다(자차·도보는 바꾸지 않는다).
     * 조회가 깨지면 빈 컨텍스트 = 종전 재검증으로 내려간다 — 수리 컨텍스트처럼 보탬이라, 우리 쪽 조회 장애를 재검증 실패(판정 보류)로 바꾸지 않는다.
     */
    fun forRevalidation(accountId: UUID, tripId: UUID): RepairContext =
        runCatching { of(accountId, tripId, emptySet()) }.getOrElse { e ->
            log.warn("재검증 컨텍스트 조회 실패 — 수단·취향 없이(대중교통·기본 도보 상한) 재검증합니다. tripId={}", tripId, e)
            RepairContext.NONE
        }.let { it.copy(transportModes = it.transportModes.takeIf { modes -> firstAiTransport(modes) == "렌터카" }.orEmpty()) }

    /**
     * 편집 제안(U8)에 실을 컨텍스트 — 수리와 **같은 출처**에서 그 날 하나만 뽑는다. 상대는 이 앵커에 후보 풀을
     * 매달아 추가·교체 대상을 검사한다(INV-1). 앵커를 못 정하면 null — 계약상 필수라 부를 수 없다.
     * [dates] = 보낼 일정의 날 — 그 날들의 기본 일과 창([baseDayWindow], 생성과 같은 규칙)을 싣는다(상대는 빈 날의 시작으로만 쓴다).
     */
    fun forEditProposal(accountId: UUID, tripId: UUID, date: LocalDate, dates: Collection<LocalDate>): EditProposalContext? {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return null
        val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
        val anchor = RegionAnchors.dayAnchors(regions, ctx.startDate, ctx.endDate, stays, ctx.destinationRefs)
            .firstOrNull { it.date == date } ?: return null
        val prefs = prefsOf(accountId, ctx)
        // 생성은 목록을 보내고 상대가 **아는 첫 값**을 고른다. 여기서 그냥 첫 값을 보내면 `["택시","렌터카"]` 가 생성에서는
        // 자가용, 편집에서는 모르는 값(→ 대중교통)이 되어 같은 여행의 이동 시간 기준이 갈린다.
        return EditProposalContext(
            anchor, firstAiTransport(prefs.transportModes), prefs.budgetTier,
            preferenceProfile = profileOf(accountId, ctx, prefs),
            timeWindows = dates.distinct().sorted().mapNotNull { ctx.openWindowOn(it) },
            tripStartDate = ctx.startDate,
        )
    }

    /**
     * 그 날의 기본 일과 창([baseDayWindow]) — 수리·편집 제안이 같은 규칙을 쓴다. 여행 설정이 모순(시작 ≥ 끝)인 날은 null(싣지 않는다) —
     * 생성은 그 모순을 400 으로 드러내고, 편집은 창 없이(종전 기본값) 간다.
     */
    private fun TripGenerationContext.openWindowOn(date: LocalDate): TimeWindow? =
        baseDayWindow(date).takeIf { (s, e) -> s.isBefore(e) }?.let { (s, e) -> TimeWindow(date, s, e) }

    private fun prefsOf(accountId: UUID, ctx: TripGenerationContext): PreferenceSnapshot =
        preferences.findPreferences(accountId).overriddenBy(ctx.preferenceSnapshot)

    /** 생성과 같은 프로필(`toProfile`) — 개인화 조회가 깨지면 개인화 없이. 개인화는 보탬이다(TRIP-556). */
    private fun profileOf(accountId: UUID, ctx: TripGenerationContext, prefs: PreferenceSnapshot): PreferenceProfile {
        val hints = runCatching { personalization.hintsFor(accountId) }.getOrElse { e ->
            log.warn("취향 개인화 조회 실패 — 개인화 없이 싣습니다.", e)
            PersonalizationHints.NONE
        }
        return prefs.toProfile(hints, ctx.preferenceSnapshot.keys)
    }

    /**
     * 슬롯 후보(같이 짜기·다른 후보)의 공간 재료 — 그 날 목적지의 **구 코드 집합**(구 안 우선 판정), 구 중심, 숙소 좌표
     * (2026-10-23 사용자 결정: 구를 고르면 그 구 안 우선 · 찾는 중심을 사용자가 고른다). 출처는 수리·생성과 같다
     * ([RegionAnchors.destinationOn]·[RegionAnchors.centerOf]·숙박일 거점, 체크아웃일은 전날 거점).
     */
    fun forSlotCandidates(accountId: UUID, tripId: UUID, date: LocalDate): SlotSpace {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return SlotSpace.NONE
        val destination = RegionAnchors.destinationOn(ctx.destinationRefs, ctx.startDate, date)
        val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
        val stay = stays.firstOrNull { it.date == date }
            ?: if (date == ctx.endDate) stays.firstOrNull { it.date == date.minusDays(1) } else null
        return SlotSpace(
            districtCodes = destination?.regionCode?.let { regions.districtCodesOf(it) }.orEmpty(),
            // 코드 없는 옛 여행이 동명이지역(중구·동구·고성군…)이면 이름 첫 일치가 다른 도시 중심을 집는다 — 생성 앵커는 앵커를
            // 잃지 않으려 그 길을 남겼지만(RegionAnchors), 여기는 사용자가 "고른 구 중심"이라 추측하지 않고 없음(409)으로 둔다.
            regionCenter = destination
                ?.takeIf { it.regionCode != null || regions.codesOf(it.name).size <= 1 }
                ?.let { RegionAnchors.centerOf(regions, it) },
            stay = stay?.let { RegionCenter(it.lat, it.lng) },
        )
    }

    private companion object {
        val log = LoggerFactory.getLogger(RepairContexts::class.java)
    }
}

/**
 * 수단 목록 → 상대가 **아는 첫 값**(없으면 null = 상대 기본 대중교통). 한 값만 받는 경계(편집 제안·재계획)가 생성(목록을 보내면
 * 상대가 첫 인식 값을 고른다)과 같은 수단으로 돌게 하는 단일 지점이다.
 */
internal fun firstAiTransport(modes: List<String>): String? = modes.firstOrNull { it in AI_TRANSPORT_MODES }

/** 상대 `_TRANSPORT_TOKENS` 가 아는 값 중 우리 취향 어휘에 있는 것(택시·자전거는 상대가 모른다). */
private val AI_TRANSPORT_MODES = setOf("도보", "대중교통", "렌터카")

/**
 * [budgetTier] 는 생성 경로가 `budget_level` 로 보내는 그 값이다(취향의 예산 등급 — 여행 총예산이 아니다).
 * [transportMode] 는 상대가 아는 수단 하나다 — 편집 경계는 목록이 아니라 한 값을 받는다.
 * [preferenceProfile]·[timeWindows]·[tripStartDate] — 편집 요청의 여행 컨텍스트(2026-11-03, [EditProposalInput] 과 같은 뜻).
 */
data class EditProposalContext(
    val anchor: DayAnchor,
    val transportMode: String?,
    val budgetTier: String?,
    val preferenceProfile: PreferenceProfile?,
    val timeWindows: List<TimeWindow>,
    val tripStartDate: LocalDate?,
)

/**
 * 슬롯 후보의 공간 재료. [districtCodes] 가 비어 있으면 구 단위 여행이 아니다(시도·코드 없음) — 구 안 우선을 걸지 않는다.
 * [regionCenter]·[stay] 는 사용자가 고르는 찾는 중심의 재료다(없으면 그 선택지를 쓸 수 없다).
 */
data class SlotSpace(
    val districtCodes: Set<String>,
    val regionCenter: RegionCenter?,
    val stay: RegionCenter?,
) {
    companion object {
        val NONE = SlotSpace(emptySet(), null, null)
    }
}
