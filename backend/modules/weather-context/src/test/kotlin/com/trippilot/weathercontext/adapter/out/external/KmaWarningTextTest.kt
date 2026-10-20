package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe

/**
 * 특보현황 `t6`(발효 중 특보) 문장 읽기 — BR-SA-16 "응답 형식은 실응답 표본으로 고정한다".
 *
 * 표본 둘: 실응답 `"o 없 음"`(2026-10-19 12:00 발표 — 공백 변주가 실재한다)과 weather.go.kr 특보 발효현황 문장
 * (2026-10-18 22:40 — `o 강풍주의보 : 경상북도(영덕, 포항, 울진평지, 울진산지, 경주동부), 울산, 울릉도.독도` ·
 * `o 호우주의보 : 경상남도(사천)`). 못 읽는 문장은 null 이다 — '특보 없음'으로 접지 않는다(INV-SA-2).
 */
class KmaWarningTextTest : StringSpec({

    "특보 없음 — 실응답의 공백 변주 'o 없 음' 과 'o 없음' 은 빈 목록이다" {
        KmaWarningText.parse("o 없 음").shouldBeEmpty()
        KmaWarningText.parse("o 없음").shouldBeEmpty()
        KmaWarningText.parse("o 없음\r\n\r\n").shouldBeEmpty()
        KmaWarningText.parse(" o  없  음 ").shouldBeEmpty()
    }

    "빈 문장은 못 읽은 것이다 — 특보 없음이 아니다" {
        KmaWarningText.parse("") shouldBe null
        KmaWarningText.parse(" \r\n ") shouldBe null
    }

    "한 줄 — 광역(하위 구역) · 하위 구역 없는 광역 · 광역 밖 구역(섬)을 원문 그대로 읽는다" {
        KmaWarningText.parse("o 강풍주의보 : 경상북도(영덕, 포항, 울진평지, 울진산지, 경주동부), 울산, 울릉도.독도") shouldBe listOf(
            ActiveWarning(
                "강풍", "주의보",
                listOf(
                    WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "울진산지", "경주동부")),
                    WarningArea("울산"),
                    WarningArea("울릉도.독도"),
                ),
            ),
        )
    }

    "여러 줄(CRLF) — 줄마다 특보 하나, 경보 등급도 읽는다" {
        val t6 = "o 강풍주의보 : 울산\r\n o 호우경보 : 경상남도(사천)\r\n"

        KmaWarningText.parse(t6) shouldBe listOf(
            ActiveWarning("강풍", "주의보", listOf(WarningArea("울산"))),
            ActiveWarning("호우", "경보", listOf(WarningArea("경상남도", listOf("사천")))),
        )
    }

    "'(…제외)' 는 나열한 구역을 뺀 광역 전체다" {
        KmaWarningText.parse("o 건조주의보 : 서울, 인천(강화군, 옹진군 제외), 경기도(가평, 연천)") shouldBe listOf(
            ActiveWarning(
                "건조", "주의보",
                listOf(
                    WarningArea("서울"),
                    WarningArea("인천", listOf("강화군", "옹진군"), excluding = true),
                    WarningArea("경기도", listOf("가평", "연천")),
                ),
            ),
        )
    }

    /**
     * 하위 구역 이름 안의 괄호(`신안(흑산면제외)` — 흑산도.홍도가 따로 나오는 신안)는 이름의 일부다. 못 읽으면 '한 줄이라도 못 읽으면 전부
     * null' 이라 그 특보가 발효 중인 동안 모든 여행의 특보 출처가 모름이 된다. 이름은 고치지 않는다(어간 매칭은 감지기 몫).
     */
    "하위 구역 이름 안의 괄호(신안(흑산면제외))는 이름째 읽는다 — 다른 줄도 함께 읽힌다" {
        KmaWarningText.parse("o 강풍주의보 : 전라남도(신안(흑산면제외), 진도), 흑산도.홍도\r\n o 호우주의보 : 울산") shouldBe listOf(
            ActiveWarning("강풍", "주의보", listOf(WarningArea("전라남도", listOf("신안(흑산면제외)", "진도")), WarningArea("흑산도.홍도"))),
            ActiveWarning("호우", "주의보", listOf(WarningArea("울산"))),
        )
        KmaWarningText.parse("o 강풍주의보 : 전라남도(진도, 신안(흑산면 제외))") shouldBe listOf(
            ActiveWarning("강풍", "주의보", listOf(WarningArea("전라남도", listOf("진도", "신안(흑산면 제외)")))),
        )
    }

    "바다 구역·바다 특보도 읽기는 그대로 한다 — 거르는 것은 감지기 몫이다" {
        KmaWarningText.parse("o 풍랑주의보 : 동해중부안쪽먼바다, 제주도남쪽먼바다") shouldBe listOf(
            ActiveWarning("풍랑", "주의보", listOf(WarningArea("동해중부안쪽먼바다"), WarningArea("제주도남쪽먼바다"))),
        )
    }

    "줄이 접혀 이어지면(글머리 없는 줄) 앞 특보에 붙인다" {
        KmaWarningText.parse("o 건조주의보 : 서울, 경기도(가평,\r\n 연천), 강원도(강릉시평지)") shouldBe listOf(
            ActiveWarning(
                "건조", "주의보",
                listOf(WarningArea("서울"), WarningArea("경기도", listOf("가평", "연천")), WarningArea("강원도", listOf("강릉시평지"))),
            ),
        )
    }

    "제목 안 공백은 무시한다 — '강풍 주의보'" {
        KmaWarningText.parse("o 강풍 주의보 : 울산") shouldBe listOf(ActiveWarning("강풍", "주의보", listOf(WarningArea("울산"))))
    }

    "형식이 깨지면 null — 콜론 없음 · 등급 없음 · 괄호 짝 · 빈 구역 · 글머리 없이 시작 · 종류 없음" {
        listOf(
            "o 강풍주의보 울산",
            "o 강풍특보 : 울산",
            "o 강풍주의보 : 경상북도(영덕, 포항",
            "o 강풍주의보 : 경상북도영덕), 울산",
            "o 강풍주의보 : ",
            "o 강풍주의보 : 울산, , 부산",
            "o 강풍주의보 : 경상북도()",
            "o 강풍주의보 : 전라남도(신안(흑산면제외), 진도",
            "o 강풍주의보 : 전라남도((흑산면제외), 진도)",
            "o 강풍주의보 : 경상북도(영덕)(포항)",
            "강풍주의보 : 울산",
            "o 주의보 : 울산",
            "o 강풍주의보 : 울산\r\no 없 음",
        ).forEach { KmaWarningText.parse(it) shouldBe null }
    }
})
