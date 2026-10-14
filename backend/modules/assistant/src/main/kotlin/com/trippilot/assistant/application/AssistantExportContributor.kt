package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
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
