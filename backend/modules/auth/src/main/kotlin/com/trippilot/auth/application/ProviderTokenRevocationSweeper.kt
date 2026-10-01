package com.trippilot.auth.application

import com.trippilot.auth.domain.port.ProviderRevocationTokenRepository
import com.trippilot.auth.domain.port.ProviderTokenRevocationPort
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock

/**
 * 파기 시점 제공자 토큰 revoke(TRIP-933 · App Store 5.1.1(v)).
 *
 * **요청 시점이 아니라 파기 시점이다.** 요청 때 revoke 하면 30일 유예 안에 철회한 사용자의 애플 연결이
 * 이미 끊겨 있다 — 철회가 복구가 아니게 된다. 그래서 `purge_at` 이 지난(철회 안 된) 계정만 집는다.
 *
 * **revoke 실패는 파기를 막지 않는다.** 이 스위프는 계정·예약 상태를 건드리지 않고 토큰 컬럼만 본다 —
 * 성공하면 지우고, 실패(Apple 5xx·도달 불가·설정 없음)하면 남겨 다음 회차가 다시 집는다. 한 건의 실패가
 * 다음 대상으로 가는 것을 막지도 않는다. 재시도 큐를 따로 세우지 않은 이유는 토큰 컬럼 자체가 이미
 * "아직 안 한 것" 목록이기 때문이다(아웃박스는 도메인 이벤트 배달용이라, 외부 호출 재시도를 싣자면
 * 이벤트 스키마·구독자를 새로 만들어야 하고 얻는 것이 같다).
 *
 * ⚠️ **실제 계정 파기 배치는 아직 없다**(AccountDeletionService 주석 "실제 30일 파기 배치는 후속").
 * 그 배치가 생기면 social_identity 가 CASCADE 로 지워지기 **전에** 이 스위프가 돌아야 revoke 기회가 있다
 * — 파기 배치 앞단에서 [sweep] 을 한 번 부르거나, 토큰이 남은 계정의 파기를 한 주기 늦추면 된다.
 *
 * ShedLock 없음 — 두 인스턴스가 같은 토큰을 동시에 revoke 해도 Apple 쪽에서 멱등이다.
 */
@Component
class ProviderTokenRevocationSweeper(
    private val tokens: ProviderRevocationTokenRepository,
    private val revocation: ProviderTokenRevocationPort,
    private val clock: Clock,
) {
    @Scheduled(
        fixedDelayString = "\${trippilot.auth.provider-token-revoke-sweep-ms:3600000}",
        initialDelayString = "\${trippilot.auth.provider-token-revoke-initial-delay-ms:60000}",
    )
    fun sweep() {
        val due = tokens.findDueForRevocation(clock.instant(), BATCH)
        var revoked = 0
        for (target in due) {
            try {
                revocation.revoke(target.provider, target.token)
                tokens.clear(target.socialIdentityId)
                revoked++
            } catch (e: Exception) {
                // 토큰·client_secret 을 싣지 않는다 — 예외 종류만(SECURITY-15). 값은 남아 다음 회차에 재시도된다.
                log.warn(
                    "{} 토큰 revoke 실패(social_identity={}, {}) — 다음 회차에 다시 시도합니다.",
                    target.provider, target.socialIdentityId, e.javaClass.simpleName,
                )
            }
        }
        if (due.isNotEmpty()) log.info("파기 대상 제공자 토큰 {}건 중 {}건을 revoke 했습니다.", due.size, revoked)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ProviderTokenRevocationSweeper::class.java)
        const val BATCH = 100
    }
}
