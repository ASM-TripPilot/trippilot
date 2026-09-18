package com.trippilot.moderation.domain

/** 금칙어 사전 조회 포트 — 활성 버전(INV-B1). */
interface BannedWordDictionaryRepository {
    fun findActive(): BannedWordDictionary?
}
