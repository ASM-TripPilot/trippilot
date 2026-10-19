package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import java.time.LocalDate

/**
 * 상황 문구 가드(규칙 13 · CD15). 감지기·판정·이 PBT 가 같은 한 벌을 쓴다.
 * 핵심은 **장소명 때문에는 버리지 않는다** — '365분식'·'4시30분왕족발' 같은 상호가 소요시간 꼴에 걸려
 * 그 장소가 든 날의 경보가 통째로 사라지면 안 된다.
 */
class SituationCopyTest : StringSpec({

    /** 감지기 문구 틀(설계서 §4.2·§4.3 예) — 장소명 자리만 바뀐다. */
    val templates: List<(String) -> String> = listOf(
        { "‘$it’은 정기 휴무일로 나와요" },
        { "계획한 시간엔 ‘$it’ 문을 열지 않는 것으로 나와요" },
        { "${SituationCopy.dayPrefix(LocalDate.parse("2026-10-20"))} 오전에 비 소식이 있어요. $it 등 야외 일정 2곳이 영향을 받을 수 있어요." },
        { "오후 3시 $it 일정에 강풍 예보가 있어요" },
    )
    val names = Arb.choice(
        Arb.element("365분식", "4시30분왕족발", "40시간", "오늘의커피", "내일도맑음", "33.4567 카페", "따옴표\"가게'", "줄\n바꿈", "Duration Bar"),
        Arb.string(0..80),
    )

    "예 — 허용: 계획 시작의 '시'·예보 시간대·'계획한 시간엔'·'시각적'. 금지: 소요·지연·시각·좌표·상대 날짜어·빈 문장·200자 초과" {
        SituationCopy.violation("오후 3시 성산일출봉에 비 예보가 있어요", emptyList()).shouldBeNull()
        SituationCopy.violation("계획한 시간엔 ‘흑돼지거리 식당’ 문을 열지 않는 것으로 나와요", emptyList()).shouldBeNull()
        SituationCopy.violation("시각적으로 흐린 하늘이 예상돼요", emptyList()).shouldBeNull()
        SituationCopy.violation("이동이 30분 늘어날 수 있어요", emptyList()) shouldBe "duration"
        SituationCopy.violation("두 시간 정도 걸려요", emptyList()) shouldBe "duration"
        SituationCopy.violation("오후 3시 30분에 닫아요", emptyList()) shouldBe "duration"
        SituationCopy.violation("도착 시각이 바뀌어요", emptyList()) shouldBe "duration"
        SituationCopy.violation("33.45123, 126.5612 근처예요", emptyList()) shouldBe "coordinate"
        SituationCopy.violation("내일 비 소식이 있어요", emptyList()) shouldBe "relative-day"
        SituationCopy.violation("   ", emptyList()) shouldBe "blank"
        SituationCopy.violation("가".repeat(SituationCopy.MAX_LENGTH + 1), emptyList()) shouldBe "too-long"
        SituationCopy.violation("가".repeat(SituationCopy.MAX_LENGTH), emptyList()).shouldBeNull()
    }

    "미래일 머리는 M월 d일(E) 다 — 상대 날짜어 대신 쓴다" {
        SituationCopy.dayPrefix(LocalDate.parse("2026-10-20")) shouldBe "10월 20일(화)"
        SituationCopy.dayPrefix(LocalDate.parse("2027-01-01")) shouldBe "1월 1일(금)"
    }

    "장소명 때문에는 버리지 않는다 — 이름 자리를 비우고 본다 (T-D1-P8)" {
        checkAll(names, Arb.element(templates)) { raw, template ->
            val name = raw.take(30) // 감지기는 이름을 30자에서 자른다(§4.3)
            SituationCopy.violation(template(name), listOf(name)).shouldBeNull()
        }
    }

    "틀에 든 소요시간·한글 수사·좌표 꼴·상대 날짜어는 버린다 (T-D1-P8)" {
        val bad = Arb.element(
            "이동이 30분 늘어날 수 있어요", "도착이 1시간 늦어요", "두 시간 정도 걸려요", "삼십분 뒤 문을 닫아요",
            "33.45123, 126.5612 근처예요", "내일 비 소식이 있어요", "오늘 휴무예요", "모레 강풍 예보가 있어요", "이동 시간이 늘어요",
        )
        checkAll(names, bad) { raw, sentence ->
            val name = raw.take(30)
            // 이름이 틀의 금지 꼴을 품으면 이름 자리를 비울 때 그 꼴도 지워진다 — 이 성질의 대상이 아니다.
            if (name.isNotBlank() && name in sentence) return@checkAll
            SituationCopy.violation("‘$name’ · $sentence", listOf(name)).shouldNotBeNull()
        }
    }

    "200자를 넘으면 무엇이든 버린다 (T-D1-P8)" {
        checkAll(Arb.string(SituationCopy.MAX_LENGTH + 1..400)) { long ->
            SituationCopy.violation(long, emptyList()).shouldNotBeNull()
        }
    }
})
