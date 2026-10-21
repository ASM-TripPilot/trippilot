package com.trippilot.app.web

import io.kotest.assertions.withClue
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import jakarta.validation.Valid
import jakarta.validation.constraints.Size
import org.hibernate.validator.constraints.CodePointLength
import org.junit.jupiter.api.Test
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider
import org.springframework.core.type.filter.AnnotationTypeFilter
import org.springframework.stereotype.Controller
import org.springframework.validation.annotation.Validated
import org.springframework.web.bind.annotation.RequestBody
import java.lang.reflect.Field
import java.lang.reflect.GenericArrayType
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
 * - 상한 없는 `String` 필드는 [EXEMPT] 에 사유가 있어야 한다. 새 필드가 생기면 여기서 멈춘다. 상한은 `@Size(max)` 또는
 *   `@CodePointLength(max)` 다 — `max` 없이 `min` 만 둔 것은 상한이 아니다.
 * - `List<String>`·`Array<String>`·`Map<String, _>` 은 `@Size` 가 **원소 수**를 세므로 원소 길이를 막지 못한다 — 전부 [EXEMPT] 에 사유를 둔다.
 * - 상한이 있어도 거기까지 `@Valid` 가 이어지지 않으면 **검사되지 않는다**(본문 파라미터의 `@Valid`, 중첩 필드의 `@field:Valid`).
 *   목적지 이름이 그랬다 — 상한을 달아도 `destinations` 에 `@Valid` 가 없으면 그대로 22001 이었다.
 *
 * `@RestController` 만이 아니라 `@Controller` 전부를 훑는다. 본문이 `List<Dto>` 면 원소 타입까지, 필드는 상위 클래스까지 내려간다.
 * 면제 키는 FQCN 이다 — 단순 이름이면 다른 모듈의 같은 이름 클래스가 면제를 물려받는다. 이 규칙들이 조용히 통과하지 않는지는
 * `gatefixture` 표본으로 따로 확인한다(아래 자기 검증).
 *
 * `JsonNode` 로 받는 본문(`PUT /me/preferences`)은 필드가 없어 이 게이트 밖이다 — 그 값은 도메인이 어휘로 판정한다.
 * 상한 숫자가 컬럼 폭과 같은지는 여기서 대조하지 않는다(필드→컬럼 대응이 코드에 없다). 대표 경로는 `InputErrorContractIT` 가
 * 실 DB 로 잰다.
 */
class RequestStringBoundGateTest {

    @Test
    fun `요청 본문의 문자열 필드는 상한이 있거나 면제 사유가 있고, 상한은 실제로 검사된다`() {
        val walk = Walk("com.trippilot.", EXEMPT)
        val bodies = requestBodies("com.trippilot")
        withClue("스캔이 본문을 하나도 못 찾으면 이 게이트는 헛돈다") { bodies.size shouldBeGreaterThan 30 }
        bodies.forEach { walk.root(it) }

        withClue("상한 없는 문자열 필드 — @field:CodePointLength(max = 컬럼 폭)을 달거나, 저장되지 않는다면 EXEMPT 에 사유를 적는다") {
            walk.unbounded.map { (k, where) -> "$k ($where)" } shouldBe emptyList()
        }
        withClue("상한이 있지만 @Valid 가 이어지지 않아 검사되지 않는 필드") {
            walk.unchecked.map { (k, where) -> "$k ($where)" } shouldBe emptyList()
        }
        withClue("면제 목록이 실제 요청 필드를 가리켜야 한다 — 필드가 사라졌으면 면제도 지운다") {
            (EXEMPT.keys - walk.seen).toList() shouldBe emptyList()
        }
    }

    /** 게이트가 놓치기 쉬운 형태를 표본으로 하나씩 확인한다 — 표본은 `gatefixture`(앱 스캔 밖). */
    @Test
    fun `자기 검증 — 최상위 목록·배열·상위 클래스·@Controller·min 만 있는 상한·같은 단순 이름을 놓치지 않는다`() {
        val walk = Walk("gatefixture.", mapOf("gatefixture.Twin\$Item.name" to "표본"))
        val bodies = requestBodies("gatefixture")
        withClue("@RestController 가 아닌 @Controller 의 본문도 스캔된다") { bodies.size shouldBe 9 }
        bodies.forEach { walk.root(it) }

        walk.unbounded.keys shouldBe setOf(
            "gatefixture.MinOnly.a", "gatefixture.MinOnly.b", // max 없는 @Size·@CodePointLength 는 상한이 아니다
            "gatefixture.ArrayField.a",                       // Array<String> 은 원소 길이를 막지 못한다
            "gatefixture.Base.bare",                          // 상위 클래스 필드
            "gatefixture.Other\$Item.name",                  // 같은 단순 이름 Twin.Item 의 면제를 물려받지 않는다
        )
        walk.unchecked.keys shouldBe setOf(
            "gatefixture.Bounded.a", "gatefixture.Bounded.b", // @field:Valid 없는 중첩
            "gatefixture.ListElement.a",                      // @Valid 없는 최상위 목록 — 원소까지 따라가야 보인다
        )
        withClue("최상위 목록·상위 클래스의 상한은 검사되는 것으로 센다") {
            walk.seen.containsAll(setOf("gatefixture.ListElement.a", "gatefixture.Base.inherited", "gatefixture.Child.own")) shouldBe true
        }
    }

    private data class Body(val where: String, val type: Type, val validated: Boolean)

    private fun requestBodies(basePackage: String): List<Body> {
        val scan = ClassPathScanningCandidateComponentProvider(false)
            .apply { addIncludeFilter(AnnotationTypeFilter(Controller::class.java)) } // @RestController 도 메타 애너테이션으로 걸린다
        return scan.findCandidateComponents(basePackage).flatMap { bean ->
            val controller = Class.forName(bean.beanClassName)
            controller.declaredMethods.flatMap { m ->
                m.parameters.filter { it.isAnnotationPresent(RequestBody::class.java) }.map { p ->
                    val validated = p.isAnnotationPresent(Valid::class.java) || p.isAnnotationPresent(Validated::class.java)
                    Body("${controller.simpleName}.${m.name}", p.parameterizedType, validated)
                }
            }
        }
    }

    private class Walk(private val prefix: String, private val exempt: Map<String, String>) {
        val unbounded = sortedMapOf<String, String>()
        val unchecked = sortedMapOf<String, String>()
        val seen = mutableSetOf<String>()
        private val visited = mutableSetOf<Pair<Class<*>, Boolean>>()

        fun root(body: Body) = type(body.type, body.validated, body.where, key = "${body.where} 본문")

        /** [key] 는 문자열 원소가 곧바로 나올 때(본문이 `List<String>` 등) 무엇으로 보고할지다. */
        private fun type(t: Type, cascaded: Boolean, where: String, key: String) {
            when {
                t is ParameterizedType && !isOwn(t.rawType) ->
                    t.actualTypeArguments.map(::upper).forEach { element(it, cascaded, where, key) }
                t is GenericArrayType -> element(t.genericComponentType, cascaded, where, key)
                t is Class<*> && t.isArray -> element(t.componentType, cascaded, where, key)
                else -> {
                    val raw = rawOf(t) ?: return
                    if (!isOwn(raw) || raw.isEnum || !visited.add(raw to cascaded)) return
                    generateSequence(raw) { it.superclass }.takeWhile(::isOwn)
                        .flatMap { it.declaredFields.asSequence() }
                        .filterNot { Modifier.isStatic(it.modifiers) || it.isSynthetic }
                        .forEach { field(it, cascaded, where) }
                }
            }
        }

        /** 컨테이너의 원소 — 문자열이면 원소 길이를 막을 수단이 없으니 면제가 있어야 한다. */
        private fun element(t: Type, cascaded: Boolean, where: String, key: String) {
            if (t == String::class.java) {
                seen += key
                if (key !in exempt) unbounded[key] = "$where — 원소·키"
            } else {
                type(t, cascaded, where, key)
            }
        }

        private fun field(f: Field, cascaded: Boolean, where: String) {
            val key = "${f.declaringClass.name}.${f.name}"
            if (f.type == String::class.java) {
                seen += key
                if (!bounded(f) && key !in exempt) unbounded[key] = where
                if (bounded(f) && !cascaded) unchecked[key] = where
            } else {
                type(f.genericType, cascaded && f.isAnnotationPresent(Valid::class.java), where, key)
            }
        }

        private fun bounded(f: Field): Boolean =
            (f.getAnnotation(Size::class.java)?.max ?: Int.MAX_VALUE) != Int.MAX_VALUE ||
                (f.getAnnotation(CodePointLength::class.java)?.max ?: Int.MAX_VALUE) != Int.MAX_VALUE

        private fun isOwn(t: Type): Boolean = (t as? Class<*>)?.name?.startsWith(prefix) == true
        private fun upper(t: Type): Type = (t as? WildcardType)?.upperBounds?.first() ?: t
        private fun rawOf(t: Type): Class<*>? = (t as? ParameterizedType)?.rawType as? Class<*> ?: t as? Class<*>
    }

    private companion object {
        private const val NOT_STORED = "저장하지 않는다"
        private const val INGEST_TOO_LONG = "수집 서비스가 poi 컬럼 폭을 넘는 항목만 too_long 으로 떨군다(PoiProposalIngestService)"

        private const val ASSISTANT = "com.trippilot.assistant.adapter.in.web"
        private const val AUTH = "com.trippilot.auth.adapter.in.web"
        private const val PROFILE = "com.trippilot.profile.adapter.in.web"
        private const val REFLECTION = "com.trippilot.reflection.adapter.in.web"
        private const val TRIP = "com.trippilot.trip.adapter.in.web"
        private const val ARCHIVE = "com.trippilot.archive.adapter.in.web"
        private const val REPLAN = "com.trippilot.recalculation.adapter.in.web"
        private const val PLANB = "com.trippilot.planbdetection.adapter.in.web"
        private const val GENERATION = "com.trippilot.itinerarygeneration.adapter.in.web"
        private const val PLACE = "com.trippilot.placedata.adapter.in.web"

        /** 상한이 없어도 되는 필드와 그 사유. 키는 `FQCN.필드`(중첩 클래스는 `바깥$안`). */
        val EXEMPT = mapOf(
            // 어휘·형식 판정이 저장 전에 400 으로 막는다
            "$ASSISTANT.FeedbackRequest.rating" to "enum 판정(어휘 밖 400)",
            "$ASSISTANT.FeedbackRequest.reason" to "enum 판정(어휘 밖 400)",
            "$ASSISTANT.FeedbackRequest.comment" to "서비스가 300자(코드 포인트)·NUL 을 400 으로 막는다",
            "$ASSISTANT.TurnInputRequest.text" to "서비스가 발화 길이·NUL 을 400 으로 막는다",
            "$ASSISTANT.TurnInputRequest.quickReplyId" to "발급된 빠른 답과 대조한다 — 저장되는 것은 발급본이다",
            "$PLANB.UpdateSensitivityRequest.sensitivity" to "enum 판정(어휘 밖 400)",
            "$AUTH.ConsentChangeRequest.termsVersion" to "현재 약관 버전과 같아야 한다(다르면 400)",
            "$AUTH.ConsentSubmissionRequest\$Item.termsVersion" to "현재 약관 버전과 같아야 한다(다르면 400)",
            "$PROFILE.NicknameCheckRequest.nickname" to "NicknameRules 가 길이를 판정한다(TOO_LONG)",
            "$PROFILE.SetNicknameRequest.nickname" to "NicknameRules 가 길이를 판정한다(TOO_LONG → 400)",
            "$REFLECTION.EditReflectionRequest.mood" to "도메인이 코드 모양·길이를 판정한다(400)",
            "$REFLECTION.EditReflectionRequest.shortMemo" to "도메인이 60자(코드 포인트)를 판정한다(400)",
            "$REFLECTION.EditReflectionRequest.card" to "jsonb 로 저장한다 — 22001 대상이 아니다. 해석·NUL 판정은 ReflectionCardCodec",
            "$TRIP.DestinationDto.regionCode" to "선택 가능한 지역 코드인지 카탈로그와 대조한다(아니면 400)",
            "$PLACE.ProposalPoi.category" to "8종 어휘 판정(밖이면 unknown_category 로 탈락)",
            // 길이 제한 없는 열에 들어간다
            "$ARCHIVE.RouteDayUploadRequest.segments" to "길이 제한 없는 열 — actual_route_day.segments 는 text[]",
            "$REPLAN.StartReplanRequest.reasons" to "길이 제한 없는 열 — replan_session.reasons 는 text[](@Size 는 원소 수 10)",
            "$REPLAN.StartReplanRequest.directives" to "길이 제한 없는 열 — replan_session.directives 는 text[](@Size 는 원소 수 10)",
            "$TRIP.CreateTripRequest.preferenceSnapshot" to "길이 제한 없는 열 — jsonb(Map 키는 22001 대상이 아니다)",
            "$PLACE.ProposalItem.tags" to "길이 제한 없는 열 — poi.tags 는 text[]",
            "$PLACE.ProposalProvenance.imageUrl" to "길이 제한 없는 열 — poi.image_url 은 text",
            // 서버 간 수집 경계 — 넘친 항목만 떨군다
            "$PLACE.ProposalItem.region" to INGEST_TOO_LONG,
            "$PLACE.ProposalItem.openingHoursRaw" to INGEST_TOO_LONG,
            "$PLACE.ProposalPoi.name" to INGEST_TOO_LONG,
            "$PLACE.ProposalProvenance.address" to INGEST_TOO_LONG,
            "$PLACE.ProposalProvenance.contentId" to INGEST_TOO_LONG,
            // 저장하지 않는다(조회·외부 전달만)
            "$AUTH.SocialLoginRequest.authorizationCode" to "$NOT_STORED — 제공자에 넘긴다",
            "$AUTH.SocialLoginRequest.codeVerifier" to "$NOT_STORED — 제공자에 넘긴다",
            "$AUTH.SocialLoginRequest.redirectUri" to "$NOT_STORED — 제공자에 넘긴다",
            "$AUTH.SocialTokenLoginRequest.accessToken" to "$NOT_STORED — 제공자에 넘긴다",
            "$AUTH.SocialTokenLoginRequest.authorizationCode" to "$NOT_STORED — 제공자에 넘긴다",
            "$AUTH.RefreshTokenRequest.refreshToken" to "$NOT_STORED — 해시로 조회만 한다",
            "$AUTH.LogoutRequest.refreshToken" to "$NOT_STORED — 해시로 조회만 한다",
            "$GENERATION.CandidateRequest.stayId" to "$NOT_STORED — 평가 응답에만 되돌린다",
            "$PLACE.CloseMissingRequest.source" to "$NOT_STORED — 출처 어휘 판정(모르면 400)",
            "$PLACE.CloseMissingRequest.presentSourceRefs" to "$NOT_STORED — 대조 조건으로만 쓴다",
            "$PLACE.PoiProposalDocument.source" to "$NOT_STORED — 출처 어휘 판정(모르면 400)",
        )
    }
}
