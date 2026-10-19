package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.WarningArea

/**
 * 특보현황 `t6`(발효 중 특보) 문장 → 특보 목록(BR-SA-16 — 형식은 실응답 표본으로 고정한다).
 *
 * 형식: 줄마다 `o {종류}{주의보|경보} : {구역}, {구역}…`, 구역 = `광역(하위, 하위)` · `광역` · `광역(하위, 하위 제외)` · `울릉도.독도`.
 * 특보가 없으면 `o 없 음` 이다(공백 변주가 실재한다 — 2026-10-19 실응답). 글머리 없는 줄은 앞 줄이 접힌 것으로 본다.
 * 원문 이름을 고치지 않는다 — 바다 구역·광역 별칭·시군 어간 매칭은 감지기 몫이다(BR-SA-16).
 *
 * **한 줄이라도 못 읽으면 전부 null** 이다 — 못 읽은 줄을 빼고 나머지로 '특보 없음'을 확인하면 모름이 해제가 된다(INV-SA-2).
 */
internal object KmaWarningText {

    private val LEVELS = listOf("주의보", "경보")
    private val WHITESPACE = Regex("\\s+")
    private val BULLETS = setOf('o', '○')
    private const val NONE = "없음"
    private const val EXCLUDING = "제외"

    fun parse(t6: String): List<ActiveWarning>? {
        val compact = WHITESPACE.replace(t6, "")
        if (compact.isEmpty()) return null
        if (compact.dropWhile { it in BULLETS } == NONE) return emptyList()
        val entries = mutableListOf<String>()
        for (line in t6.lines().map { it.trim() }.filter { it.isNotEmpty() }) {
            when {
                line.first() in BULLETS -> entries += line.drop(1).trim()
                entries.isNotEmpty() -> entries[entries.lastIndex] = entries.last() + " " + line // 접힌 줄
                else -> return null
            }
        }
        return entries.map { warningOf(it) ?: return null }
    }

    /** `강풍주의보 : 경상북도(영덕, 포항), 울산` → 특보 하나. */
    private fun warningOf(entry: String): ActiveWarning? {
        val colon = entry.indexOf(':')
        if (colon < 0) return null
        val title = WHITESPACE.replace(entry.substring(0, colon), "")
        val level = LEVELS.firstOrNull { title.endsWith(it) } ?: return null
        val type = title.removeSuffix(level).takeIf { it.isNotEmpty() } ?: return null
        val pieces = splitTopLevel(entry.substring(colon + 1)) ?: return null
        return ActiveWarning(type, level, pieces.map { areaOf(it) ?: return null })
    }

    /** 괄호 밖 쉼표로만 가른다 — `경상북도(영덕, 포항), 울산` → 둘. 괄호 짝이 안 맞거나 빈 칸이 있으면 null. */
    private fun splitTopLevel(text: String): List<String>? {
        val pieces = mutableListOf<String>()
        val current = StringBuilder()
        var depth = 0
        for (c in text) {
            when (c) {
                '(' -> depth++
                ')' -> if (--depth < 0) return null
            }
            if (c == ',' && depth == 0) {
                pieces += current.toString().trim()
                current.clear()
            } else {
                current.append(c)
            }
        }
        if (depth != 0) return null
        pieces += current.toString().trim()
        return pieces.takeIf { all -> all.none { it.isEmpty() } }
    }

    /** `경상북도(영덕, 포항)` · `울산` · `인천(강화군, 옹진군 제외)` → 구역 한 칸. */
    private fun areaOf(piece: String): WarningArea? {
        val open = piece.indexOf('(')
        if (open < 0) return WarningArea(piece).takeIf { ')' !in piece }
        if (!piece.endsWith(")")) return null
        val name = piece.substring(0, open).trim().takeIf { it.isNotEmpty() } ?: return null
        val zones = piece.substring(open + 1, piece.length - 1).split(',').map { it.trim() }.toMutableList()
        val excluding = zones.last().endsWith(EXCLUDING)
        if (excluding) zones[zones.lastIndex] = zones.last().removeSuffix(EXCLUDING).trim()
        if (zones.any { it.isEmpty() || '(' in it || ')' in it }) return null
        return WarningArea(name, zones, excluding)
    }
}
