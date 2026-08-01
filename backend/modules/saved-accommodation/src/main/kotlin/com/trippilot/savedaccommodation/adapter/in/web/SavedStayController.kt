package com.trippilot.savedaccommodation.adapter.`in`.web

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
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun register(principal: Principal, @Valid @RequestBody request: RegisterSavedStayRequest): SavedStayResponse =
        SavedStayResponse.from(service.register(principal.accountId(), request.toCommand()))

    @GetMapping
    fun list(principal: Principal): List<SavedStayResponse> =
        service.list(principal.accountId()).map { SavedStayResponse.from(it) }

    @GetMapping("/{savedStayId}")
    fun get(principal: Principal, @PathVariable savedStayId: UUID): SavedStayResponse =
        SavedStayResponse.from(service.get(principal.accountId(), savedStayId))

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
