package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 동의 이력 몫(TRIP-551).
 *
 * `consent_record` 는 **append-only** 테이블이다(앱 롤에 UPDATE/DELETE 없음). 여기서는 **읽기만** 한다 —
 * 내보내기가 증적을 건드리면 그 테이블이 증적 노릇을 못 한다.
 */
@Component
class ConsentExportContributor(private val consents: ConsentRecordRepository) : AccountDataContributor {
    override val section = "consents"

    override fun export(accountId: UUID, limit: Int): ExportSection = ExportSection.of(
        section,
        consents.findByAccount(AccountId(accountId)).sortedByDescending { it.occurredAt }.map {
            mapOf(
                "termsType" to it.termsType.name,
                "action" to it.action.name,
                "channel" to it.channel.name,
                "termsVersion" to it.termsVersion,
                "occurredAt" to it.occurredAt.toString(),
            )
        },
        limit,
    )
}
