package com.trippilot.assistant.adapter.`in`.web

import com.trippilot.assistant.application.AssistantFeedbackService
import com.trippilot.assistant.application.AssistantSessionService
import com.trippilot.assistant.application.AssistantTurnService
import com.trippilot.assistant.application.MessagePage
import com.trippilot.assistant.application.OpenedSession
import com.trippilot.assistant.application.ProposalService
import com.trippilot.assistant.application.SessionSummary
import com.trippilot.assistant.application.TurnInput
import com.trippilot.assistant.application.TurnResult
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.FeedbackReason
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.ProposalView
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * AI 도우미(U8 · `b01`~`b07`). 전부 인증 필수이고(BR-U8-08) 본인 것만 본다.
 *
 * **응답 모양은 프론트가 먼저 만든 계약을 따른다**(`frontend/…/assistant-sheet/api/assistantContract.ts`,
 * 사용자 결정 2026-10-13) — 세션 목록이 감싸는 객체 없이 배열인 것도 그래서다.
 */
@RestController
@RequestMapping("/api/v1/assistant")
class AssistantController(
    private val sessions: AssistantSessionService,
    private val turns: AssistantTurnService,
    private val proposals: ProposalService,
    private val feedback: AssistantFeedbackService,
) {

    @PostMapping("/sessions")
    fun open(principal: Principal, @RequestBody request: OpenSessionRequest): OpenSessionResponse =
        OpenSessionResponse.from(sessions.open(principal.accountId(), request.tripId))

    @GetMapping("/sessions")
    fun list(principal: Principal): List<SessionSummaryResponse> =
        sessions.list(principal.accountId()).map { SessionSummaryResponse.from(it) }

    @GetMapping("/sessions/{sessionId}/messages")
    fun messages(
        principal: Principal,
        @PathVariable sessionId: UUID,
        @RequestParam(required = false) before: String?,
        @RequestParam(required = false) limit: Int?,
    ): MessagesPageResponse = MessagesPageResponse.from(sessions.messages(principal.accountId(), sessionId, before, limit))

    @DeleteMapping("/sessions/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun clear(principal: Principal, @PathVariable sessionId: UUID) = sessions.clear(principal.accountId(), sessionId)

    @PostMapping("/sessions/{sessionId}/turns")
    fun sendTurn(principal: Principal, @PathVariable sessionId: UUID, @RequestBody request: SendTurnRequest): SendTurnResponse =
        SendTurnResponse.from(turns.send(principal.accountId(), sessionId, request.clientTurnId, request.input.toInput(), request.screen.surface))

    @PostMapping("/proposals/{proposalId}/apply")
    fun applyProposal(principal: Principal, @PathVariable proposalId: UUID): ApplyProposalResponse =
        proposals.apply(principal.accountId(), proposalId).let { o ->
            ApplyProposalResponse(ProposalStatusResponse(o.proposalId, o.status.name), o.messages.map { MessageResponse.from(it) })
        }

    @PostMapping("/proposals/{proposalId}/dismiss")
    fun dismissProposal(principal: Principal, @PathVariable proposalId: UUID): DismissProposalResponse =
        proposals.dismiss(principal.accountId(), proposalId).let { DismissProposalResponse(ProposalStatusResponse(it.proposalId, it.status.name)) }

    /** 답 평가 남기기·바꾸기(US-ASSIST-09). 본문이 통째로 덮어쓴다 — 같은 값을 다시 보내도 200 이다(바꾼 시각만 간다). 응답은 저장한 값이다. */
    @PutMapping("/sessions/{sessionId}/messages/{messageId}/feedback")
    fun rate(principal: Principal, @PathVariable sessionId: UUID, @PathVariable messageId: UUID, @RequestBody request: FeedbackRequest): FeedbackResponse {
        val saved = feedback.rate(principal.accountId(), sessionId, messageId, request.toRating(), request.toReason(), request.comment)
        return FeedbackResponse(messageId, saved.rating.name, saved.reason?.name, saved.comment)
    }

    /** 답 평가 취소. 남긴 평가가 없어도 204 다(멱등). */
    @DeleteMapping("/sessions/{sessionId}/messages/{messageId}/feedback")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun unrate(principal: Principal, @PathVariable sessionId: UUID, @PathVariable messageId: UUID) =
        feedback.unrate(principal.accountId(), sessionId, messageId)
}

/**
 * [rating] 은 `UP`|`DOWN`, [reason] 은 `WRONG`|`NOT_HELPFUL`|`NOT_WHAT_I_WANTED`|null 이다. 문자열로 받아 여기서 가른다 — 모르는 값을
 * 본문 해석 오류가 아니라 필드 오류(400)로 돌려준다. [comment] 의 규칙(싫어요에만·앞뒤 공백·300자)은 서비스가 본다.
 */
data class FeedbackRequest(val rating: String? = null, val reason: String? = null, val comment: String? = null) {
    fun toRating(): FeedbackRating = FeedbackRating.entries.firstOrNull { it.name == rating }
        ?: throw ValidationFailed(listOf(FieldError("rating", "UP 또는 DOWN 이어야 합니다.")))

    fun toReason(): FeedbackReason? = reason?.let { given ->
        FeedbackReason.entries.firstOrNull { it.name == given }
            ?: throw ValidationFailed(listOf(FieldError("reason", "WRONG·NOT_HELPFUL·NOT_WHAT_I_WANTED 중 하나여야 합니다.")))
    }

    /** 의견은 사용자가 쓴 글이다 — 기본 toString 이 본문을 싣지 않게 있는지만 보인다(SEC-U8-06. 요청 본문 DEBUG 로그가 이 값을 찍는다). */
    override fun toString() = "FeedbackRequest(rating=$rating, reason=$reason, hasComment=${comment != null})"
}

/** [reason]·[comment] 는 저장한 값이다 — 의견은 앞뒤 공백을 지운 값이고, 없으면(좋아요 포함) null 이다. */
data class FeedbackResponse(val messageId: UUID, val rating: String, val reason: String?, val comment: String?)

/** [messages] 는 무엇을 했는지의 기록이다(`ACTION_LOG`) — 저장에 실패했으면 그 안내가 온다(그때 `status` 는 `FAILED`). */
data class ApplyProposalResponse(val proposal: ProposalStatusResponse, val messages: List<MessageResponse>)

data class DismissProposalResponse(val proposal: ProposalStatusResponse)

data class ProposalStatusResponse(val id: UUID, val status: String)

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * 한 턴. [clientTurnId] 가 멱등 키다 — 앱은 재시도할 때 같은 값을 다시 보낸다(BR-U8-21).
 * [screen] 은 도우미를 연 화면뿐이다. 일정 내용은 받지 않는다 — 서버가 직접 읽는다(BR-U8-02).
 */
data class SendTurnRequest(
    val clientTurnId: UUID,
    val input: TurnInputRequest,
    val screen: ScreenRequest,
)

/** `TEXT` 면 [text], `ACTION` 이면 [quickReplyId] 가 있어야 한다. 길이·발급 여부는 서비스가 본다. */
data class TurnInputRequest(val type: TurnInputType, val text: String? = null, val quickReplyId: String? = null) {
    fun toInput(): TurnInput = when (type) {
        TurnInputType.TEXT -> TurnInput.Text(text ?: throw ValidationFailed(listOf(FieldError("input.text", "발화가 없습니다."))))
        TurnInputType.ACTION ->
            TurnInput.Action(quickReplyId ?: throw ValidationFailed(listOf(FieldError("input.quickReplyId", "빠른 답 id 가 없습니다."))))
    }
}

enum class TurnInputType { TEXT, ACTION }

data class ScreenRequest(val surface: AssistantSurface)

/** 사용자 메시지 1건 + 도우미 메시지 1건 이상. [quickReplies] 는 입력창 위에 보일 빠른 답이다. */
data class SendTurnResponse(val messages: List<MessageResponse>, val quickReplies: List<QuickReply>) {
    companion object {
        fun from(r: TurnResult) = SendTurnResponse(r.messages.map { MessageResponse.from(it) }, r.quickReplies)
    }
}

/** [tripId] null = 여행 없이 연다(일반 도움 모드, BR-U8-05). 화면이 어디인지(`surface`)는 턴이 싣는다. */
data class OpenSessionRequest(val tripId: UUID? = null)

/** [nextBefore] 는 프론트 계약에 없던 칸이다 — 이어 연 대화가 한 쪽보다 길 때 위로 더 읽을 커서(없으면 null). */
data class OpenSessionResponse(
    val session: SessionResponse,
    val messages: List<MessageResponse>,
    val nextBefore: String?,
    val quickReplies: List<QuickReply>,
) {
    companion object {
        fun from(o: OpenedSession) = OpenSessionResponse(
            SessionResponse(o.session.sessionId, o.session.tripId, o.contextChip),
            o.page.messages.map { MessageResponse.from(it) },
            o.page.nextBefore,
            o.quickReplies,
        )
    }
}

/** [contextChip] 은 도우미가 실제로 쓰는 컨텍스트와 같은 원천의 문구다(BR-U8-03). 여행 없는 세션은 null. */
data class SessionResponse(val id: UUID, val tripId: UUID?, val contextChip: String?)

data class SessionSummaryResponse(val id: UUID, val tripId: UUID?, val tripTitle: String?, val lastTurnAt: Instant) {
    companion object {
        fun from(s: SessionSummary) = SessionSummaryResponse(s.session.sessionId, s.session.tripId, s.tripTitle, s.session.lastTurnAt)
    }
}

data class MessagesPageResponse(val messages: List<MessageResponse>, val nextBefore: String?) {
    companion object {
        fun from(p: MessagePage) = MessagesPageResponse(p.messages.map { MessageResponse.from(it) }, p.nextBefore)
    }
}

/**
 * 메시지 한 줄. **소요시간 필드는 없다**(INV-3) — 시각·거리는 서버가 저장한 문자열 그대로다.
 *
 * [proposal] 은 제안 카드(`PROPOSAL`)와 그 제안을 적용한 결과 안내(`ACTION_LOG`, 실패면 `TEXT`)에만 있다. 상태는 **읽은 시점의 것**이다.
 */
data class MessageResponse(
    val id: UUID,
    val role: String,
    val kind: String,
    val text: String?,
    val payload: Map<String, Any?>?,
    val nextActions: List<NextAction>,
    /** null = 이 메시지가 정하지 않았다(앱이 시작 빠른 답을 보인다). 빈 목록과 뜻이 다르다. */
    val quickReplies: List<QuickReply>?,
    val proposal: ProposalView?,
    val footnote: String?,
    val createdAt: Instant,
    /**
     * 사용자가 이 답에 남긴 평가(`UP`|`DOWN`). 없으면 null — 사용자 말·적용 기록은 늘 null 이다(US-ASSIST-09).
     * 싫어요에 함께 남긴 이유·의견은 싣지 않는다(평가 PUT 응답과 내보내기에만 있다).
     */
    val feedback: String?,
) {
    companion object {
        fun from(m: AssistantMessage) = MessageResponse(
            id = m.messageId, role = m.role.name, kind = m.kind.name, text = m.text, payload = m.payload,
            nextActions = m.nextActions, quickReplies = m.quickReplies, proposal = m.proposal, footnote = m.footnote, createdAt = m.createdAt,
            feedback = m.feedback?.rating?.name, // 평가만 — 이유·의견은 메시지 응답에 싣지 않는다
        )
    }
}
