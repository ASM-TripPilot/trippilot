package com.trippilot.weathercontext.api

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 목적지 행정구역 코드 → 에어코리아 예보 권역(domain-entities §8.2 `AirRegion`). 기대값은 리터럴이다(구현의 표를 다시 부르지 않는다).
 * 시도 앞 2자리로 정하고, 경기 북부·남부 · 강원 영동·영서 · 통합특별시(12)의 광주·전남만 시군구로 가른다.
 */
class AirRegionTest : StringSpec({

    "시도 단위 목적지 — 특별·광역시와 도는 앞 2자리 한 권역이다" {
        mapOf(
            "11" to AirRegion.SEOUL, "26" to AirRegion.BUSAN, "27" to AirRegion.DAEGU, "28" to AirRegion.INCHEON,
            "30" to AirRegion.DAEJEON, "31" to AirRegion.ULSAN, "36" to AirRegion.SEJONG, "50" to AirRegion.JEJU,
            "43" to AirRegion.CHUNGBUK, "44" to AirRegion.CHUNGNAM, "47" to AirRegion.GYEONGBUK, "48" to AirRegion.GYEONGNAM,
            "52" to AirRegion.JEONBUK,
        ).forEach { (code, region) -> AirRegion.of(code) shouldBe region }
    }

    "시군구 목적지는 그 시도 권역이다 — 부산 해운대구 · 제주 서귀포시 · 경북 포항시 · 대구 군위군" {
        AirRegion.of("26350") shouldBe AirRegion.BUSAN
        AirRegion.of("50130") shouldBe AirRegion.JEJU
        AirRegion.of("47110") shouldBe AirRegion.GYEONGBUK
        AirRegion.of("27720") shouldBe AirRegion.DAEGU
    }

    "경기는 북부 10 시군과 그 밖(남부)으로 가른다 — 일반시의 행정구는 그 시를 따른다" {
        AirRegion.of("41280") shouldBe AirRegion.GYEONGGI_NORTH // 고양시
        AirRegion.of("41285") shouldBe AirRegion.GYEONGGI_NORTH // 고양시 일산동구
        AirRegion.of("41150") shouldBe AirRegion.GYEONGGI_NORTH // 의정부시
        AirRegion.of("41820") shouldBe AirRegion.GYEONGGI_NORTH // 가평군
        AirRegion.of("41630") shouldBe AirRegion.GYEONGGI_NORTH // 양주시
        AirRegion.of("41360") shouldBe AirRegion.GYEONGGI_NORTH // 남양주시
        AirRegion.of("41110") shouldBe AirRegion.GYEONGGI_SOUTH // 수원시
        AirRegion.of("41117") shouldBe AirRegion.GYEONGGI_SOUTH // 수원시 영통구
        AirRegion.of("41570") shouldBe AirRegion.GYEONGGI_SOUTH // 김포시
        AirRegion.of("41830") shouldBe AirRegion.GYEONGGI_SOUTH // 양평군
    }

    "강원은 영동 7 시군과 그 밖(영서)으로 가른다" {
        AirRegion.of("51150") shouldBe AirRegion.YEONGDONG // 강릉시
        AirRegion.of("51210") shouldBe AirRegion.YEONGDONG // 속초시
        AirRegion.of("51820") shouldBe AirRegion.YEONGDONG // 고성군(강원)
        AirRegion.of("51110") shouldBe AirRegion.YEONGSEO // 춘천시
        AirRegion.of("51760") shouldBe AirRegion.YEONGSEO // 평창군
    }

    "통합특별시(12)는 광주 5 자치구와 그 밖(전남)으로 가른다 — 예보는 따로 나온다" {
        AirRegion.of("12210") shouldBe AirRegion.GWANGJU // 동구
        AirRegion.of("12330") shouldBe AirRegion.GWANGJU // 광산구
        AirRegion.of("12110") shouldBe AirRegion.JEONNAM // 목포시
        AirRegion.of("12870") shouldBe AirRegion.JEONNAM // 신안군
    }

    "한 권역을 고를 수 없는 시도 단위(경기·강원·통합특별시)와 모르는 코드는 null — 지어내지 않는다" {
        AirRegion.of("41") shouldBe null
        AirRegion.of("51") shouldBe null
        AirRegion.of("12") shouldBe null
        AirRegion.of("99") shouldBe null
        AirRegion.of("") shouldBe null
        AirRegion.of("1111") shouldBe null
        AirRegion.of("서울") shouldBe null
    }

    "응답의 권역 이름 그대로 찾는다 — 19 권역 · 모르는 이름은 null" {
        AirRegion.entries.size shouldBe 19
        AirRegion.ofLabel("경기남부") shouldBe AirRegion.GYEONGGI_SOUTH
        AirRegion.ofLabel("영동") shouldBe AirRegion.YEONGDONG
        AirRegion.ofLabel("전남광주") shouldBe null
        AirRegion.ofLabel(" 서울") shouldBe null
    }
})
