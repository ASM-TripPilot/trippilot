package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Area
import com.trippilot.placedata.domain.MapPlacePort
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCollectionGate
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service
import java.time.Clock

/**
 * POI 수집(C7) — 지도 API 검색 → 어댑터 정규화 → **수집 게이트(INV-1)** → ACTIVE만 저장.
 * 게이트 미통과(좌표·이름·카테고리 미확보)는 배제돼 후보풀에 들어가지 않는다.
 *
 * ## 지금 이 경로로는 POI 가 들어오지 않는다 (2026-08-20 실측)
 *
 * **프로덕션 호출처가 없다** — 이 서비스를 부르는 컨트롤러·배치·스케줄러가 하나도 없고,
 * 유일한 [MapPlacePort] 구현은 부산 4건짜리 스텁이다. 지금 실제 유입은 전부
 * [PoiProposalIngestService] (`POST /internal/pois/proposals`) 로 들어온다 — AI 수집기가
 * 떨군 문서를 우리 게이트에 다시 태우는 경로다.
 *
 * **그래도 지우지 않는다.** 게이트 적용 순서와 "지도 API → 정규화 → 승격" 흐름이 여기 남아 있어,
 * 실 벤더 어댑터(카카오 로컬 등)를 붙일 때 그대로 쓰인다. 다만 **이것이 살아 있는 경로라고 오해하면**
 * "왜 수집이 안 도나"를 여기서 찾게 되므로 사실을 적어 둔다.
 *
 * 참고: 테스트(`PlaceApiIT`·`CandidatePoolIT`)가 이 서비스를 직접 불러 스텁 POI 를 만든다.
 * 그 행들은 공유 컨테이너에 남으므로 각 IT 가 스스로 치운다(PR #250).
 */
@Service
class PoiCollectionService(
    private val repo: PoiRepository,
    private val mapPlace: MapPlacePort,
    private val clock: Clock,
) {
    /** 지역 수집. 게이트 통과해 저장된 POI 수 반환. */
    fun collect(area: Area, category: PoiCategory? = null): Int {
        val now = clock.instant()
        val promoted = mapPlace.search(area, category).mapNotNull { PoiCollectionGate.promote(it, now) }
        repo.saveAll(promoted)
        return promoted.size
    }
}
