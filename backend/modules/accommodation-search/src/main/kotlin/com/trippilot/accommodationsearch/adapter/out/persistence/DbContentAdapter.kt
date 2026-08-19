package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.placedata.api.RegionLookupFacade
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

/**
 * 숙소 콘텐츠를 **우리 DB 정본에서** 읽는다(스텁 교체).
 *
 * **왜 벤더를 런타임에서 뗐나.** 이 포트는 사용자가 검색할 때마다 불린다. 실 공급자를 그대로 꽂으면
 * 검색 1회 = 외부 호출 1회가 되어 쿼터가 곧 검색 가능 횟수가 되고, 벤더가 느리면 검색이 같이 느려진다.
 * POI 와 같은 구조로 옮겼다 — 배치가 정본을 채우고(`R__seed_stay.sql`) 런타임은 DB 만 본다.
 *
 * **지역 매칭은 문자열이 아니라 코드로 한다.** 사용자는 `제주`·`제주시`·`제주특별자치도` 를 섞어 보내고,
 * 그 표기 흔들림을 흡수하는 것이 카탈로그의 일이다(TRIP-360). 코드 접두사라 시도를 고르면
 * 그 안 시군구가 전부 잡힌다.
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.stay.content.mode"], havingValue = "db")
@Transactional(readOnly = true)
class DbContentAdapter(
    private val jpa: StayJpaRepository,
    private val regions: RegionLookupFacade,
) : AccommodationContentPort {

    override fun search(region: String?): ContentResult {
        val key = region?.trim()
        if (key.isNullOrEmpty()) return ContentResult(jpa.findAllByOrderByName().map { it.toDomain() }, degraded = false, amenitiesKnown = false)

        // 동명이지역이 있다 — '고성'은 경남·강원 둘, '광주'는 옛 광주 자치구 5곳과 경기 광주시를 가리킨다.
        // 하나를 고르면 거짓이므로 전부를 대상으로 삼는다.
        val codes = regions.codesOf(key)
        if (codes.isEmpty()) return ContentResult(emptyList(), degraded = false, amenitiesKnown = false)

        val stays = codes.flatMap { jpa.findByRegionPrefix(it) }
            .distinctBy { it.externalSource to it.externalId }
            .sortedBy { it.name }
        // **정본이 편의시설을 모른다**(LOCALDATA 인허가 대장에 그 칸이 없다). 빈 배열을 "없음"으로
        // 읽히게 두면 사용자가 필터를 걸었을 때 0건이 거짓말이 된다.
        return ContentResult(stays.map { it.toDomain() }, degraded = false, amenitiesKnown = false)
    }

    private fun StayEntity.toDomain() = Stay(
        externalSource = externalSource,
        externalId = externalId,
        name = name,
        lat = lat,
        lng = lng,
        region = region,
        // 비어 있다 — LOCALDATA 가 편의시설을 주지 않는다. "없음"이 아니라 "모름"이고,
        // 그 사실은 응답이 따로 알린다(StaySearchResponse.amenitiesKnown).
        amenities = amenities.toSet(),
        stayType = stayType,
    )
}
