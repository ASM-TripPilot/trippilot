package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.application.RegionCatalogService
import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionLevel
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/**
 * 행정구역 카탈로그 조회 — 새 여행의 목적지 선택(US-TRIP-01).
 *
 * 카탈로그는 place-data 소유다. 목적지가 국내인지 판정하는 쪽(C7)이 목록도 가져야
 * "고를 수 있는 것"과 "받아주는 것"이 구조적으로 갈라지지 않는다 — 하드코딩 두 벌이
 * 프론트 6곳·백엔드 28곳으로 어긋나 있던 것이 이 티켓의 출발점이다.
 *
 * 해외 지역은 어떤 질의로도 나오지 않는다 — 카탈로그가 국내만 담기 때문이다(INV-U1-12).
 */
@RestController
@RequestMapping("/api/v1/regions")
class RegionController(
    private val catalog: RegionCatalogService,
) {
    @GetMapping
    fun list(
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) level: RegionLevel?,
    ): List<RegionResponse> = catalog.search(q, level).map { RegionResponse.from(it) }
}

/**
 * 카탈로그 한 행.
 *
 * **`selectable` 을 서버가 잘라 내보내지 않고 값으로 실어 보낸다.** 도(道)와 일반시의 행정구는
 * 목적지가 아니지만(TRIP-357), 화면은 시도로 묶어 보여주므로 목록에서 지우면 `수원시` 가 어디에도
 * 안 붙는다. 규칙의 주인은 서버이고 이 필드가 그 규칙 자체다 — 클라이언트는 그리기만 한다.
 *
 * `sidoCode` 는 내보내지 않는다 — 묶음 키는 [sidoName] 이면 충분하고, 안 쓰는 칸을 계약에 실으면
 * 나중에 못 바꾼다.
 */
data class RegionResponse(
    val regionCode: String,
    val name: String,
    val sidoName: String,
    val level: RegionLevel,
    val selectable: Boolean,
    val poiCount: Int,
) {
    companion object {
        fun from(r: Region) = RegionResponse(
            regionCode = r.regionCode,
            name = r.name,
            sidoName = r.sidoName,
            level = r.level,
            selectable = r.selectable,
            poiCount = r.poiCount,
        )
    }
}
