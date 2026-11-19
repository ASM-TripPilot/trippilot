package com.trippilot.auth.application

import com.trippilot.auth.domain.port.AccountRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration

/**
 * 계정 최종 파기(BR-U0-25 · 처리방침 "탈퇴 요청 후 30일 유예기간이 지나면 파기").
 *
 * `purge_at` 이 지났고 철회되지 않은 삭제 예약의 계정을 지운다. 연관 데이터는 account 직결 FK 의 ON DELETE CASCADE 가
 * 한 문장 안에서 지운다(CascadeSummary.purgeScheduled — DeletionCascadeNoticeIT 가 목록과 스키마를 맞춘다).
 * 법정 보존(consent_record · location_legal_log)은 FK 가 없어 남는다(V2.94).
 *
 * 정본 이탈: U0 의 상태 전이는 `DELETION_PENDING --purge_at--> DELETED` 지만 행을 남기지 않고 지운다 — 남긴 행은 그 자체가
 * 개인정보(이메일·생년월일)를 붙든 채 "파기했다"고 말하게 되고, 연관 데이터를 지우려면 모듈마다 삭제 경로를 따로 둬야 한다.
 * 그래서 `DELETED` 상태는 이 배치가 쓰지 않는다.
 *
 * 순서: 제공자 토큰 revoke([ProviderTokenRevocationSweeper])가 social_identity 의 토큰으로 돈다 — 계정을 먼저 지우면 revoke
 * 기회가 사라진다. 토큰이 남은 계정은 [REVOCATION_GRACE] 동안 미루고, 그 뒤에는 revoke 실패와 상관없이 파기한다(파기 약속이 우선).
 *
 * ShedLock 없음 — 두 인스턴스가 같은 회차에 돌아도 한 행은 한 번만 지워진다(나머지는 0행).
 */
@Component
class AccountPurgeSweeper(
    private val accounts: AccountRepository,
    private val clock: Clock,
) {
    @Scheduled(
        fixedDelayString = "\${trippilot.auth.account-purge-sweep-ms:3600000}",
        initialDelayString = "\${trippilot.auth.account-purge-initial-delay-ms:120000}",
    )
    fun sweep() {
        var total = 0
        do {
            val purged = accounts.purgeDue(clock.instant(), REVOCATION_GRACE, BATCH)
            total += purged.size
            // 계정 id 는 가명 식별자다 — 이메일·닉네임은 싣지 않는다. 파기 사실의 유일한 흔적이라 INFO 로 남긴다.
            if (purged.isNotEmpty()) log.info("유예가 지난 계정 {}건을 파기했습니다: {}", purged.size, purged.map { it.value })
        } while (purged.size == BATCH)
        if (total > 0) log.info("계정 파기 회차 끝 — {}건", total)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AccountPurgeSweeper::class.java)
        const val BATCH = 100
        // ponytail: revoke 가 이 기간 내내 실패하면 토큰을 남긴 채 파기한다 — 실패 원인은 revoke 스위프 WARN 으로 본다.
        val REVOCATION_GRACE: Duration = Duration.ofDays(7)
    }
}
