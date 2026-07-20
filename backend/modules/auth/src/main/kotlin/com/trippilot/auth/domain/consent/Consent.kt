package com.trippilot.auth.domain.consent

import com.trippilot.auth.domain.AccountId
import java.time.Instant

/** 동의 행위. */
enum class ConsentAction { GRANT, REVOKE }

/** 동의가 기록된 경로 — 온보딩 일괄 / 재동의 게이트 / 설정 화면. */
enum class ConsentChannel { ONBOARDING, RECONSENT, SETTINGS }

/**
 * 동의 증적 — **append-only 이벤트**(V1.2 consent_record, INV-C1: app_user 는 UPDATE/DELETE 불가).
 * 상태를 갱신하지 않고 항상 새 레코드를 추가한다. 현재 상태는 타입별 최신 레코드로 접는다([ConsentFold], INV-C2).
 * DB 식별자(record_id, bigint IDENTITY)는 영속 관심사라 도메인엔 두지 않는다.
 */
class ConsentRecord private constructor(
    val accountId: AccountId,
    val termsType: TermsType,
    val termsVersion: String,
    val action: ConsentAction,
    val channel: ConsentChannel,
    val occurredAt: Instant,
) {
    val isGrant: Boolean get() = action == ConsentAction.GRANT

    companion object {
        /** 증적 생성/재구성 — 불변식 없음(추가 전용). */
        fun of(
            accountId: AccountId,
            termsType: TermsType,
            termsVersion: String,
            action: ConsentAction,
            channel: ConsentChannel,
            occurredAt: Instant,
        ): ConsentRecord = ConsentRecord(accountId, termsType, termsVersion, action, channel, occurredAt)
    }
}

/** 항목별 현재 동의 상태(증적 폴드 결과). */
data class ConsentStatus(
    val termsType: TermsType,
    val granted: Boolean,
    val termsVersion: String,
)

/** 동의 증적을 접어 현재 상태를 도출(INV-C2). 순수 로직 — 도메인 소유. */
object ConsentFold {
    /** 타입별 최신 증적(occurredAt 최대). 순서 미가정. */
    fun latestPerType(records: List<ConsentRecord>): Map<TermsType, ConsentRecord> =
        records.groupBy { it.termsType }
            .mapValues { (_, rs) -> rs.maxBy { it.occurredAt } }

    /** 타입별 현재 상태 목록. */
    fun statuses(records: List<ConsentRecord>): List<ConsentStatus> =
        latestPerType(records).map { (type, rec) -> ConsentStatus(type, rec.isGrant, rec.termsVersion) }
}
