package com.trippilot.profile.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.moderation.api.TextModerationFacade
import com.trippilot.profile.domain.NicknameCheckReason
import com.trippilot.profile.domain.NicknameGenerator
import com.trippilot.profile.domain.NicknameRules
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID
import kotlin.random.Random

/** 닉네임 검사 결과 — 사유는 범주만(INV-B3, 매칭 원문 미노출). */
data class NicknameCheck(val available: Boolean, val reason: NicknameCheckReason)

/**
 * 닉네임 생성·검사·설정(TRIP-157). 3검증 순서 = 길이 → 금칙어(moderation 퍼사드) → 유일성.
 * moderation 은 R1 상 `moderation.api` 퍼사드로만 의존한다.
 */
@Service
class NicknameService(
    private val moderation: TextModerationFacade,
    private val profiles: ProfileRepository,
    private val clock: Clock,
) {
    /** 3검증 결과. 금칙어 사전 미로드 시 moderation 이 503(fail-closed). */
    @Transactional(readOnly = true)
    fun check(nickname: String): NicknameCheck {
        val reason = firstViolation(nickname)
        return NicknameCheck(reason == NicknameCheckReason.OK, reason)
    }

    /** 사전 검증 통과한 후보 [count] 개(G23). 각 후보는 3검증 통과 + 결과 내 중복 없음. */
    @Transactional(readOnly = true)
    fun suggestions(count: Int = SUGGESTION_COUNT): List<String> {
        val chosen = LinkedHashSet<String>()
        repeat(count) {
            NicknameGenerator.generate(Random.Default) { candidate ->
                candidate !in chosen && firstViolation(candidate) == NicknameCheckReason.OK
            }?.let { chosen.add(it) }
        }
        return chosen.toList()
    }

    /** 닉네임 설정 — 3검증 후 프로필 생성/갱신. 유일성 위반(선검사·경합 모두)은 409 NICKNAME_TAKEN. */
    @Transactional
    fun setNickname(accountId: UUID, nickname: String): Profile {
        when (firstViolation(nickname)) {
            NicknameCheckReason.TOO_SHORT -> throw lengthFailed("${NicknameRules.MIN_LENGTH}자 이상이어야 합니다")
            NicknameCheckReason.TOO_LONG -> throw lengthFailed("${NicknameRules.MAX_LENGTH}자 이하여야 합니다")
            // 범주·원문 비노출(INV-B3)
            NicknameCheckReason.BANNED_WORD -> throw ValidationFailed(listOf(FieldError("nickname", "사용할 수 없는 단어가 포함되어 있습니다")))
            NicknameCheckReason.TAKEN -> throw nicknameTaken()
            NicknameCheckReason.OK -> Unit
        }
        val now = clock.instant()
        val profile = profiles.find(accountId)?.withNickname(nickname, now) ?: Profile.create(accountId, nickname, now)
        return try {
            profiles.save(profile)
        } catch (e: DataIntegrityViolationException) {
            throw nicknameTaken() // 동시 설정 경합 — 유니크 인덱스 위반(INV-P1)
        }
    }

    /** 3검증(길이→금칙어→유일)의 첫 위반 사유, 통과면 OK. check·suggestions·setNickname 이 공유(드리프트 방지). */
    private fun firstViolation(nickname: String): NicknameCheckReason {
        NicknameRules.lengthViolation(nickname)?.let { return it }
        if (!moderation.inspect(nickname).clean) return NicknameCheckReason.BANNED_WORD
        if (profiles.existsByNickname(nickname)) return NicknameCheckReason.TAKEN
        return NicknameCheckReason.OK
    }

    private fun lengthFailed(message: String) = ValidationFailed(listOf(FieldError("nickname", message)))

    private fun nicknameTaken() =
        ConflictDetected(message = "이미 사용 중인 닉네임입니다.", errorCode = ErrorCode.NICKNAME_TAKEN)

    companion object {
        const val SUGGESTION_COUNT = 3
    }
}
