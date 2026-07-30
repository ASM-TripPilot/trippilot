package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.application.SavedPlaceService
import com.trippilot.placedata.application.SavedPlaceView
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/** 담기(POI 북마크) — 소유 계정 스코프(타 계정 404). 담는 대상은 ACTIVE POI만. */
@RestController
@RequestMapping("/api/v1/saved-places")
class SavedPlaceController(
    private val service: SavedPlaceService,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun save(principal: Principal, @Valid @RequestBody request: SavePlaceRequest): SavedPlaceResponse =
        SavedPlaceResponse.from(service.save(principal.accountId(), request.poiId!!))

    @GetMapping
    fun list(principal: Principal): List<SavedPlaceResponse> =
        service.list(principal.accountId()).map { SavedPlaceResponse.from(it) }

    @DeleteMapping("/{savedPlaceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(principal: Principal, @PathVariable savedPlaceId: UUID) =
        service.remove(principal.accountId(), savedPlaceId)
}

/** 담기 요청 — 담을 POI. */
data class SavePlaceRequest(
    @field:NotNull val poiId: UUID?,
)

/** 담기 응답 — 담은 시각 + POI 정보(바로 표시용). */
data class SavedPlaceResponse(
    val savedPlaceId: UUID,
    val savedAt: Instant,
    val place: PlaceResponse,
) {
    companion object {
        fun from(v: SavedPlaceView) = SavedPlaceResponse(
            savedPlaceId = v.savedPlace.savedPlaceId,
            savedAt = v.savedPlace.savedAt,
            place = PlaceResponse.from(v.poi),
        )
    }
}
