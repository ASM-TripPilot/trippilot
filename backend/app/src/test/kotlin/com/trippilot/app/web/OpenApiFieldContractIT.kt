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
import org.springframework.core.io.ClassPathResource
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import org.yaml.snakeyaml.Yaml

/**
 * 필드 계약 게이트 — openapi.yaml 스키마의 **속성 이름**과 Jackson 이 실제로 쓰고 읽는 이름이 같아야 통과.
 *
 * 왜 필요한가: [OpenApiContractIT] 는 경로·메서드만 본다. 응답에 필드를 더하거나 이름을 바꾸고 문서를
 * 안 고치면 그 게이트는 초록인데, 프론트는 orval 이 문서로 만든 타입을 쓰므로 **새 필드를 못 보거나
 * 없는 필드를 읽는다**(undefined). 둘 다 컴파일도 테스트도 통과한 채 화면에서만 드러난다.
 *
 * 무엇과 맞대는가: DTO 의 Kotlin 필드가 아니라 **MVC 컨버터의 매퍼(WebConfig)가 보는 속성**이다 —
 * `@JsonProperty`·`@JsonIgnore` 까지 반영된 "와이어에 실제로 오가는 이름". 응답은 직렬화 쪽,
 * 요청 본문은 역직렬화 쪽으로 따로 본다. 중첩 DTO 는 스키마의 `$ref`·`items` 를 따라 내려간다.
 *
 * 보지 않는 것(다음 단계): 타입·nullable·required. 이름만으로도 와이어가 갈리는 가장 흔한 경우를 잡는다.
 */
@SpringBootTest
class OpenApiFieldContractIT : AbstractPostgresIntegrationTest() {

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private lateinit var handlerMapping: RequestMappingHandlerMapping

    @Autowired
    private lateinit var mapper: ObjectMapper

    private val basePath = "/api/v1"

    @Suppress("UNCHECKED_CAST")
    private val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)

    @Suppress("UNCHECKED_CAST")
    private val components = spec["components"] as Map<String, Map<String, Any>>

    /**
     * 알고 남겨 둔 불일치 — **사유가 없으면 넣지 않는다.** 고쳐져서 더 안 나오면 이 게이트가 실패해
     * 항목을 지우게 한다(목록이 썩지 않게).
     */
    private val known = mapOf(
        "GET /api/v1/me/location-consent 응답 LocationConsentResponse.capabilities Capabilities: 문서에만 `localLocationUse`" to
            "모노레포 통합 때부터 문서에만 있고 서버는 한 번도 내지 않았다. 의미(OS 권한만으로 되는 기기 내 사용?)가 " +
            "설계 문서에 없고, 지우면 프론트 테스트 목업이 codegen 뒤 타입 오류가 난다 — 팀 결정 대기(2026-10-19)",
        "PUT /api/v1/me/location-consent 응답 LocationConsentResponse.capabilities Capabilities: 문서에만 `localLocationUse`" to
            "위와 같음",
    )

    @Test
    fun `응답·요청 본문의 필드 이름이 openapi 스키마와 일치한다`() {
        val mismatches = mutableListOf<String>()
        handlerMapping.handlerMethods.forEach { (info, handler) ->
            val method = info.methodsCondition.methods.singleOrNull()?.name ?: return@forEach
            val pattern = info.pathPatternsCondition?.patternValues?.singleOrNull() ?: return@forEach
            if (!pattern.startsWith("$basePath/")) return@forEach
            val operation = operation(pattern.removePrefix(basePath), method) ?: return@forEach
            val label = "$method $pattern"

            responseSchema(operation)?.let { schema ->
                val type = unwrap(mapper.typeFactory.constructType(handler.returnType.genericParameterType))
                compare(type, schema, "$label 응답", serialize = true, mismatches, mutableSetOf())
            }
            val body = handler.methodParameters.firstOrNull { it.hasParameterAnnotation(RequestBody::class.java) }
            if (body != null) {
                requestSchema(operation)?.let { schema ->
                    val type = mapper.typeFactory.constructType(body.genericParameterType)
                    compare(type, schema, "$label 요청", serialize = false, mismatches, mutableSetOf())
                }
            }
        }

        val unexpected = (mismatches - known.keys).sorted()
        val stale = (known.keys - mismatches.toSet()).sorted()
        assertAll(
            {
                assertTrue(unexpected.isEmpty()) {
                    "openapi.yaml 과 와이어 필드가 다르다 — 코드가 맞으면 문서를, 문서가 맞으면 DTO 를 고친다:\n  " +
                        unexpected.joinToString("\n  ")
                }
            },
            { assertTrue(stale.isEmpty()) { "더 이상 안 나는 예외 — known 에서 지운다:\n  " + stale.joinToString("\n  ") } },
        )
    }

    private fun compare(
        type: JavaType,
        schema: Map<String, Any>,
        where: String,
        serialize: Boolean,
        out: MutableList<String>,
        visited: MutableSet<String>,
    ) {
        val resolved = resolve(schema)
        if (type.isCollectionLikeType || type.isArrayType) {
            @Suppress("UNCHECKED_CAST")
            val items = resolved["items"] as? Map<String, Any> ?: return
            return compare(type.contentType, items, where, serialize, out, visited)
        }
        val documented = properties(resolved)
        if (isLeaf(type)) {
            // 본문을 JsonNode 로 받아 손으로 읽는 핸들러는 Jackson 이 속성을 모른다 — 대조할 수 없다.
            // Map 도 마찬가지로 키가 런타임 값이라 이름을 대조할 수 없다.
            if (documented != null && !type.isMapLikeType && !JsonNode::class.java.isAssignableFrom(type.rawClass)) {
                out += "$where: 문서는 객체(${documented.keys.sorted()})인데 코드는 ${type.rawClass.simpleName}"
            }
            return
        }
        documented ?: return
        if (!visited.add("$type|${System.identityHashCode(resolved)}|$serialize")) return

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
            compare(actual.getValue(name).primaryType, child, "$owner.$name", serialize, out, visited)
        }
    }

    /** `$ref`(컴포넌트 스키마)를 풀고, `allOf` 는 속성을 합친다. */
    @Suppress("UNCHECKED_CAST")
    private fun resolve(schema: Map<String, Any>): Map<String, Any> {
        val ref = schema["\$ref"] as? String
        if (ref != null) return resolve(components.getValue("schemas")[ref.substringAfterLast('/')] as Map<String, Any>)
        val allOf = schema["allOf"] as? List<Map<String, Any>> ?: return schema
        // `allOf: [{ $ref: X }]` 한 칸은 설명을 달려고 감싼 것뿐이다(X 가 열거형이어도) — 그대로 푼다.
        if (allOf.size == 1) return resolve(allOf.single())
        val merged = allOf.map(::resolve).mapNotNull { properties(it) }.fold(emptyMap<String, Any>()) { a, b -> a + b }
        return mapOf("type" to "object", "properties" to merged)
    }

    @Suppress("UNCHECKED_CAST")
    private fun properties(schema: Map<String, Any>): Map<String, Any>? = schema["properties"] as? Map<String, Any>

    private fun isLeaf(type: JavaType): Boolean {
        val name = type.rawClass.name
        return type.isPrimitive || type.isEnumType || type.isMapLikeType ||
            name.startsWith("java.") || name.startsWith("kotlin.") || JsonNode::class.java.isAssignableFrom(type.rawClass)
    }

    private fun unwrap(type: JavaType): JavaType =
        if (ResponseEntity::class.java.isAssignableFrom(type.rawClass)) type.containedTypeOrUnknown(0) else type

    @Suppress("UNCHECKED_CAST")
    private fun operation(path: String, method: String): Map<String, Any>? =
        ((spec["paths"] as Map<String, Any>)[path] as? Map<String, Any>)?.get(method.lowercase()) as? Map<String, Any>

    @Suppress("UNCHECKED_CAST")
    private fun responseSchema(operation: Map<String, Any>): Map<String, Any>? {
        val responses = operation["responses"] as? Map<Any, Any> ?: return null
        val ok = responses.entries.firstOrNull { it.key.toString().startsWith("2") }?.value as? Map<String, Any> ?: return null
        val response = (ok["\$ref"] as? String)
            ?.let { components.getValue("responses")[it.substringAfterLast('/')] as Map<String, Any> } ?: ok
        return jsonSchema(response)
    }

    @Suppress("UNCHECKED_CAST")
    private fun requestSchema(operation: Map<String, Any>): Map<String, Any>? =
        (operation["requestBody"] as? Map<String, Any>)?.let(::jsonSchema)

    @Suppress("UNCHECKED_CAST")
    private fun jsonSchema(holder: Map<String, Any>): Map<String, Any>? =
        ((holder["content"] as? Map<String, Any>)?.get("application/json") as? Map<String, Any>)
            ?.get("schema") as? Map<String, Any>
}
