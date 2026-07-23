package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.application.NicknameService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 닉네임 생성·검사·설정(Bearer). 3검증 = 길이→금칙어→유일. 금칙어 매칭 원문은 응답에 노출하지 않는다(INV-B3).
 */
@RestController
@RequestMapping("/api/v1")
class NicknameController(
    private val nicknames: NicknameService,
) {
    /** 사전 검증 통과한 자동 생성 후보. */
    @PostMapping("/nickname/suggestions")
    fun suggestions(): SuggestionsResponse = SuggestionsResponse(nicknames.suggestions())

    /** 닉네임 유효성(길이·금칙어·유일) 검사 — available + reason(범주). */
    @PostMapping("/nickname/check")
    fun check(@Valid @RequestBody request: NicknameCheckRequest): NicknameCheckResponse {
        val result = nicknames.check(request.nickname!!)
        return NicknameCheckResponse(result.available, result.reason.name)
    }

    /** 닉네임 설정(3검증 통과 시). 프로필 미존재면 생성. 중복은 409, 길이·금칙어는 400. */
    @PatchMapping("/me/profile/nickname")
    fun setNickname(principal: Principal, @Valid @RequestBody request: SetNicknameRequest): ProfileResponse =
        ProfileResponse.from(nicknames.setNickname(principal.accountId(), request.nickname!!))
}

/** POST /nickname/suggestions 응답. */
data class SuggestionsResponse(val suggestions: List<String>)

/** POST /nickname/check 요청. */
data class NicknameCheckRequest(
    @field:NotBlank(message = "nickname 이 필요합니다") val nickname: String?,
)

/** POST /nickname/check 응답 — reason: OK·TOO_SHORT·TOO_LONG·BANNED_WORD·TAKEN. */
data class NicknameCheckResponse(val available: Boolean, val reason: String)

/** PATCH /me/profile/nickname 요청. */
data class SetNicknameRequest(
    @field:NotBlank(message = "nickname 이 필요합니다") val nickname: String?,
)
