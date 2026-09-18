package com.trippilot.profile.domain

import kotlin.random.Random

/** 닉네임 검증 사유(INV-B3 — 매칭 원문 미노출, 범주만). */
enum class NicknameCheckReason { OK, TOO_SHORT, TOO_LONG, BANNED_WORD, TAKEN }

/** 닉네임 규칙(INV-P1) — 2~20자(코드포인트 기준, DB char_length 와 일치). */
object NicknameRules {
    const val MIN_LENGTH = 2
    const val MAX_LENGTH = 20

    fun length(nickname: String): Int = nickname.codePointCount(0, nickname.length)

    /** 길이 위반 사유 — 정상이면 null. */
    fun lengthViolation(nickname: String): NicknameCheckReason? = when {
        length(nickname) < MIN_LENGTH -> NicknameCheckReason.TOO_SHORT
        length(nickname) > MAX_LENGTH -> NicknameCheckReason.TOO_LONG
        else -> null
    }
}

/**
 * 닉네임 자동 생성(G23). 형용사+명사+숫자. **재추첨 최대 10회 → 자릿수 확장 폴백**(INV-P1 수렴 보장).
 * 유효성([isAcceptable]: 길이·금칙어·유일)은 호출자가 주입 — 도메인은 조합·재시도만 소유(퍼사드·저장소 미의존).
 */
object NicknameGenerator {
    // [플레이스홀더] 초기 단어 사전 — 추후 큐레이션 목록으로 교체(seed 규약과 동일). 10×10×90 ≈ 9000 조합.
    val ADJECTIVES = listOf("즐거운", "설레는", "용감한", "느긋한", "포근한", "반짝이는", "호기심많은", "따뜻한", "씩씩한", "잔잔한")
    val NOUNS = listOf("여행자", "방랑자", "탐험가", "나그네", "항해사", "산책자", "떠돌이", "순례자", "길잡이", "몽상가")

    private const val TRIES_PER_PHASE = 10
    private val DIGIT_PHASES = listOf(10..99, 1000..9999) // 2자리 재추첨 → 4자리 확장

    /** 수용되는 첫 후보. 두 단계(재추첨→자릿수 확장) 모두 실패하면 null(사실상 도달 불가). */
    fun generate(random: Random, isAcceptable: (String) -> Boolean): String? {
        for (phase in DIGIT_PHASES) {
            repeat(TRIES_PER_PHASE) {
                val candidate = ADJECTIVES.random(random) + NOUNS.random(random) + random.nextInt(phase.first, phase.last + 1)
                if (isAcceptable(candidate)) return candidate
            }
        }
        return null
    }
}
