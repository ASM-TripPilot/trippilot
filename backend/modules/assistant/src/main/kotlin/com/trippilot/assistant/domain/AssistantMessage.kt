package com.trippilot.assistant.domain

import java.time.Instant
import java.util.UUID

enum class MessageRole { USER, ASSISTANT }

/** 카드 종류(domain-entities §3.4). 화면이 이 값으로 그릴 것을 고른다. */
enum class MessageKind { TEXT, CLARIFY, REVIEW, CANDIDATES, PROPOSAL, INFO, SCOPE, REFUSAL, FALLBACK, ACTION_LOG }

/**
 * 표시용 대화 한 줄(DEC-U8-4).
 *
 * [payload]·[nextActions]·[quickReplies] 는 **저장된 그대로** 내보낸다 — 카드 모양은 종류마다 다르고,
 * 여기서 타입으로 풀었다 다시 조립하면 저장 시점과 조회 시점의 모양이 갈릴 자리가 생긴다.
 * **소요시간 항목은 어디에도 없다**(INV-U8-06).
 */
data class AssistantMessage(
    val messageId: UUID,
    /** 표시 순서이자 페이지 커서 — DB 가 매긴다. */
    val seq: Long,
    val role: MessageRole,
    val kind: MessageKind,
    /** 정책 위반 입력은 원문을 저장하지 않아 null 이다(BR-U8-23). */
    val text: String?,
    val payload: Map<String, Any?>?,
    val nextActions: List<NextAction>,
    val quickReplies: List<QuickReply>,
    val footnote: String?,
    val createdAt: Instant,
)

/**
 * 다음 행동(BR-U8-06). [type] 은 closed-set 이지만 **문자열로 둔다** — 저장된 옛 행에 지금은 없는 값이 있어도
 * 목록 조회가 죽지 않아야 하고, 앱은 모르는 값을 그리지 않는다.
 */
data class NextAction(val type: String, val label: String, val params: Map<String, String> = emptyMap())

/** 서버가 발급한 빠른 답(domain-entities §3.4). 앱은 만들지 않는다 — 발급된 [id] 만 ACTION 턴으로 받는다. */
data class QuickReply(val id: String, val label: String, val action: QuickReplyAction, val params: Map<String, String> = emptyMap())

enum class QuickReplyAction { SEND_TEXT, REVIEW, PICK_CANDIDATE, PICK_OPTION, SHOW_CAPABILITIES, RETRY }

interface AssistantMessageRepository {
    /**
     * [beforeSeq] 보다 앞선 메시지 중 **가장 최근 [limit] 건**을 대화 순서(오래된 것 먼저)로.
     * [beforeSeq] 가 null 이면 맨 끝에서부터다.
     */
    fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int): List<AssistantMessage>
}
