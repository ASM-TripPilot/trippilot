package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.LinkedTripService
import com.trippilot.savedaccommodation.application.SavedStayService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/** 저장/등록 숙소 — 소유 계정 스코프(타 계정 404). */
@RestController
@RequestMapping("/api/v1/saved-stays")
class SavedStayController(
    private val service: SavedStayService,
    private val linkedTrips: LinkedTripService,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun register(principal: Principal, @Valid @RequestBody request: RegisterSavedStayRequest): SavedStayResponse =
        SavedStayResponse.from(service.register(principal.accountId(), request.toCommand()))

    @GetMapping
    fun list(principal: Principal): List<SavedStayResponse> {
        val accountId = principal.accountId()
        val stays = service.list(accountId)
        // 숙소마다 따로 묻지 않는다 — 목록에서 N+1 을 만들면 이 필드를 넣은 이유가 사라진다.
        val linked = linkedTrips.of(accountId, stays)
        return stays.map { SavedStayResponse.from(it, linked[it.savedStayId].orEmpty()) }
    }

    @GetMapping("/{savedStayId}")
    fun get(principal: Principal, @PathVariable savedStayId: UUID): SavedStayResponse {
        val accountId = principal.accountId()
        val stay = service.get(accountId, savedStayId)
        return SavedStayResponse.from(stay, linkedTrips.of(accountId, listOf(stay))[savedStayId].orEmpty())
    }

    @PatchMapping("/{savedStayId}")
    fun edit(
        principal: Principal,
        @PathVariable savedStayId: UUID,
        @Valid @RequestBody request: EditSavedStayRequest,
    ): SavedStayResponse =
        SavedStayResponse.from(service.edit(principal.accountId(), savedStayId, request.toCommand()))

    @DeleteMapping("/{savedStayId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(principal: Principal, @PathVariable savedStayId: UUID) =
        service.delete(principal.accountId(), savedStayId)
}
