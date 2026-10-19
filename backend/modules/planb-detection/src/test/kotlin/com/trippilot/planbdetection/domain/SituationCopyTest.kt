package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
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

    /**
     * 감지기는 이름을 30자에서 잘라 문구에 넣지만 판정(reconcile)이 아는 것은 일정의 **전체 이름**이다. 잘린 꼴을 못 비우면
     * '4시30분왕족발 …'처럼 긴 상호가 든 신호가 판정에서 통째로 버려진다(BR-SA-12 ③·⑦).
     */
    "긴 이름은 잘린 꼴로 문구에 들어가도 비운다 — 판정은 전체 이름만 안다" {
        val long = "4시30분왕족발 제주시청점 2층 단체석 전용 예약 매장 별관"
        val short = SituationCopy.shortName(long)
        short.length shouldBe SituationCopy.NAME_MAX
        SituationCopy.violation("계획한 시간엔 ‘$short’ 영업하지 않는 것으로 나와요", listOf(long)).shouldBeNull()
        // 금지 꼴을 품은 조각으로 긴 이름을 만든다 — 자른 경계가 어디든 이름 때문에는 버리지 않는다.
        val risky = Arb.list(Arb.element("4시30분", "365분식", "왕족발", "오늘의", "33.45678", " ", "두 시간", "카페", "내일도"), 4..14)
            .map { it.joinToString("") }
        checkAll(risky, Arb.element(templates)) { raw, template ->
            SituationCopy.violation(template(SituationCopy.shortName(raw)), listOf(raw)).shouldBeNull()
        }
    }

    "이름은 30자(코드 포인트)에서 자른다 — 짧으면 그대로, 보조 평면 문자를 반으로 가르지 않는다" {
        SituationCopy.shortName("성산일출봉") shouldBe "성산일출봉"
        val emoji = "😀".repeat(SituationCopy.NAME_MAX + 5)
        val cut = SituationCopy.shortName(emoji)
        cut.codePointCount(0, cut.length) shouldBe SituationCopy.NAME_MAX
        cut shouldBe "😀".repeat(SituationCopy.NAME_MAX)
    }

    "200자를 넘으면 무엇이든 버린다 (T-D1-P8)" {
        checkAll(Arb.string(SituationCopy.MAX_LENGTH + 1..400)) { long ->
            SituationCopy.violation(long, emptyList()).shouldNotBeNull()
        }
    }
})
