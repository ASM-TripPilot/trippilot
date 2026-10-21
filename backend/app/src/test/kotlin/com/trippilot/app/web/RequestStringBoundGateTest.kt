package com.trippilot.app.web

import io.kotest.assertions.withClue
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import jakarta.validation.Valid
import jakarta.validation.constraints.Size
import org.junit.jupiter.api.Test
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider
import org.springframework.core.type.filter.AnnotationTypeFilter
import org.springframework.validation.annotation.Validated
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType

/**
 * 요청 본문의 문자열 필드는 **상한(@Size)을 갖거나, 왜 필요 없는지 적혀 있어야 한다**(TRIP-1473).
 *
 * 상한이 빠진 필드는 컬럼 폭을 넘는 입력을 저장까지 흘려 22001 → 트랜잭션 롤백 → **500** 이 된다. 실측: 여행 제목·
 * 목적지 이름(편집)·저장 숙소 편집·방문 슬롯 키(저장 숙소 등록은 경합 처리가 22001 을 중복으로 읽어 409 였다).
 * 22001 을 전역으로 400 에 매핑하지 않는 것은 사용자 결정이다
 * (2026-10-21) — 서버가 만든 값이 넘친 것까지 400 으로 가려지기 때문이다. 그래서 입력 쪽 상한을 빠짐없이 둔다.
 *
 * 이 게이트는 세 가지를 본다.
 * - 상한 없는 `String` 필드는 [EXEMPT] 에 사유가 있어야 한다. 새 필드가 생기면 여기서 멈춘다.
 * - `List<String>`·`Map<String, _>` 은 `@Size` 가 **원소 수**를 세므로 원소 길이를 막지 못한다 — 전부 [EXEMPT] 에 사유를 둔다.
 * - `@Size` 가 있어도 거기까지 `@Valid` 가 이어지지 않으면 **검사되지 않는다**(본문 파라미터의 `@Valid`, 중첩 필드의 `@field:Valid`).
 *   목적지 이름이 그랬다 — 상한을 달아도 `destinations` 에 `@Valid` 가 없으면 그대로 22001 이었다.
 *
 * `JsonNode` 로 받는 본문(`PUT /me/preferences`)은 필드가 없어 이 게이트 밖이다 — 그 값은 도메인이 어휘로 판정한다.
 * 상한 숫자가 컬럼 폭과 같은지는 여기서 대조하지 않는다(필드→컬럼 대응이 코드에 없다). 대표 경로는 `InputErrorContractIT` 가
 * 실 DB 로 잰다.
 */
class RequestStringBoundGateTest {

    @Test
    fun `요청 본문의 문자열 필드는 상한이 있거나 면제 사유가 있고, 상한은 실제로 검사된다`() {
        val walk = Walk()
        requestBodies().forEach { (where, type, validated) -> walk.type(type, validated, where) }

        withClue("상한 없는 문자열 필드 — @field:Size(max = 컬럼 폭)을 달거나, 저장되지 않는다면 EXEMPT 에 사유를 적는다") {
            walk.unbounded.toList() shouldBe emptyList()
        }
        withClue("@Size 가 있지만 @Valid 가 이어지지 않아 검사되지 않는 필드") {
            walk.unchecked.toList() shouldBe emptyList()
        }
        withClue("면제 목록이 실제 요청 필드를 가리켜야 한다 — 필드가 사라졌으면 면제도 지운다") {
            (EXEMPT.keys - walk.seen).toList() shouldBe emptyList()
        }
    }

    private data class Body(val where: String, val type: Type, val validated: Boolean)

    private fun requestBodies(): List<Body> {
        val scan = ClassPathScanningCandidateComponentProvider(false)
            .apply { addIncludeFilter(AnnotationTypeFilter(RestController::class.java)) }
        return scan.findCandidateComponents("com.trippilot").flatMap { bean ->
            val controller = Class.forName(bean.beanClassName)
            controller.declaredMethods.flatMap { m ->
                m.parameters.filter { it.isAnnotationPresent(RequestBody::class.java) }.map { p ->
                    val validated = p.isAnnotationPresent(Valid::class.java) || p.isAnnotationPresent(Validated::class.java)
                    Body("${controller.simpleName}.${m.name}", p.parameterizedType, validated)
                }
            }
        }.also { withClue("스캔이 본문을 하나도 못 찾으면 이 게이트는 헛돈다") { it.size shouldBeGreaterThan 30 } }
    }

    private class Walk {
        val unbounded = sortedSetOf<String>()
        val unchecked = sortedSetOf<String>()
        val seen = mutableSetOf<String>()
        private val visited = mutableSetOf<Pair<Class<*>, Boolean>>()

        fun type(t: Type, cascaded: Boolean, where: String) {
            val raw = rawOf(t) ?: return
            if (!raw.name.startsWith("com.trippilot.") || raw.isEnum || !visited.add(raw to cascaded)) return
            raw.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.forEach { field(it, cascaded, where) }
        }

        private fun field(f: Field, cascaded: Boolean, where: String) {
            val key = "${f.declaringClass.name.substringAfterLast('.')}.${f.name}"
            val g = f.genericType
            when {
                f.type == String::class.java -> {
                    seen += key
                    val size = f.getAnnotation(Size::class.java)
                    if (size == null && key !in EXEMPT) unbounded += "$key ($where)"
                    if (size != null && !cascaded) unchecked += "$key ($where)"
                }
                g is ParameterizedType -> g.actualTypeArguments.map(::upper).forEach { arg ->
                    if (arg == String::class.java) {
                        seen += key
                        if (key !in EXEMPT) unbounded += "$key 의 원소·키 ($where)"
                    } else {
                        type(arg, cascaded && f.isAnnotationPresent(Valid::class.java), where)
                    }
                }
                else -> type(f.type, cascaded && f.isAnnotationPresent(Valid::class.java), where)
            }
        }

        private fun upper(t: Type): Type = (t as? WildcardType)?.upperBounds?.first() ?: t
        private fun rawOf(t: Type): Class<*>? = (t as? ParameterizedType)?.rawType as? Class<*> ?: t as? Class<*>
    }

    private companion object {
        private const val NOT_STORED = "저장하지 않는다"
        private const val INTERNAL_INGEST =
            "서비스 토큰으로만 부르는 수집 경계 — 앱 입력이 아니다. 넘친 제안을 문서째 400 으로 막을지 항목만 떨굴지는 수집 게이트의 판단이라 이 게이트 밖"

        /** 상한이 없어도 되는 필드와 그 사유. 키는 `선언 클래스.필드`(중첩 클래스는 `바깥$안`). */
        val EXEMPT = mapOf(
            // 어휘·형식 판정이 저장 전에 400 으로 막는다
            "FeedbackRequest.rating" to "enum 판정(어휘 밖 400)",
            "FeedbackRequest.reason" to "enum 판정(어휘 밖 400)",
            "FeedbackRequest.comment" to "서비스가 300자(코드 포인트)·NUL 을 400 으로 막는다",
            "TurnInputRequest.text" to "서비스가 발화 길이·NUL 을 400 으로 막는다",
            "TurnInputRequest.quickReplyId" to "발급된 빠른 답과 대조한다 — 저장되는 것은 발급본이다",
            "UpdateSensitivityRequest.sensitivity" to "enum 판정(어휘 밖 400)",
            "ConsentChangeRequest.termsVersion" to "현재 약관 버전과 같아야 한다(다르면 400)",
            "ConsentSubmissionRequest\$Item.termsVersion" to "현재 약관 버전과 같아야 한다(다르면 400)",
            "NicknameCheckRequest.nickname" to "NicknameRules 가 길이를 판정한다(TOO_LONG)",
            "SetNicknameRequest.nickname" to "NicknameRules 가 길이를 판정한다(TOO_LONG → 400)",
            "EditReflectionRequest.mood" to "도메인이 코드 모양·길이를 판정한다(400)",
            "EditReflectionRequest.shortMemo" to "도메인이 60자(코드 포인트)를 판정한다(400)",
            "EditReflectionRequest.card" to "jsonb 로 저장한다 — 22001 대상이 아니다. 해석은 ReflectionCardCodec",
            "DestinationDto.regionCode" to "선택 가능한 지역 코드인지 카탈로그와 대조한다(아니면 400)",
            // 길이 제한 없는 열에 들어간다
            "RouteDayUploadRequest.segments" to "actual_route_day.segments 는 text[]",
            "StartReplanRequest.reasons" to "replan_session.reasons 는 text[] — @Size 는 원소 수(10)",
            "StartReplanRequest.directives" to "replan_session.directives 는 text[] — @Size 는 원소 수(10)",
            "CreateTripRequest.preferenceSnapshot" to "jsonb 로 저장한다 — Map 키는 22001 대상이 아니다",
            // 저장하지 않는다(조회·외부 전달만)
            "SocialLoginRequest.authorizationCode" to "$NOT_STORED — 제공자에 넘긴다",
            "SocialLoginRequest.codeVerifier" to "$NOT_STORED — 제공자에 넘긴다",
            "SocialLoginRequest.redirectUri" to "$NOT_STORED — 제공자에 넘긴다",
            "SocialTokenLoginRequest.accessToken" to "$NOT_STORED — 제공자에 넘긴다",
            "SocialTokenLoginRequest.authorizationCode" to "$NOT_STORED — 제공자에 넘긴다",
            "RefreshTokenRequest.refreshToken" to "$NOT_STORED — 해시로 조회만 한다",
            "LogoutRequest.refreshToken" to "$NOT_STORED — 해시로 조회만 한다",
            "CandidateRequest.stayId" to "$NOT_STORED — 평가 응답에만 되돌린다",
            "CloseMissingRequest.source" to "$NOT_STORED — 출처 어휘 판정(모르면 400)",
            "CloseMissingRequest.presentSourceRefs" to "$NOT_STORED — 대조 조건으로만 쓴다",
            "PoiProposalDocument.source" to "$NOT_STORED — 출처 어휘 판정(모르면 400)",
            // 서버 간 수집 경계
            "ProposalItem.region" to INTERNAL_INGEST,
            "ProposalItem.openingHoursRaw" to INTERNAL_INGEST,
            "ProposalItem.tags" to INTERNAL_INGEST,
            "ProposalPoi.name" to INTERNAL_INGEST,
            "ProposalPoi.category" to INTERNAL_INGEST,
            "ProposalProvenance.address" to INTERNAL_INGEST,
            "ProposalProvenance.contentId" to INTERNAL_INGEST,
            "ProposalProvenance.imageUrl" to INTERNAL_INGEST,
        )
    }
}
