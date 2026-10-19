package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.Clock
import java.util.UUID

/**
 * 도우미 대화 몫(DATA-U8-06) — 사용자가 한 말과 도우미의 답. 개인 발화도 정보주체 열람 대상이다.
 *
 * **한 줄이 메시지 하나다**(대화 단위로 묶지 않는다) — 내보내기의 상한과 "잘렸음" 표지가 줄 수로 세기 때문이다.
 * 대화를 한 줄로 내면 긴 대화가 통째로 들어가 상한이 뜻을 잃는다.
 *
 * 정책 위반으로 가려진 입력은 **원문이 서버에 없다**(BR-U8-23) — 표지만 낸다. 카드 내용(`payload`)은 일정·장소에서
 * 온 값의 사본이라 내지 않는다(그 값들은 각자의 몫으로 나간다).
 */
@Component
class AssistantExportContributor(
    private val sessions: AssistantSessionRepository,
    private val messages: AssistantMessageRepository,
    private val clock: Clock,
) : AccountDataContributor {
    override val section = "assistantMessages"

    override fun export(accountId: UUID, limit: Int): ExportSection {
        // 계정 경계는 대화 목록에서만 넘는다 — 메시지는 대화에 매달려 있고, 대화가 계정을 안다.
        val rows = sessions.findByAccount(accountId, clock.instant(), SESSION_SCAN_LIMIT).asSequence().flatMap { session ->
            // 상한보다 하나 더 읽는다 — 그래야 잘렸는지를 안다.
            messages.findPage(session.sessionId, beforeSeq = null, limit = limit + 1).asSequence().map { m ->
                mapOf(
                    "sessionId" to session.sessionId.toString(),
                    "tripId" to session.tripId?.toString(),
                    "role" to m.role.name,
                    "kind" to m.kind.name,
                    "text" to m.text,
                    "redacted" to (m.role == MessageRole.USER && m.text == null),
                    "createdAt" to m.createdAt.toString(),
                    // 그 답에 남긴 평가(US-ASSIST-09) — 대화의 부속이라 몫을 따로 두지 않고 그 줄에 싣는다(BR-U8-62).
                    // 싫어요에 함께 남긴 이유·의견도 그 줄의 칸이다 — 의견은 사용자가 쓴 글이라 열람 대상이다(DATA-U8-06)
                    "feedback" to m.feedback?.rating?.name,
                    "feedbackReason" to m.feedback?.reason?.name,
                    "feedbackComment" to m.feedback?.comment,
                )
            }
        }.take(limit + 1).toList()
        return ExportSection.of(section, rows, limit)
    }

    private companion object {
        /** 훑을 대화 수 — 여행마다 하나이고 보존 기간이 지나면 사라지므로 이 수를 넘기 어렵다. */
        private const val SESSION_SCAN_LIMIT = 500
    }
}

/**
 * 상대가 쥔 대화 요약 몫(DATA-U8-06 · assistant-orchestrator DE §4.1) — 사용자 발화의 **파생물**도 열람 대상이다.
 * 한 줄이 요약 한 줄이다(위 몫과 같은 이유 — 상한과 "잘렸음"이 줄 수로 센다).
 *
 * 상대를 못 읽으면 **비우고 잘렸다고 표시한다** — 받은 것이 전부인 줄 알게 두지 않는다(INV-4). 통째로 실패시키면 다른 몫까지
 * 내려받지 못한다. ponytail: 정본(DE §4.1)은 "섹션 누락"이라 적었지만 조립(`AccountExportService`)에 몫을 빼는 수단이 없어
 * 기존 `truncated` 표지를 빌린다 — 미결 #13 묶음. 조립이 "읽지 못함"을 따로 알리게 되면 그쪽으로 옮긴다.
 */
@Component
class AssistantMemoryExportContributor(private val memory: DialogueMemoryPort) : AccountDataContributor {
    override val section = "assistantMemory"

    override fun export(accountId: UUID, limit: Int): ExportSection {
        val items = runCatching { memory.export(accountId.toString()) }.getOrElse { e ->
            log.warn("도우미 상대 메모리 내보내기 실패 — 이 몫은 비우고 잘림으로 표시합니다. type={}", e.javaClass.simpleName)
            return ExportSection(section, emptyList(), truncated = true)
        }
        val rows = items.flatMap { m ->
            m.summary.map { line -> mapOf("sessionId" to m.sessionId, "tripId" to m.tripId, "line" to line, "updatedAt" to m.updatedAt.toString()) }
        }
        return ExportSection.of(section, rows, limit)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AssistantMemoryExportContributor::class.java)
    }
}
