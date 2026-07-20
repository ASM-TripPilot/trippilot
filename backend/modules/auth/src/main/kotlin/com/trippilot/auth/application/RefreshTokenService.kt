package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.auth.domain.port.RefreshTokenGenerator
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant

/** 발급된 리프레시 토큰 — 원문 + 만료 시각. */
data class IssuedRefreshToken(val rawToken: String, val expiresAt: Instant)

/** 회전 결과 — 소유 계정 + 새 리프레시 토큰(원문 + 만료). */
data class RotatedRefreshToken(val accountId: AccountId, val rawToken: String, val expiresAt: Instant)

/**
 * 리프레시 세션 발급·회전·폐기.
 *
 * 회전(rotate): 제시된 토큰을 소진 처리하고 같은 체인에 새 토큰을 발급한다.
 * 소진된(회전됨) 토큰이 다시 제시되면 **재사용**으로 판정해 체인 전체를 폐기한다(INV-R2, 탈취 대응).
 *
 * `noRollbackFor=AuthenticationRequired`: 재사용 탐지 시 체인 폐기(쓰기)는 커밋하면서 401 을 던지기 위함.
 * 그 외 실패(미존재·만료)는 쓰기가 없어 롤백/커밋 여부가 무의미하다.
 */
@Service
class RefreshTokenService(
    private val repository: RefreshSessionRepository,
    private val accountRepository: AccountRepository,
    private val generator: RefreshTokenGenerator,
    private val properties: RefreshTokenProperties,
    private val clock: Clock,
) {
    @Transactional
    fun issueFor(accountId: AccountId, deviceId: String): IssuedRefreshToken {
        val token = generator.generate()
        val session = RefreshSession.issue(accountId, deviceId, token.tokenHash, clock.instant(), properties.ttl)
        repository.save(session)
        return IssuedRefreshToken(rawToken = token.rawToken, expiresAt = session.expiresAt)
    }

    @Transactional(noRollbackFor = [AuthenticationRequired::class])
    fun rotate(rawToken: String): RotatedRefreshToken {
        val now = clock.instant()
        val session = repository.findByTokenHash(generator.hash(rawToken)) ?: throw invalid()

        if (session.isRevoked()) throw invalid()
        // 재사용 판정은 만료보다 우선 — 소진된 토큰의 재제시는 만료 여부와 무관하게 탈취 신호다(INV-R2).
        if (session.isRotated()) {
            repository.revokeChain(session.chainId, now) // 재사용 → 체인 전체 폐기(INV-R2)
            throw AuthenticationRequired("리프레시 토큰 재사용이 감지되었습니다.", ErrorCode.REFRESH_REUSE_DETECTED)
        }
        if (session.isExpired(now)) throw invalid()

        // 정지·파기 계정은 갱신 차단 — canAuthenticate 게이트를 refresh 경로에도 적용(SECURITY-15, 사유 비노출).
        // 삭제 유예 만료 시 세션 캐스케이드 폐기는 TRIP-158 몫; 여기서는 최소 게이트만.
        val account = accountRepository.findById(session.accountId) ?: throw invalid()
        if (!account.canAuthenticate()) throw AuthenticationRequired()

        repository.save(session.rotate(now)) // 소진 처리 — UPDATE 를 먼저 flush 해 부분 유니크 인덱스 위반 방지
        val token = generator.generate()
        val next = RefreshSession.next(session, token.tokenHash, now, properties.ttl)
        repository.save(next)
        return RotatedRefreshToken(accountId = session.accountId, rawToken = token.rawToken, expiresAt = next.expiresAt)
    }

    @Transactional
    fun revoke(rawToken: String) { // 로그아웃 — 멱등(미존재·이미 폐기면 무시)
        val session = repository.findByTokenHash(generator.hash(rawToken)) ?: return
        if (!session.isRevoked()) repository.save(session.revoke(clock.instant()))
    }

    private fun invalid() = AuthenticationRequired("리프레시 토큰이 유효하지 않습니다.", ErrorCode.REFRESH_TOKEN_INVALID)
}
