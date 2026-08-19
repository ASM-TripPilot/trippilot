package com.trippilot.placedata.application

import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DestinationFacade
import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.api.DomesticRegionFacade
import com.trippilot.placedata.domain.RegionCatalogPort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * [DestinationFacade] 구현 — 카탈로그 먼저, 지오코딩은 사유를 가를 때만.
 *
 * **순서가 설계의 핵심이다.** 카탈로그가 먼저이므로 정상 경로에는 외부 호출이 0회다 —
 * 카카오가 죽어도 홍천군으로 여행이 만들어진다. 반대로 순서를 뒤집으면 벤더 장애가 그대로
 * 생성 실패가 되고, 카탈로그를 둔 이유가 사라진다.
 *
 * 캐시를 두지 않는다. 조회 한 번이 인덱스 탄 단건이고, [DomesticRegionFacade] 가 자기 캐시를
 * 이미 갖고 있다 — 여기서 또 담으면 무효화 지점이 둘이 된다.
 */
@Service
@Transactional(readOnly = true)
class DestinationService(
    private val catalog: RegionCatalogPort,
    private val domestic: DomesticRegionFacade,
) : DestinationFacade {

    override fun check(region: String): DestinationCheck {
        val key = region.trim()
        // 빈 값은 카탈로그에 없고 물어볼 것도 없다. 외부를 부르지 않는다.
        if (key.isEmpty()) return DestinationCheck.UNVERIFIED

        if (catalog.findExact(key).isNotEmpty()) return DestinationCheck.SUPPORTED

        // 여기부터는 **어차피 거절**이다. 지오코딩은 "왜 안 되는지"를 사용자에게 말해주기 위해서만 부른다.
        return when (domestic.check(key)) {
            DomesticCheck.INSIDE -> DestinationCheck.DOMESTIC_UNSUPPORTED
            DomesticCheck.OUTSIDE -> DestinationCheck.OUTSIDE
            DomesticCheck.UNKNOWN -> DestinationCheck.UNVERIFIED
        }
    }
}
