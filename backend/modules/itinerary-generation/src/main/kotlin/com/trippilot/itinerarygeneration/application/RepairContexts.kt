package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.RepairContext
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.overriddenBy
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 편집 수리(repair)에 실을 여행 컨텍스트(2026-10-05) — **generate 가 AI 에 보내는 것과 같은 출처**다.
 * 앵커 = [RegionAnchors.dayAnchors](숙소 → 그 날 목적지 중심 → 첫 목적지 중심), 수단 = 그 여행의 취향
 * `transport_modes`(여행 스냅숏 우선·없으면 계정 — [overriddenBy]. 생성 프로필과 같은 값 — 개인화는 수단을 건드리지 않는다). 새로 계산하지 않는다.
 *
 * 앵커는 [dates] 의 날만 싣는다 — 앵커가 실린 날은 상대가 첫 슬롯을 앵커 이동만큼 밀 수 있어서,
 * 첫 구간이 안 바뀐 날까지 실으면 사용자가 옮겨 둔 시각이 그 편집과 무관하게 움직인다.
 */
@Component
class RepairContexts(
    private val trips: TripFacade,
    private val baseAnchors: BaseAnchorFacade,
    private val regions: RegionLookupFacade,
    private val preferences: PreferenceFacade,
) {
    fun of(accountId: UUID, tripId: UUID, dates: Set<LocalDate>): RepairContext {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return RepairContext.NONE
        val anchors = if (dates.isEmpty()) {
            emptyList()
        } else {
            val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
            RegionAnchors.dayAnchors(regions, ctx.startDate, ctx.endDate, stays, ctx.destinationRefs).filter { it.date in dates }
        }
        return RepairContext(anchors, preferences.findPreferences(accountId).overriddenBy(ctx.preferenceSnapshot).transportModes)
    }

    /**
     * 재검증(validate)에 실을 수단(2026-10-30) — [of] 와 **같은 출처**의 취향 `transport_modes`. 앵커는 안 싣는다(상대 HC2 는
     * 앵커→첫 슬롯 구간을 재지 않는다). 조회가 깨지면 빈 목록 = 종전 재검증(상대 기본 대중교통)으로 내려간다 — 수리 컨텍스트처럼
     * 보탬이라, 우리 쪽 조회 장애를 재검증 실패(판정 보류)로 바꾸지 않는다.
     */
    fun transportModes(accountId: UUID, tripId: UUID): List<String> =
        runCatching { of(accountId, tripId, emptySet()).transportModes }.getOrElse { e ->
            log.warn("재검증 수단 조회 실패 — 수단 없이(대중교통) 재검증합니다. tripId={}", tripId, e)
            emptyList()
        }

    /**
     * 편집 제안(U8)에 실을 컨텍스트 — 수리와 **같은 출처**에서 그 날 하나만 뽑는다. 상대는 이 앵커에 후보 풀을
     * 매달아 추가·교체 대상을 검사한다(INV-1). 앵커를 못 정하면 null — 계약상 필수라 부를 수 없다.
     */
    fun forEditProposal(accountId: UUID, tripId: UUID, date: LocalDate): EditProposalContext? {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return null
        val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
        val anchor = RegionAnchors.dayAnchors(regions, ctx.startDate, ctx.endDate, stays, ctx.destinationRefs)
            .firstOrNull { it.date == date } ?: return null
        val prefs = preferences.findPreferences(accountId).overriddenBy(ctx.preferenceSnapshot)
        // 생성은 목록을 보내고 상대가 **아는 첫 값**을 고른다. 여기서 그냥 첫 값을 보내면 `["택시","렌터카"]` 가 생성에서는
        // 자가용, 편집에서는 모르는 값(→ 대중교통)이 되어 같은 여행의 이동 시간 기준이 갈린다.
        return EditProposalContext(anchor, prefs.transportModes.firstOrNull { it in AI_TRANSPORT_MODES }, prefs.budgetTier)
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
        /** 상대 `_TRANSPORT_TOKENS` 가 아는 값 중 우리 취향 어휘에 있는 것(택시·자전거는 상대가 모른다). */
        val AI_TRANSPORT_MODES = setOf("도보", "대중교통", "렌터카")
        val log = LoggerFactory.getLogger(RepairContexts::class.java)
    }
}

/**
 * [budgetTier] 는 생성 경로가 `budget_level` 로 보내는 그 값이다(취향의 예산 등급 — 여행 총예산이 아니다).
 * [transportMode] 는 상대가 아는 수단 하나다 — 편집 경계는 목록이 아니라 한 값을 받는다.
 */
data class EditProposalContext(val anchor: DayAnchor, val transportMode: String?, val budgetTier: String?)

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
