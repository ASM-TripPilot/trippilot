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
    /** **null 과 빈 목록은 뜻이 다르다** — null 은 "정하지 않았다"(앱이 대화의 시작 빠른 답을 보인다), 빈 목록은 "보일 것이 없다". */
    val quickReplies: List<QuickReply>?,
    val footnote: String?,
    val createdAt: Instant,
)

/**
 * 다음 행동(BR-U8-06). [type] 은 closed-set 이지만 **문자열로 둔다** — 저장된 옛 행에 지금은 없는 값이 있어도
 * 목록 조회가 죽지 않아야 하고, 앱은 모르는 값을 그리지 않는다.
 */
data class NextAction(val type: String, val label: String, val params: Map<String, String> = emptyMap()) {
    companion object {
        /** 서버가 **만드는** 값의 closed-set(domain-entities §3.4) — 앱의 라우트 표와 같은 집합이다. */
        val TYPES = setOf(
            "OPEN_ITINERARY", "OPEN_ITINERARY_EDIT", "OPEN_ITINERARY_METHOD", "OPEN_REGENERATE", "OPEN_REPLAN", "OPEN_LIVE",
            "OPEN_PLACE", "OPEN_STAY_SEARCH", "OPEN_OTA", "OPEN_REFLECTION", "OPEN_TRIP_SUMMARY", "OPEN_STYLE", "CREATE_TRIP",
            "RETRY_TURN", "CONTINUE_WITHOUT_ASSISTANT", "SHOW_CAPABILITIES", "RESTORE_REVISION",
        )
    }
}

/**
 * 서버가 발급한 빠른 답(domain-entities §3.4). 앱은 만들지 않는다 — 발급된 [id] 만 ACTION 턴으로 받는다.
 *
 * [action] 도 [NextAction.type] 처럼 **문자열로 둔다**. 저장된 행을 읽는 타입이라, 어휘가 늘어난 뒤 옛 파드가(배포 중·
 * 롤백 뒤) 새 값을 만나도 목록 조회가 죽으면 안 된다. 만들 때는 [QuickReplyAction] 으로 만든다.
 */
data class QuickReply(val id: String, val label: String, val action: String, val params: Map<String, String> = emptyMap()) {
    constructor(id: String, label: String, action: QuickReplyAction, params: Map<String, String> = emptyMap()) :
        this(id, label, action.name, params)
}

enum class QuickReplyAction { SEND_TEXT, REVIEW, PICK_CANDIDATE, PICK_OPTION, SHOW_CAPABILITIES, RETRY }

/**
 * 저장할 메시지. [seq] 와 시각은 저장소가 매긴다.
 *
 * 관측 칸 넷(OBS-U8-01)은 도우미 행에 채운다 — 알람·지표의 원천을 DB 행에 둔다. 화면에 쓰지 않는다.
 * 사용자 행은 [matchRoute]·[intent] 둘만 쓴다: 버튼을 눌러 생긴 행이면 `ACTION` 과 그 버튼의 종류를 적어,
 * 직접 한 말(둘 다 null)과 가른다.
 */
data class NewMessage(
    val role: MessageRole,
    val kind: MessageKind,
    val text: String?,
    val redacted: Boolean = false,
    val payload: Map<String, Any?>? = null,
    val nextActions: List<NextAction> = emptyList(),
    /** null = 정하지 않았다(앱이 대화의 시작 빠른 답을 보인다). */
    val quickReplies: List<QuickReply>? = null,
    val intent: String? = null,
    val matchRoute: String? = null,
    val outcome: String? = null,
    val llmCalls: Int? = null,
    val latencyMs: Int? = null,
)

/**
 * 이미 들어온 턴 — 사용자 행과 **그 턴에 대한** 도우미 행들.
 *
 * @property redaction 사용자 행이 가려진 이유([NewMessage.outcome]). 가려지지 않았으면 null.
 */
data class RecordedTurn(val user: AssistantMessage, val replies: List<AssistantMessage>, val redaction: String? = null)

interface AssistantMessageRepository {
    /** 사용자 행을 넣는다. [clientTurnId] 가 멱등 키다 — 같은 값이 이미 있으면 유니크 위반으로 실패한다(호출측이 먼저 [findTurn] 한다). */
    fun appendUser(sessionId: UUID, accountId: UUID, clientTurnId: UUID, message: NewMessage, at: Instant): AssistantMessage

    /** [replyTo] 는 이 응답이 답하는 턴의 id 다 — 응답을 위치가 아니라 턴에 묶는다. */
    fun appendAssistant(sessionId: UUID, accountId: UUID, replyTo: UUID, message: NewMessage, at: Instant): AssistantMessage

    /** 그 턴 id 로 이미 받은 턴(INV-U8-05). 없으면 null. */
    fun findTurn(sessionId: UUID, clientTurnId: UUID): RecordedTurn?

    /** [since] 이후 그 계정의 사용자 턴 시각(오래된 것 먼저) — 분당 제한(BR-U8-24)이 **세션을 건너** 계정으로 센다. */
    fun userTurnTimesSince(accountId: UUID, since: Instant): List<Instant>

    /** 그 세션의 도우미 메시지가 발급한 빠른 답 중 [quickReplyId] 인 것(가장 최근). 발급된 적 없으면 null. */
    fun findIssuedQuickReply(sessionId: UUID, quickReplyId: String): QuickReply?

    /**
     * [beforeSeq] 앞의 가장 최근 **직접 한 말** — [다시 시도]가 다시 태울 문장이다. 가려진 입력과 버튼을 눌러 생긴 행은
     * 건너뛴다: 버튼 문구는 말이 아니고, [다시 시도]를 연달아 누르면 "다시 시도"라는 말을 해석하게 된다.
     */
    fun lastUserText(sessionId: UUID, beforeSeq: Long): String?

    /**
     * [beforeSeq] 보다 앞선 메시지 중 **가장 최근 [limit] 건**을 대화 순서(오래된 것 먼저)로.
     * [beforeSeq] 가 null 이면 맨 끝에서부터다.
     */
    fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int): List<AssistantMessage>
}
