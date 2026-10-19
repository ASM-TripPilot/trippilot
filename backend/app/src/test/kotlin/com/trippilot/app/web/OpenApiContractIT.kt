package com.trippilot.app.web

import com.fasterxml.jackson.databind.JavaType
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertAll
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.MethodParameter
import org.springframework.core.io.ClassPathResource
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml

/**
 * 설계-우선 계약 게이트 — docs/design/openapi.yaml(정본) 과 실제 Spring 핸들러가 일치해야 통과.
 * 경로·메서드(문서에만 있거나 코드에만 있으면 실패), 스키마 참조·중복 키, 그리고 본문의 유무·모양·필드 이름
 * (필드 계약)을 본다. springdoc 없이 Spring 매핑과 MVC 매퍼를 직접 introspect(SB4 안전).
 * 서비스 표면(base 하위)만 대상(헬스·문서·정적 제외).
 */
@SpringBootTest
class OpenApiContractIT : AbstractPostgresIntegrationTest() {

    @Autowired
    @Qualifier("requestMappingHandlerMapping") // 여러 매핑 빈 중 MVC 컨트롤러 매핑(actuator 매핑 아님)
    private lateinit var handlerMapping: RequestMappingHandlerMapping

    /** MVC JSON 컨버터가 쓰는 매퍼(WebConfig) — 필드 대조는 이 매퍼가 보는 속성 이름으로 한다. */
    @Autowired
    private lateinit var mapper: ObjectMapper

    private val basePath = "/api/v1"
    private val httpMethods = setOf("get", "post", "put", "patch", "delete")

    @Test
    fun `openapi 문서와 구현된 엔드포인트가 정확히 일치한다`() {
        val documented = documentedEndpoints()
        val implemented = implementedApiEndpoints()

        val undocumented = (implemented - documented).sorted() // 코드엔 있는데 openapi에 없음
        val unimplemented = (documented - implemented).sorted() // openapi엔 있는데 코드에 없음

        assertAll(
            { assertTrue(undocumented.isEmpty()) { "openapi.yaml 문서 누락(코드에만 존재):\n  " + undocumented.joinToString("\n  ") } },
            { assertTrue(unimplemented.isEmpty()) { "미구현(openapi.yaml 문서에만 존재):\n  " + unimplemented.joinToString("\n  ") } },
        )
    }

    /** openapi.yaml(빌드가 복사한 classpath 정본)의 paths 를 "METHOD 절대경로" 집합으로. */
    private fun documentedEndpoints(): Set<String> {
        @Suppress("UNCHECKED_CAST")
        val paths = spec["paths"] as Map<String, Map<String, Any>>
        return paths.entries.flatMap { (path, ops) ->
            ops.keys.filter { it.lowercase() in httpMethods }
                .map { "${it.uppercase()} $basePath$path" }
        }.toSet()
    }

    /**
     * `$ref: '#/components/schemas/X'` 가 **전부 풀리는가**.
     *
     * 왜 필요한가: 이 파일은 `components.schemas` 다음에 `components.responses` 가 온다. "스키마는 끝에
     * 덧붙인다"를 파일 끝으로 읽으면 정의가 **responses 절에 들어가고**, 참조는 조용히 끊긴다.
     * 위의 경로↔핸들러 대조는 그것을 **원리적으로 못 본다** — 경로는 멀쩡하기 때문이다.
     * 실측(2026-08-26 층1~3 통합): 이렇게 끊긴 참조가 14종 쌓여 있었고 모든 게이트가 초록이었다.
     * 끊긴 참조는 프론트 코드 생성(orval)에서 터진다.
     */
    @Test
    fun `openapi 의 모든 스키마 참조가 풀린다`() {
        val raw = ClassPathResource("static/openapi.yaml").inputStream.bufferedReader().readText()
        @Suppress("UNCHECKED_CAST")
        val components = Yaml().load<Map<String, Any>>(raw)["components"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val defined = (components["schemas"] as? Map<String, Any>).orEmpty().keys
        val referenced = Regex("#/components/schemas/(\\w+)").findAll(raw).map { it.groupValues[1] }.toSet()

        val dangling = (referenced - defined).sorted()

        assertTrue(dangling.isEmpty()) {
            "components.schemas 에 없는 참조:\n  " + dangling.joinToString("\n  ") +
                "\n(정의가 components.responses 절에 들어가지 않았는지 보라)"
        }
    }

    /**
     * 같은 키가 **두 번** 선언돼 있지 않은가.
     *
     * 왜 필요한가: YAML 은 중복 키에서 **뒤에 온 것이 이긴다.** 예외도 경고도 없다. 그래서 위의
     * 두 게이트가 **원리적으로** 못 본다 — 경로는 멀쩡하고 참조도 풀린다. 먼저 선언한 스키마가
     * 조용히 사라질 뿐이다.
     *
     * 실측: 여러 브랜치를 합치며 `Notification`·`NotificationList`·`PushTokenResponse` 등이 중복
     * 선언됐고, 백엔드 게이트는 전부 초록인 채로 프론트 `pnpm codegen` 이 막혔다(FE PR #403 에서
     * 손으로 지웠다). 정본 파일 하나를 여러 작업이 함께 만지는 구조라 재발이 예정돼 있다.
     *
     * 문서 전체를 본다 — `paths`·`components.schemas` 뿐 아니라 어느 매핑에서든 중복이면 실패다.
     */
    @Test
    fun `openapi 에 중복 키가 없다 — 뒤에 온 것이 조용히 이긴다`() {
        val strict = Yaml(LoaderOptions().apply { isAllowDuplicateKeys = false })

        val failure = runCatching {
            strict.load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
        }.exceptionOrNull()

        // 메시지에서 원인을 **단정하지 않는다.** 이 자리는 중복 키 말고 문법 오류로도 실패할 수 있고,
        // "중복이다"라고 못 박으면 다음 사람이 없는 원인을 뒤진다. 실제 사유는 아래 줄에 그대로 싣는다.
        assertTrue(failure == null) {
            "openapi.yaml 을 엄격 모드로 읽지 못했다 — 사유는 아래 그대로다.\n" +
                "  ${failure?.message?.replace("\n", "\n  ")}\n" +
                "(중복 키라면 먼저 선언한 쪽이 조용히 사라진다. 브랜치를 합치며 스키마를 양쪽에서 " +
                "덧붙이면 생기고, 프론트 codegen 이 막힌다)"
        }
    }

    /** Spring 핸들러 매핑을 "METHOD 절대경로" 집합으로. 서비스 표면(base 하위)만. */
    private fun implementedApiEndpoints(): Set<String> = apiHandlers().map { (method, pattern) -> "$method $pattern" }.toSet()

    /**
     * 서비스 표면의 (메서드, 절대경로, 핸들러) — 경로 게이트와 필드 게이트가 **같은 펼침**을 본다.
     * 한 핸들러가 경로·메서드를 여럿 가지면 곱으로 펼친다.
     */
    private fun apiHandlers(): List<Triple<String, String, HandlerMethod>> =
        handlerMapping.handlerMethods.flatMap { (info, handler) ->
            val patterns = info.pathPatternsCondition?.patternValues.orEmpty().filter { it.startsWith("$basePath/") }
            val methods = info.methodsCondition.methods.map { it.name }
            patterns.flatMap { p -> methods.map { m -> Triple(m, p, handler) } }
        }

    // ── 필드 계약 ──────────────────────────────────────────────────────────────────────────────

    /**
     * 알고 남겨 둔 불일치 — **사유가 없으면 넣지 않는다.** 고쳐져서 더 안 나오면 아래 게이트가 실패해
     * 항목을 지우게 한다(목록이 썩지 않게).
     */
    private val knownFieldMismatches = mapOf(
        "GET /api/v1/me/location-consent 응답 LocationConsentResponse.capabilities Capabilities: 문서에만 `localLocationUse`" to
            "모노레포 통합 때부터 문서에만 있고 서버는 한 번도 내지 않았다. 의미(OS 권한만으로 되는 기기 내 사용?)가 " +
            "설계 문서에 없고, 지우면 프론트 테스트 목업이 codegen 뒤 타입 오류가 난다 — 팀 결정 대기(2026-10-19)",
        "PUT /api/v1/me/location-consent 응답 LocationConsentResponse.capabilities Capabilities: 문서에만 `localLocationUse`" to
            "위와 같음",
    )

    /**
     * 필드 계약 — 본문의 **유무·모양·속성 이름**이 openapi 스키마와 같아야 통과.
     *
     * 왜 필요한가: 위의 경로 대조는 응답에 필드를 더하거나 이름을 바꾸고 문서를 안 고쳐도 초록이다.
     * 프론트는 orval 이 **문서로** 만든 타입을 쓰므로 새 필드를 못 보거나 없는 필드를 읽는다(undefined).
     * 실측: 이 게이트를 처음 돌렸을 때 코드에만 있는 필드 4개와, 응답 본문이 통째로 문서에 없는 경로가 나왔다.
     *
     * 무엇과 맞대는가: DTO 의 Kotlin 필드가 아니라 **MVC 컨버터의 매퍼가 보는 속성** — `@JsonProperty`·
     * `@JsonIgnore` 까지 반영된 와이어 이름이다. 응답은 직렬화, 요청 본문은 역직렬화 쪽으로 따로 본다.
     * `$ref`·`allOf`·`oneOf`·`anyOf`·`items`·`additionalProperties` 를 따라 중첩까지 내려간다.
     *
     * 보지 않는 것: 타입·nullable·required, 그리고 이름을 알 수 없는 본문(`JsonNode` 로 손 파싱·`Map` 의 키).
     */
    @Test
    fun `응답·요청 본문의 유무와 필드 이름이 openapi 스키마와 일치한다`() {
        val mismatches = mutableListOf<String>()
        for ((method, pattern, handler) in apiHandlers()) {
            val operation = operation(pattern.removePrefix(basePath), method) ?: continue
            val label = "$method $pattern"
            val responseType = unwrap(mapper.typeFactory.constructType(handler.returnType.genericParameterType))
            val bodyParameter = handler.methodParameters.firstOrNull { it.hasParameterAnnotation(RequestBody::class.java) }

            // 유무는 content 종류와 무관하게 본다(JSON 아닌 본문도 본문이다). 이름 대조는 JSON 만 —
            // 그래서 코드가 JSON DTO 를 내는데 문서 본문이 전부 JSON 이 아니면 그것 자체를 불일치로 낸다.
            val responses = successResponses(operation)
            val hasDocumentedBody = responses.any { it["content"] != null }
            val documented = responses.mapNotNull(::jsonSchema)
            when {
                responseType == null -> Unit // ResponseEntity<*> 등 — 코드가 본문 타입을 말하지 않는다
                isNoBody(responseType) -> if (hasDocumentedBody) mismatches += "$label 응답: 문서는 본문이 있는데 코드는 본문이 없다"
                !hasDocumentedBody ->
                    mismatches += "$label 응답: 코드는 본문(${responseType.rawClass.simpleName})을 내는데 문서 2xx 에 본문이 없다"
                documented.isEmpty() && !isLeaf(responseType) ->
                    mismatches += "$label 응답: 코드는 JSON 객체(${responseType.rawClass.simpleName})를 내는데 문서 본문에 application/json 이 없다"
                else -> documented.forEach { compare(responseType, it, "$label 응답", true, mismatches, mutableSetOf()) }
            }

            val hasDocumentedRequest = operation["requestBody"] != null
            val request = requestSchema(operation)
            when {
                bodyParameter == null && hasDocumentedRequest -> mismatches += "$label 요청: 문서는 본문이 있는데 코드는 @RequestBody 가 없다"
                bodyParameter != null && !hasDocumentedRequest -> mismatches += "$label 요청: 코드는 @RequestBody 를 받는데 문서에 requestBody 가 없다"
                bodyParameter != null && request == null && !isLeaf(requestType(bodyParameter)) ->
                    mismatches += "$label 요청: 코드는 JSON 객체를 받는데 문서 requestBody 에 application/json 이 없다"
                bodyParameter != null && request != null -> compare(
                    requestType(bodyParameter), request, "$label 요청", false,
                    mismatches, mutableSetOf(),
                )
            }
        }

        val unexpected = (mismatches - knownFieldMismatches.keys).sorted()
        val stale = (knownFieldMismatches.keys - mismatches.toSet()).sorted()
        assertAll(
            {
                assertTrue(unexpected.isEmpty()) {
                    "openapi.yaml 과 와이어 본문이 다르다 — 코드가 맞으면 문서를, 문서가 맞으면 DTO 를 고친다:\n  " +
                        unexpected.joinToString("\n  ")
                }
            },
            { assertTrue(stale.isEmpty()) { "더 이상 안 나는 예외 — knownFieldMismatches 에서 지운다:\n  " + stale.joinToString("\n  ") } },
        )
    }

    private fun compare(
        type: JavaType,
        schema: Map<String, Any>,
        where: String,
        serialize: Boolean,
        out: MutableList<String>,
        visited: MutableSet<String>,
        depth: Int = 0,
    ) {
        // 재귀 바닥 — 아래 visited 키가 못 알아보는 감싸기(oneOf 갈래 등)로 자기 참조가 와도 스택이 넘치지 않게.
        if (depth > maxCompareDepth) return
        // Any·Object 는 코드가 모양을 말하지 않고, JsonNode 는 손으로 읽어 이름을 모른다 — 배열·객체 어느 쪽과도 대조하지 않는다.
        if (type.rawClass == Any::class.java || JsonNode::class.java.isAssignableFrom(type.rawClass)) return
        val resolved = resolve(schema)
        val documented = properties(resolved)
        @Suppress("UNCHECKED_CAST")
        val items = resolved["items"] as? Map<String, Any>
        val shape = shapeOf(resolved)

        if (type.isCollectionLikeType || type.isArrayType) {
            if (items == null) out += "$where: 코드는 배열인데 문서는 $shape"
            else compare(type.contentType, items, where, serialize, out, visited, depth + 1)
            return
        }
        if (items != null) {
            out += "$where: 문서는 배열인데 코드는 ${type.rawClass.simpleName}"
            return
        }
        if (type.isMapLikeType) {
            // 키는 런타임 값이라 이름을 대조할 수 없다. 값 타입은 대조할 수 있다.
            @Suppress("UNCHECKED_CAST")
            val values = resolved["additionalProperties"] as? Map<String, Any>
            // 문서가 이름 있는 속성(닫힌 객체·oneOf)을 적어도 대조하지 않는다 — 손으로 짓는 Map 의 키는
            // 정적으로 알 수 없다(AssistantMessage.payload·Notification.actionPayload). 타입 있는 DTO 로 바꿔야 잡힌다.
            if (values != null) compare(type.contentType, values, "$where{값}", serialize, out, visited, depth + 1)
            else if (isScalarSchema(resolved) || resolved["additionalProperties"] == false) {
                out += "$where: 코드는 Map(임의 키)인데 문서는 $shape"
            }
            return
        }
        if (isLeaf(type)) {
            val documentedAsObject = documented != null || resolved["type"] == "object" || resolved.containsKey("additionalProperties")
            if (documentedAsObject) {
                out += "$where: 문서는 ${documented?.let { "객체(${it.keys.sorted()})" } ?: shape}인데 코드는 ${type.rawClass.simpleName}"
            }
            return
        }
        if (documented == null) {
            out += "$where: 코드는 객체(${type.rawClass.simpleName})인데 문서는 $shape"
            return
        }
        // 재귀 방지 키는 스키마 **이름**으로 — allOf 를 합치면 매번 새 Map 이 생겨 객체 동일성으로는 못 막는다.
        // 같은 층에 속성이 붙은 `allOf: [{ $ref: X }] + properties` 는 X 와 다른 스키마다 — 이름 키를 쓰지 않는다.
        // 이름이 없으면 스키마 **내용**(Map 의 구조적 hashCode)으로 — 위치(where)로 하면 층마다 키가 달라져
        // 이름 없는 감싸기(oneOf 갈래 둘 등)의 자기 참조를 못 알아보고 갈래 수의 거듭제곱으로 돈다.
        val key = refName(schema).takeIf { properties(schema) == null } ?: "#${schema.hashCode()}"
        if (!visited.add("$type|$key|$serialize")) return

        val description = if (serialize) mapper.serializationConfig.introspect(type) else mapper.deserializationConfig.introspect(type)
        val actual = description.findProperties()
            .filter { if (serialize) it.couldSerialize() else it.couldDeserialize() }
            .associateBy { it.name }

        val owner = "$where ${type.rawClass.simpleName}"
        (actual.keys - documented.keys).sorted().forEach { out += "$owner: 코드에만 `$it`" }
        (documented.keys - actual.keys).sorted().forEach { out += "$owner: 문서에만 `$it`" }
        (actual.keys intersect documented.keys).forEach { name ->
            @Suppress("UNCHECKED_CAST")
            val child = documented[name] as? Map<String, Any> ?: return@forEach
            compare(actual.getValue(name).primaryType, child, "$owner.$name", serialize, out, visited, depth + 1)
        }
    }

    /**
     * `$ref` 를 풀고, `allOf`·`oneOf`·`anyOf` 는 구성원과 **같은 층의 `properties`** 를 합친다.
     * oneOf 를 합집합으로 보는 이유: 코드는 한 DTO 로 모든 갈래를 받으므로(예: TurnInputRequest)
     * 그 DTO 의 속성 = 갈래들 속성의 합이다.
     */
    @Suppress("UNCHECKED_CAST")
    private fun resolve(schema: Map<String, Any>): Map<String, Any> {
        val ref = schema["\$ref"] as? String
        if (ref != null) return resolve(componentSchemas().getValue(ref.substringAfterLast('/')) as Map<String, Any>)
        val members = members(schema)
        if (members.isEmpty()) return schema
        val resolvedMembers = members.map(::resolve)
        // 속성을 가진 갈래가 하나도 없으면 객체로 합치지 않는다 — 합치면 빈 객체가 만들어져 열거형·배열 필드가
        // "문서는 객체"로 오판된다. `allOf: [{ $ref: X }]`(설명용 감싸기)·`anyOf: [X, {type: 'null'}]`(nullable)는 X 다.
        if (resolvedMembers.none { properties(it) != null } && properties(schema) == null) {
            return resolvedMembers.filterNot { it["type"] == "null" }.singleOrNull() ?: schema
        }
        val merged = (resolvedMembers.mapNotNull(::properties) + listOfNotNull(properties(schema)))
            .fold(emptyMap<String, Any>()) { a, b -> a + b }
        return mapOf("type" to "object", "properties" to merged)
    }

    /** `$ref`, 또는 null 이 아닌 갈래가 하나뿐인 감싸기(allOf·oneOf·anyOf — nullable 관용구 포함)가 가리키는 이름. */
    @Suppress("UNCHECKED_CAST")
    private fun refName(schema: Map<String, Any>): String? {
        (schema["\$ref"] as? String)?.let { return it.substringAfterLast('/') }
        return members(schema).filterNot { it["type"] == "null" }.singleOrNull()?.let(::refName)
    }

    /** 구성 키워드(allOf·oneOf·anyOf)의 갈래들 — resolve 와 refName 이 같은 목록을 본다. */
    @Suppress("UNCHECKED_CAST")
    private fun members(schema: Map<String, Any>): List<Map<String, Any>> =
        listOf("allOf", "oneOf", "anyOf").flatMap { schema[it] as? List<Map<String, Any>> ?: emptyList() }

    @Suppress("UNCHECKED_CAST")
    private fun properties(schema: Map<String, Any>): Map<String, Any>? = schema["properties"] as? Map<String, Any>

    private fun shapeOf(schema: Map<String, Any>): String = when {
        schema["additionalProperties"] == false -> "닫힌 객체(속성 없음)"
        schema["additionalProperties"] != null -> "자유형 객체(additionalProperties)"
        schema["type"] == "object" -> "속성 없는 객체"
        isScalarSchema(schema) -> "스칼라(${schema["type"]})"
        else -> "형태 미지정"
    }

    /**
     * Jackson 이 스칼라로 쓰는 것 — 패키지 이름으로 어림한다. 웹 DTO 에 실제로 나오는 타입(문자열·수·UUID·시각·
     * 열거형·JsonNode)에는 맞고, 예외(ByteArray 는 base64 문자열, kotlin.Pair 는 객체 등)는 리포에 없어서 다루지
     * 않는다(backend/CLAUDE.md §2). 그런 타입이 들어오면 이 게이트가 오탐으로 알려 준다 — 그때 직렬화기에 묻는
     * 방식(acceptJsonFormatVisitor)으로 바꾼다.
     */
    private fun isLeaf(type: JavaType): Boolean {
        val raw = type.rawClass
        return type.isPrimitive || type.isEnumType || raw.name.startsWith("java.") || raw.name.startsWith("kotlin.") ||
            JsonNode::class.java.isAssignableFrom(raw)
    }

    private fun isScalarSchema(schema: Map<String, Any>): Boolean =
        schema["type"] in setOf("string", "integer", "number", "boolean")

    private val maxCompareDepth = 32

    private fun requestType(parameter: MethodParameter): JavaType =
        mapper.typeFactory.constructType(parameter.genericParameterType)

    private fun isNoBody(type: JavaType): Boolean =
        type.rawClass == Void.TYPE || type.rawClass == Void::class.java || type.rawClass == Unit::class.java

    /** `ResponseEntity<T>` 는 T 로. 타입 인자가 없거나 `*`·`Any` 면 null(코드가 본문 타입을 말하지 않는다). */
    private fun unwrap(type: JavaType): JavaType? {
        val body = if (ResponseEntity::class.java.isAssignableFrom(type.rawClass)) type.containedType(0) else type
        return body?.takeUnless { it.rawClass == Any::class.java }
    }

    @Suppress("UNCHECKED_CAST")
    private val spec: Map<String, Any> by lazy {
        Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
    }

    @Suppress("UNCHECKED_CAST")
    private fun components(kind: String): Map<String, Any> =
        ((spec["components"] as Map<String, Any>)[kind] as? Map<String, Any>).orEmpty()

    private fun componentSchemas() = components("schemas")

    @Suppress("UNCHECKED_CAST")
    private fun operation(path: String, method: String): Map<String, Any>? =
        ((spec["paths"] as Map<String, Any>)[path] as? Map<String, Any>)?.get(method.lowercase()) as? Map<String, Any>

    /** 2xx 응답 **전부**(`$ref` 는 풀어서) — 첫 2xx 만 보면 순서에 따라 나머지가 대조에서 빠진다. */
    @Suppress("UNCHECKED_CAST")
    private fun successResponses(operation: Map<String, Any>): List<Map<String, Any>> =
        (operation["responses"] as? Map<Any, Any>).orEmpty().entries
            .filter { it.key.toString().startsWith("2") }
            .map { (_, value) ->
                val response = value as Map<String, Any>
                (response["\$ref"] as? String)
                    ?.let { components("responses")[it.substringAfterLast('/')] as Map<String, Any> } ?: response
            }

    @Suppress("UNCHECKED_CAST")
    private fun requestSchema(operation: Map<String, Any>): Map<String, Any>? =
        (operation["requestBody"] as? Map<String, Any>)?.let(::jsonSchema)

    @Suppress("UNCHECKED_CAST")
    private fun jsonSchema(holder: Map<String, Any>): Map<String, Any>? =
        ((holder["content"] as? Map<String, Any>)?.get("application/json") as? Map<String, Any>)
            ?.get("schema") as? Map<String, Any>
}
