package com.trippilot.moderation.application

import com.trippilot.core.error.ModerationUnavailable
import com.trippilot.moderation.api.ModerationVerdict
import com.trippilot.moderation.api.TextModerationFacade
import com.trippilot.moderation.domain.BannedWordDictionaryRepository
import org.springframework.stereotype.Service

/**
 * [TextModerationFacade] 구현(C3). 활성 금칙어 사전으로 검사.
 * 사전 미로드 시 [ModerationUnavailable](503) — 자동 통과 금지(fail-closed, INV-B2).
 * 매칭 원문은 반환하지 않고 범주만 노출한다(INV-B3).
 */
@Service
class TextModerationService(
    private val dictionaries: BannedWordDictionaryRepository,
) : TextModerationFacade {
    override fun inspect(text: String): ModerationVerdict {
        val dictionary = dictionaries.findActive() ?: throw ModerationUnavailable()
        val match = dictionary.match(text)
        return ModerationVerdict(clean = match == null, category = match?.category)
    }
}
