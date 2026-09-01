package com.trippilot.reflection.application

import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.ReflectionStats

/**
 * 근거 수치를 문장으로(BR-U5-31·32).
 *
 * **입력에 없는 것을 쓰지 않는다.** 장소 이름도 수치도 [ReflectionStats] 와 방문 목록 안에서만 나온다 —
 * "즐거운 하루였겠어요" 같은 문장은 근거가 없어 쓰지 않는다.
 *
 * 폴백 3단 중 아래 두 단이 여기 있다:
 * - `RULE` — 근거가 있을 때. 수치를 사람이 읽는 문장으로 엮는다
 * - `BASIC` — 근거가 없을 때(방문 0곳). **그래도 빈 문장을 내지 않는다**(PBT-U5-1)
 *
 * **산출물은 카드다**(DEC-U5-14 · BR-U5-32 개정 2026-09-01). 전에는 문장이었다 — 그러면 AI 가 죽는 날
 * 화면 모양 자체가 달라져 폴백의 뜻("같은 화면을 근거만 줄여 그린다")이 성립하지 않는다.
 *
 * `AI` 단은 칸 2·3 에서 붙인다(O-U5-6 이 `http` 로 확정). 여기는 그 아래 두 단이다.
 */
object ReflectionNarrator {

    /** 근거가 있으면 [ReflectionSource.RULE], 없으면 [ReflectionSource.BASIC]. */
    fun sourceFor(stats: ReflectionStats): ReflectionSource =
        if (stats.visitCount > 0) ReflectionSource.RULE else ReflectionSource.BASIC

    /**
     * 하루 문장.
     *
     * 없는 항목은 **명시적으로 누락 표기**한다(BR-U5-34) — 조용히 칸을 지우면 사용자는 그 항목이
     * 원래 없는 줄 안다. 사진 0장이면 "사진은 남기지 않았어요"라고 쓴다.
     */
    /**
     * 하루 카드. [RULE_TEMPLATE]/[BASIC_TEMPLATE] 이 우리가 만든 카드임을 밝힌다 — 상대 템플릿과
     * 섞이면 "이 카드가 어디서 왔나"를 `template_id` 로 가릴 수 없다.
     *
     * **장면은 근거가 있을 때만 만든다.** 방문 0곳이면 `scenes` 가 빈 목록이다 — 지어내면
     * BR-U5-31(환각 금지)을 어긴다. 그래서 PBT-U5-F1 도 장면 개수를 조건으로 걸지 않는다.
     */
    fun dailyCard(placeNames: List<String>, stats: ReflectionStats): ReflectionCard {
        val title = dailyTitle(placeNames, stats)
        val subtitle = daily(placeNames, stats)
        val scenes = placeNames.map { name ->
            """{"layout":"TEXT","caption":${quote("$name 을(를) 다녀왔어요.")}}"""
        }
        val template = if (stats.visitCount == 0) BASIC_TEMPLATE else RULE_TEMPLATE
        val payload = """{"template_id":${quote(template)},"format":"CARD",""" +
            """"cover":{"title":${quote(title)},"subtitle":${quote(subtitle)}},""" +
            """"scenes":[${scenes.joinToString(",")}]}"""
        return ReflectionCard(template, "CARD", title, subtitle, payload)
    }

    /** 카드 제목 — 목록 화면이 쓰는 짧은 문구다. 근거가 없으면 그 사실을 제목으로 말한다. */
    private fun dailyTitle(placeNames: List<String>, stats: ReflectionStats): String = when {
        stats.visitCount == 0 -> "기록이 없는 하루"
        placeNames.isEmpty() -> "${stats.visitCount}곳을 다녀온 하루"
        else -> "${placeNames.first()}${if (placeNames.size > 1) " 외 ${placeNames.size - 1}곳" else ""}"
    }

    /** JSON 문자열 이스케이프 — 장소 이름에 따옴표·역슬래시가 들어와도 카드가 깨지지 않는다. */
    private fun quote(raw: String): String =
        buildString {
            append('"')
            raw.forEach {
                when (it) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\n' -> append("\\n")
                    else -> if (it < ' ') append("\\u%04x".format(it.code)) else append(it)
                }
            }
            append('"')
        }

    fun daily(placeNames: List<String>, stats: ReflectionStats): String {
        if (stats.visitCount == 0) return BASIC_DAILY
        val places = when {
            placeNames.isEmpty() -> "${stats.visitCount}곳"
            placeNames.size <= 3 -> placeNames.joinToString("·")
            else -> placeNames.take(3).joinToString("·") + " 외 ${placeNames.size - 3}곳"
        }
        return buildString {
            append("$places 을(를) 다녀왔어요.")
            // 근사값을 실측처럼 쓰지 않는다 — 어림임을 문장에도 남긴다(BR-U5-43).
            if (stats.distanceKm > 0) append(" 이동 거리는 약 ${"%.1f".format(stats.distanceKm)}km 였어요.")
            append(if (stats.photoCount > 0) " 사진 ${stats.photoCount}장을 남겼어요." else " 사진은 남기지 않았어요.")
        }
    }

    /**
     * 근거가 하나도 없을 때의 기본 카드(BR-U5-32 3단 · PBT-U5-1).
     *
     * **이 문장이 존재하는 것 자체가 요구사항이다** — 방문 0곳이라고 빈 화면을 그리면 사용자는
     * 회고 기능이 고장 난 줄 안다.
     */
    const val RULE_TEMPLATE = "backend.rule.daily.v1"
    const val BASIC_TEMPLATE = "backend.basic.daily.v1"

    const val BASIC_DAILY = "이 날은 기록된 방문이 없어요. 다녀온 곳을 남기면 회고가 채워져요."
}
