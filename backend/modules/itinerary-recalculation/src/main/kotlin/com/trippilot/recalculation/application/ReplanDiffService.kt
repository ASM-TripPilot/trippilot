package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.recalculation.domain.ReplanDiff
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.util.UUID

/**
 * 확정 전 전후 비교(US-PLANB-08 · BR-U4-25·29).
 *
 * ## 왜 서버가 비교까지 하나
 *
 * 초안(`draft`)만 내려 주면 화면이 **비교 규칙을 다시 구현한다** — 무엇이 `MOVED` 이고 무엇이
 * `FIXED` 인지, 거리를 하나라도 모를 때 총합을 어떻게 다룰지가 전부 업무 판단이다(BR-U4-29).
 * 그 규칙이 두 곳에 있으면 한쪽만 고쳐도 아무도 모르고, 사용자는 **틀린 근거로 확정한다.**
 *
 * 규칙 자체는 이미 [ReplanDiff] 에 순수 함수로 있다 — 이 서비스는 재료를 모아 그것을 부를 뿐이다.
 *
 * ## 아직 안 나온 초안은 404 가 아니다
 *
 * `COLLECTING`·`SOLVING` 단계에서는 비교할 대상이 없다. 그렇다고 404 를 주면 "세션이 없다"와
 * "아직 산출 중"이 같은 응답이 되어, 화면이 로딩(`i12`)을 그릴지 오류를 그릴지 못 정한다.
 * `ready=false` 로 **상태를 값으로** 알린다(INV-U4-05 — 산출 전에는 원 일정에 아무것도 반영되지 않는다).
 *
 * ## 반영된 세션도 비교를 준다(TRIP-1412)
 *
 * 원탭 [다시 짜기]는 초안을 보자마자 반영한다 — 사용자가 "무엇이 빠졌나"를 볼 수 있는 때는 반영 뒤뿐이다.
 * 그때 원 일정은 이미 바뀌어 before 를 다시 계산할 원본이 없으므로, 반영 순간 떠 둔 기준([ReplanSession.appliedBefore])을 쓴다.
 * after 는 초안 그대로라 반영 전과 같은 방법으로 만든다 — 그래서 반영 뒤 비교는 반영 직전 화면이 보였을 비교와 같다.
 * 그 기준이 없는 옛 반영분은 `ready=false` 다(비교를 지어내지 않는다).
 */
@Service
class ReplanDiffService(
    private val sessions: ReplanSessionService,
    private val plans: ItineraryPlanFacade,
    private val poiSurfaces: PoiSurfaceFacade,
) {
    @Transactional(readOnly = true)
    fun diff(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanDiffView {
        // 소유·존재 검증은 세션 조회가 이미 한다(타 계정 404 은닉) — 여기서 다시 하지 않는다.
        val session = sessions.get(accountId, tripId, sessionId)
        val draft = session.draft ?: return ReplanDiffView.notReady(session)
        val frozenBefore = when (session.status) {
            ReplanStatus.DRAFT -> null
            ReplanStatus.APPLIED -> session.appliedBefore ?: return ReplanDiffView.notReady(session)
            else -> return ReplanDiffView.notReady(session)
        }

        val proposal = ReplanProposal.fromMap(draft)
        // 초안(재계획이 새로 넣은 장소 포함)의 표면 — **한 번에** 묻는다(N+1 금지, TRIP-1060).
        // 초안 장소는 동결된 적이 없으므로 정본 조회만 대상이다(findFrozenSurfaces 아님).
        val afterSurfaces = poiSurfaces.findSurfaces(proposal.slots.map { it.poiId }.distinct())
        val after = proposal.slots.map {
            val s = afterSurfaces[it.poiId]
            ReplanDiff.SlotView(
                slotKey = slotKey(proposal.date, it.poiId),
                startAt = it.startAt,
                endAt = it.endAt,
                isFixed = it.isFixed,
                // 자정 넘김은 버리지 않는다 — 빠뜨리면 새벽 종료가 하루 중 가장 이른 시각으로 취급돼
                // 복귀 시각 변화의 부호가 뒤집힌다(HC4).
                endsNextDay = it.endsNextDay,
                // 초안은 거리를 **구간 문구**로만 들고 있다(`distanceRange`) — 미터를 모른다.
                // 0 으로 채우면 "거리가 줄었다"는 거짓 요약이 나오므로 모른다고 둔다(ReplanDiff 규약).
                distanceM = null,
                nameKo = s?.nameKo,
                category = s?.category,
                imageUrl = s?.imageUrl,
                lat = s?.lat,
                lng = s?.lng,
            )
        }
        val before = frozenBefore ?: plans.beforeOf(accountId, tripId, proposal.date)

        return ReplanDiffView(
            ready = true,
            status = session.status,
            date = proposal.date,
            before = before,
            after = after,
            result = ReplanDiff.of(before, after),
            // 재계획안의 이동 총거리(km). **변화량이 아니라 절대값**이다 — 비교하려면 원 일정의
            // 거리도 있어야 하는데 `visit_slot` 에는 미터가 없다(있는 것은 표시 문자열뿐).
            // 그래서 `totalDistanceDeltaM` 은 여전히 null 이고, 화면은 "이동 6.9km" 로만 쓴다.
            totalDistanceKm = proposal.totalDistanceKm,
        )
    }

    /** 경계 키(BR-U2-04). 행이 갈려도 참조가 끊기지 않는 유일한 연결 고리다. */
    private fun slotKey(date: LocalDate, poiId: UUID) = "$date#$poiId"
}

/**
 * 비교의 before — **지금 일정의 그 날짜분**과 그 표면. 반영 전 비교와 반영 순간 떠 두는 기준([ReplanSessionService.apply])이
 * 같은 값을 써야 반영 뒤 비교가 반영 전 화면과 같은 말을 한다 — 그래서 한 곳에 둔다.
 *
 * 비교 대상은 **그 날짜**뿐이다. 재계획은 하루를 다시 짜므로 다른 날을 섞으면
 * 지표(방문 수·복귀 시각)가 여행 전체 값이 되어 화면이 과장된 변화를 보인다.
 * 표면은 C8 이 채워 보낸다(확정 슬롯 동결값 규칙의 소유자 — TRIP-1060 결정 1).
 */
internal fun ItineraryPlanFacade.beforeOf(accountId: UUID, tripId: UUID, date: LocalDate): List<ReplanDiff.SlotView> =
    findPlanSlots(accountId, tripId)
        .filter { it.date == date }
        .map {
            ReplanDiff.SlotView(
                slotKey = it.slotKey,
                startAt = it.startAt,
                endAt = it.endAt,
                isFixed = it.isFixed,
                endsNextDay = it.endsNextDay,
                distanceM = null,
                nameKo = it.nameKo,
                category = it.category,
                imageUrl = it.imageUrl,
                lat = it.lat,
                lng = it.lng,
            )
        }

/**
 * 비교 결과. [ready] 가 false 면 나머지는 비어 있다 — 아직 초안이 없다는 뜻이고, 화면은
 * 오류가 아니라 진행 상태(`i12` 로딩 · 대안 없음)를 그린다.
 */
data class ReplanDiffView(
    val ready: Boolean,
    val status: ReplanStatus,
    val date: LocalDate?,
    val before: List<ReplanDiff.SlotView>,
    val after: List<ReplanDiff.SlotView>,
    val result: ReplanDiff.Result?,
    /** 재계획안의 이동 총거리(km). 상대가 푼 값이고 **모르면 null** 이다(옛 초안·대역). */
    val totalDistanceKm: Double? = null,
) {
    companion object {
        fun notReady(session: ReplanSession) = ReplanDiffView(
            ready = false,
            status = session.status,
            date = null,
            before = emptyList(),
            after = emptyList(),
            result = null,
        )
    }
}
