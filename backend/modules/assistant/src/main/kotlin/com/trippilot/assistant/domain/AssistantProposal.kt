package com.trippilot.assistant.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 제안 상태(domain-entities §3.5). `PROPOSED` 밖은 전부 종결이다 — 나가는 전이가 없다(INV-U8-08). */
enum class ProposalStatus { PROPOSED, APPLIED, STALE, DISMISSED, EXPIRED, FAILED }

/** 비교 카드 한 칸. 시각·거리는 **검증된 값의 표시 문자열**이다(BR-U8-35). 소요시간은 없다(INV-U8-09). */
data class ProposalSlotFace(val name: String, val startAt: String, val distanceRange: String?)

/** @property change `ADDED`|`REMOVED`|`REPLACED`|`MOVED`|`RETIMED` */
data class ProposalDiffItem(val change: String, val slotKey: String, val before: ProposalSlotFace?, val after: ProposalSlotFace?)

/** [적용]하면 저장할 일정 — **전체 일자**다(편집이 전체 교체라서). 일정 편집 퍼사드의 입력과 같은 칸이다. */
data class ProposalDay(val date: LocalDate, val slots: List<ProposalSlot>)

data class ProposalSlot(val poiId: UUID, val startAt: LocalTime, val endAt: LocalTime, val isFixed: Boolean, val endsNextDay: Boolean)

/**
 * 새 제안. 메시지와 **함께** 저장된다 — 카드 없는 제안도, 제안 없는 카드도 남지 않는다.
 *
 * @property baseFingerprint 이 안을 계산한 기준 일정의 지문. 적용할 때 지금 일정과 견준다(INV-U8-04).
 * @property violations 비어 있지 않으면 적용할 수 없다(BR-U8-31) — 그때 [after]·[diff] 는 빈다(상대는 위반인 안의 일정을 주지 않는다).
 */
data class NewProposal(
    val tripId: UUID,
    val baseFingerprint: String,
    val after: List<ProposalDay>,
    val diff: List<ProposalDiffItem>,
    val violations: List<String>,
    val applyHint: String?,
    val expiresAt: Instant,
)

/** @property claimed 적용이 이 제안을 집었다 — 저장이 진행 중이거나, 끝을 적지 못하고 죽었다. */
data class AssistantProposal(
    val proposalId: UUID,
    val sessionId: UUID,
    val accountId: UUID,
    val tripId: UUID,
    val baseFingerprint: String,
    val after: List<ProposalDay>,
    val diff: List<ProposalDiffItem>,
    val violations: List<String>,
    val applyHint: String?,
    val status: ProposalStatus,
    val expiresAt: Instant,
    val claimed: Boolean,
) {
    /** 화면에 보이는 상태 — 만료는 읽을 때 판정한다(행을 고치는 것은 적용 시도와 청소 배치다). */
    fun statusAt(now: Instant): ProposalStatus = if (status == ProposalStatus.PROPOSED && expiresAt <= now) ProposalStatus.EXPIRED else status

    fun view(now: Instant) = ProposalView(proposalId, statusAt(now).name, diff, violations, applyHint)
}

/** 메시지에 실려 나가는 제안(프론트 계약 `Proposal`). */
data class ProposalView(val id: UUID, val status: String, val diff: List<ProposalDiffItem>, val violations: List<String>, val applyHint: String?)

interface AssistantProposalRepository {
    fun create(sessionId: UUID, accountId: UUID, proposal: NewProposal, at: Instant): UUID

    /** 그 계정의 제안. **행을 잠근다** — 같은 제안의 적용·취소가 겹쳐도 한 줄로 선다. 트랜잭션 안에서 부른다. */
    fun findOwnedForUpdate(accountId: UUID, proposalId: UUID): AssistantProposal?

    fun find(proposalId: UUID): AssistantProposal?

    /** 적용이 제안을 집는다 — `PROPOSED` 이고 아직 아무도 안 집었을 때만. 집었으면 true. */
    fun claim(proposalId: UUID, at: Instant): Boolean

    /**
     * `PROPOSED` 에서 [to] 로 닫는다. [claimed] 는 닫는 쪽이 집은 제안이어야 하는가다 — 적용의 끝(`APPLIED`·`FAILED`)은
     * 집은 것만, 그 밖(`STALE`·`EXPIRED`·`DISMISSED`)은 아무도 안 집은 것만 닫는다. 저장이 도는 중인 제안을 취소로 닫으면
     * 일정은 바뀌었는데 제안은 "취소됨"으로 남는다.
     */
    fun close(proposalId: UUID, to: ProposalStatus, claimed: Boolean): Boolean
}
