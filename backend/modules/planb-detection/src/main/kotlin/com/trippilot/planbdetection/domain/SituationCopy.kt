package com.trippilot.planbdetection.domain

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * 상황 문구 가드(설계서 규칙 13 · CD15) — 감지기가 만든 사유 문장을 저장 전에 거른다.
 * 감지기·판정(reconcile)·PBT 가 **같은 한 벌**을 쓴다(문구 필터 4벌이 갈라졌던 것을 하나로 — 검토 K minor).
 *
 * 금지
 * - 200자 초과 — `plan_b_trigger.reason varchar(200)` 이라 저장이 통째로 실패한다.
 * - 상대 날짜어(오늘·내일·모레) — 저장된 문장은 다음 날 틀린 말이 된다. 미래일은 [dayPrefix] 를 쓴다.
 * - 소요·지연 시간(INV-3 · DEC-U4-9) — AI `llm_gateway/gates/reminder_copy.py` 의 `_DURATION` 과 같은 정의(한글 수사 포함).
 * - 좌표 꼴(SEC-U4-04).
 *
 * 허용 — 계획된 시작의 '시'(오후 3시)와 예보 시간대(오전·오후). 막는 것은 시각 '재추정'이지 계획 시각이 아니다(CD15).
 *
 * **장소명 자리는 비우고 검사한다** — '365분식'·'4시30분왕족발'·'오늘의커피' 같은 상호를 위반으로 읽으면
 * 그 장소가 든 날의 경보가 통째로 사라진다.
 */
object SituationCopy {

    const val MAX_LENGTH = 200

    /** 수량 — AI `_NUM` 과 같다. */
    private const val NUM = "(?:\\d+|[일이삼사오육칠팔구십]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|반)"

    /** AI `_DURATION` 과 같은 정의 — 앞 글자가 한글이면 수량으로 보지 않는다('계획한 시간'의 '한 시간'). */
    private val DURATION = Regex(
        "(?<![가-힣])$NUM\\s*(?:분|시간)" +
            "|(?:이동|소요|대기|운전|도보|체류)\\s*시간" +
            "|시간이\\s*(?:걸|소요)" +
            "|시각(?![적화])" +
            "|duration",
        RegexOption.IGNORE_CASE,
    )
    private val RELATIVE_DAY = Regex("오늘|내일|모레")
    private val COORDINATE = Regex("\\d{2,3}\\.\\d{4,}")
    private val DAY_PREFIX: DateTimeFormatter = DateTimeFormatter.ofPattern("M월 d일(E)", Locale.KOREAN)

    /**
     * 위반 이름(로그용). 통과하면 null.
     * @param placeNames 이 문장에 넣었을 수 있는 장소명 — 그 자리를 공백으로 비우고 본다(긴 이름부터).
     */
    fun violation(reason: String, placeNames: Collection<String>): String? {
        if (reason.isBlank()) return "blank"
        if (reason.length > MAX_LENGTH) return "too-long"
        val masked = placeNames.filter { it.isNotBlank() }.sortedByDescending { it.length }
            .fold(reason) { text, name -> text.replace(name, " ") }
        return when {
            RELATIVE_DAY.containsMatchIn(masked) -> "relative-day"
            DURATION.containsMatchIn(masked) -> "duration"
            COORDINATE.containsMatchIn(masked) -> "coordinate"
            else -> null
        }
    }

    /** 미래일 문장 머리 — `10월 20일(화)`. 상대 날짜어 대신 쓴다. */
    fun dayPrefix(date: LocalDate): String = date.format(DAY_PREFIX)
}
