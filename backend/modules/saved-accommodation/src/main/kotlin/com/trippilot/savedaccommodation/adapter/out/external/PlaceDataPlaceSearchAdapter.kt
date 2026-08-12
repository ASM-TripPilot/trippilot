package com.trippilot.savedaccommodation.adapter.out.external

import com.trippilot.placedata.api.PlaceLookupFacade
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import org.springframework.stereotype.Component

/**
 * 등록용 지오코딩을 place-data 로 위임한다(R1: `placedata.api` 만 참조).
 *
 * 이 모듈이 카카오를 직접 잡지 않는 이유는 정본이 정한 소유 때문이다 — C7 이 지도/장소 API 를
 * "단일 스키마 뒤로 추상화(벤더 비종속)"하는 소유자다(components.md C7). 벤더를 두 모듈이 들면
 * 쿼터·약관·키 교체가 두 곳으로 갈리고, 실제로 국내강제(INV-U1-12)가 이미 같은 벤더를 place-data 에서 쓴다.
 *
 * 스텁/실물 전환도 여기서 하지 않는다 — `trippilot.place.geocode.mode` 하나가 place-data 안에서 가른다.
 *
 * 이 모듈의 `PlaceSearchPort` 를 없애고 퍼사드를 서비스에 바로 주입하지 않는 이유: 그러면 응용 계층이
 * 남의 계약 타입(`PlaceCandidate`)에 직접 묶인다. 포트를 남겨 두면 이 모듈의 도메인 어휘가 경계에서 끝난다.
 */
@Component
class PlaceDataPlaceSearchAdapter(
    private val lookup: PlaceLookupFacade,
) : PlaceSearchPort {

    override fun geocode(query: String): List<GeocodeCandidate> =
        lookup.search(query).map { GeocodeCandidate(it.name, it.address, it.lat, it.lng) }
}
