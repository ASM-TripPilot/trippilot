package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
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
 */
@Service
class ReplanDiffService(
    private val sessions: ReplanSessionService,
    private val plans: ItineraryPlanFacade,
) {
    @Transactional(readOnly = true)
    fun diff(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanDiffView {
        // 소유·존재 검증은 세션 조회가 이미 한다(타 계정 404 은닉) — 여기서 다시 하지 않는다.
        val session = sessions.get(accountId, tripId, sessionId)
        val draft = session.draft?.takeIf { session.status == ReplanStatus.DRAFT }
            ?: return ReplanDiffView.notReady(session)

        val proposal = ReplanProposal.fromMap(draft)
        val after = proposal.slots.map {
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
            )
        }
        // 비교 대상은 **그 날짜**뿐이다. 재계획은 하루를 다시 짜므로 다른 날을 섞으면
        // 지표(방문 수·복귀 시각)가 여행 전체 값이 되어 화면이 과장된 변화를 보인다.
        val before = plans.findPlanSlots(accountId, tripId)
            .filter { it.date == proposal.date }
            .map {
                ReplanDiff.SlotView(
                    slotKey = it.slotKey,
                    startAt = it.startAt,
                    endAt = it.endAt,
                    isFixed = it.isFixed,
                    endsNextDay = it.endsNextDay,
                    distanceM = null,
                )
            }

        return ReplanDiffView(
            ready = true,
            status = session.status,
            date = proposal.date,
            before = before,
            after = after,
            result = ReplanDiff.of(before, after),
        )
    }

    /** 경계 키(BR-U2-04). 행이 갈려도 참조가 끊기지 않는 유일한 연결 고리다. */
    private fun slotKey(date: LocalDate, poiId: UUID) = "$date#$poiId"
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
