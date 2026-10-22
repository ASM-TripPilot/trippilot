package com.trippilot.reflection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.reflection.application.ShareCardCopyService
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * j06 공유 카드 문구(TRIP-1411). 여행 하위 리소스. 소유 스코프(타 계정 404).
 *
 * **POST 인 이유** — 부를 때마다 새로 짓는다(AI 호출, 저장 없음). 같은 요청에 같은 답을 약속하지 않으므로 GET 으로 두면 캐시가
 * 옛 문구를 돌려줄 수 있다. 앱은 AI 를 직접 부르지 않는다(공유 카드 구조 가드가 막는다) — 그래서 서버를 거친다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/share-card/copy")
class ShareCardController(private val service: ShareCardCopyService) {

    @PostMapping
    fun copy(principal: Principal, @PathVariable tripId: UUID): ShareCardCopyResponse =
        service.copy(principal.accountId(), tripId).let { ShareCardCopyResponse(it.caption, it.hashtags, it.isFallback) }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * @property isFallback AI 문구가 아니라 규칙 조립이다(AI 를 못 불렀거나·상대 폴백이었거나·안 간 곳을 말했다). 그대로 써도 된다.
 */
data class ShareCardCopyResponse(val caption: String, val hashtags: List<String>, val isFallback: Boolean)
