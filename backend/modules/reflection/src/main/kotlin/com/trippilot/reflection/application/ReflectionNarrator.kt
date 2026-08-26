package com.trippilot.reflection.application

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
 * `AI` 단은 아직 없다(O-U5-6) — `ai/` 에 회고 경계가 없고 backend 에 LLM 게이트웨이도 없다.
 * 규칙으로 먼저 열고 `source` 로 품질을 관측한 뒤 붙인다.
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
    const val BASIC_DAILY = "이 날은 기록된 방문이 없어요. 다녀온 곳을 남기면 회고가 채워져요."
}
