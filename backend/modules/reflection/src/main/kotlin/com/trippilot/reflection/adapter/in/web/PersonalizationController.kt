package com.trippilot.reflection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.reflection.api.PersonalizationFacade
import com.trippilot.reflection.api.PersonalizationView
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 개인화 활용 안내(`l05` · BR-U5-45). 계정 스코프.
 *
 * **무엇을 넘겼는가를 계약으로 낸다** — 화면은 U6 소관이고, U5 는 그 목록의 원천이다.
 * 목록은 **실제로 넘긴 것만** 담는다: "이런 걸 쓸 수 있습니다"를 미리 적어 두면 안내가 거짓말이 된다.
 *
 * `reason` 이 따로 있는 이유는 **동의가 없어 빠진 것과 기록이 모자라 빠진 것이 다르기** 때문이다.
 * 그 구분이 없으면 화면은 이미 동의한 사용자에게도 "동의하면 더 맞춰드려요"를 보인다.
 */
@RestController
@RequestMapping("/api/v1/me/personalization")
class PersonalizationController(private val personalization: PersonalizationFacade) {

    @GetMapping
    fun get(principal: Principal): PersonalizationResponse =
        PersonalizationResponse.from(personalization.deriveFor(principal.accountId()))
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

data class PersonalizationResponse(
    val applied: Boolean,
    val reason: String,
    val sharedItems: List<PersonalizationItemResponse>,
) {
    companion object {
        fun from(v: PersonalizationView) = PersonalizationResponse(
            applied = v.applied,
            reason = v.reason.name,
            sharedItems = v.sharedItems.map { PersonalizationItemResponse(it.item, it.purpose) },
        )
    }
}

/** 넘긴 항목 하나와 그 목적. 파생된 값(활동 어휘·속도)은 내지 않는다 — 안내는 "무엇을"이지 "얼마나"가 아니다. */
data class PersonalizationItemResponse(val item: String, val purpose: String)
