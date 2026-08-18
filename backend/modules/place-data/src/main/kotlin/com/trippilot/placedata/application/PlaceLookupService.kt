package com.trippilot.placedata.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.placedata.api.PlaceCandidate
import com.trippilot.placedata.api.PlaceLookupFacade
import com.trippilot.placedata.domain.PlaceLookupPort
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

/**
 * 지도·장소 검색(C7) — 벤더 결과를 계약 타입으로 옮기고, **실패를 빈 목록으로 접지 않는다**.
 *
 * 결과를 캐시하지 않는다. 지역 판정(`DomesticRegionService`)은 "부산은 국내다"라는 안정된 사실이라
 * 캐시가 맞지만, 장소 검색은 벤더 약관이 실시간 표시를 요구하고(components.md C7 "캐싱 금지·실시간·출처)
 * 질의도 자유 문자열이라 적중률이 낮다.
 */
@Service
class PlaceLookupService(
    private val lookup: PlaceLookupPort,
) : PlaceLookupFacade {

    override fun search(query: String): List<PlaceCandidate> {
        val q = query.trim()
        if (q.isBlank()) return emptyList()

        val found = try {
            lookup.search(q)
        } catch (e: Exception) {
            // 원인을 남긴다 — 키가 없어서인지, 벤더가 죽어서인지, 콘솔에서 서비스가 꺼져 있어서인지(403)
            // 사후에 구분할 수 있어야 한다. 삼키면 "그냥 안 되던데"만 남는다.
            log.warn("장소 검색 실패 — 503 으로 표면화합니다(빈 목록으로 접지 않는다). query 길이={}", q.length, e)
            throw UpstreamUnavailable(source = "kakao-local", fallbackApplied = false, cause = e)
        }
        return found.map { PlaceCandidate(it.name, it.address, it.lat, it.lng) }
    }

    /**
     * 좌표 → 주소. [search] 와 **같은 태도**다 — 못 찾은 것(null)과 못 부른 것(예외)을 섞지 않는다.
     *
     * 좌표 범위 검증은 여기서 하지 않는다. 값이 범위를 벗어났는지는 요청 형식의 문제라 웹 계층이
     * 400 으로 막는 편이 사용자에게 정확하고, 여기까지 내려오면 이미 통과한 값이다.
     */
    override fun reverseGeocode(lat: Double, lng: Double): String? {
        val found = try {
            lookup.reverseGeocode(lat, lng)
        } catch (e: Exception) {
            log.warn("역지오코딩 실패 — 503 으로 표면화합니다(주소 없음으로 접지 않는다).", e)
            throw UpstreamUnavailable(source = "kakao-local", fallbackApplied = false, cause = e)
        }
        return found?.address
    }

    private companion object {
        private val log = LoggerFactory.getLogger(PlaceLookupService::class.java)
    }
}
