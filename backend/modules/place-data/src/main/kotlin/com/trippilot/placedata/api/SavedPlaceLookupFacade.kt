package com.trippilot.placedata.api

import java.util.UUID

/**
 * 담은 장소(C7) 조회 파사드 — 타 모듈이 "이 계정이 담아 둔 POI"를 읽는 유일한 경계(R1).
 *
 * 첫 소비자는 재계획 요청의 `saved_places`(`ai-backend-replan-연동-설계.md` §2) — LLM 이
 * "저장한 장소 — 성산일출봉" 컨텍스트를 만들 수 있게 이름을 함께 준다. 저장 시각·메모는
 * 랭킹에도 프롬프트에도 쓰지 않으므로 내보내지 않는다(목적 최소화, SECURITY-11).
 */
interface SavedPlaceLookupFacade {
    fun findSaved(accountId: UUID): List<SavedPlaceItem>
}

data class SavedPlaceItem(val poiId: UUID, val nameKo: String)
