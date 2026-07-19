package com.trippilot.moderation.domain

/** 금칙어 1건 — 단어 + 범주. */
data class BannedWord(val word: String, val category: String)

/**
 * 금칙어 사전(V1.6 banned_word_dictionary). 활성 버전은 항상 1개(INV-B1, DB 부분 유니크).
 * 매칭: 정규화(소문자·공백 제거) 후 부분일치 — 첫 매칭을 반환한다(원문은 서비스가 비노출 처리, INV-B3).
 */
class BannedWordDictionary(
    val version: String,
    val entries: List<BannedWord>,
    val active: Boolean,
) {
    /** 텍스트에 금칙어가 포함되면 해당 [BannedWord], 없으면 null. */
    fun match(text: String): BannedWord? {
        val normalized = normalize(text)
        return entries.firstOrNull { entry ->
            val word = normalize(entry.word)
            word.isNotEmpty() && normalized.contains(word)
        }
    }

    private fun normalize(value: String): String = value.lowercase().filterNot { it.isWhitespace() }
}
