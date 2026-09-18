package com.trippilot.placedata.api

/**
 * 국내 여부 판정 퍼사드(C7) — 여행 생성이 목적지를 검증할 때 쓴다(INV-U1-12 · BR-U1-35).
 *
 * 카카오 로컬은 **place-data 소유**다("하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트").
 * 여행 모듈이 벤더를 직접 잡으면 소유가 둘로 갈린다.
 */
interface DomesticRegionFacade {
    /** 지역명이 대한민국 안인가. 외부를 확인하지 못했으면 [DomesticCheck.UNKNOWN]. */
    fun check(region: String): DomesticCheck
}

/**
 * 판정 결과.
 *
 * [UNKNOWN] 을 [OUTSIDE] 로 접으면 벤더 장애가 곧 여행 생성 불가가 되고,
 * [INSIDE] 로 접으면 사용자는 검증된 줄 안다. 확인 못 했다는 사실을 값으로 남긴다(INV-4).
 */
enum class DomesticCheck { INSIDE, OUTSIDE, UNKNOWN }
