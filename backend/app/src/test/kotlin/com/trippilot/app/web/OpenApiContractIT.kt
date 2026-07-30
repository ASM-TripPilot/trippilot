package com.trippilot.app.web

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertAll
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import org.yaml.snakeyaml.Yaml

/**
 * 설계-우선 계약 게이트 — docs/design/openapi.yaml(정본) 과 실제 Spring 핸들러 매핑이 정확히 일치해야 통과.
 * 문서에만 있거나(미구현) 코드에만 있으면(미문서화) 빌드 실패 → 스펙-코드 드리프트 원천 차단.
 * springdoc 없이 Spring 자체 매핑을 introspect(SB4 안전). 서비스 표면(base 하위)만 대상(헬스·문서·정적 제외).
 */
@SpringBootTest
class OpenApiContractIT : AbstractPostgresIntegrationTest() {

    @Autowired
    @Qualifier("requestMappingHandlerMapping") // 여러 매핑 빈 중 MVC 컨트롤러 매핑(actuator 매핑 아님)
    private lateinit var handlerMapping: RequestMappingHandlerMapping

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
        val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
        @Suppress("UNCHECKED_CAST")
        val paths = spec["paths"] as Map<String, Map<String, Any>>
        return paths.entries.flatMap { (path, ops) ->
            ops.keys.filter { it.lowercase() in httpMethods }
                .map { "${it.uppercase()} $basePath$path" }
        }.toSet()
    }

    /** Spring 핸들러 매핑을 "METHOD 절대경로" 집합으로. 서비스 표면(base 하위)만. */
    private fun implementedApiEndpoints(): Set<String> =
        handlerMapping.handlerMethods.keys.flatMap { info ->
            val patterns = info.pathPatternsCondition?.patternValues ?: emptySet()
            val methods = info.methodsCondition.methods.map { it.name }
            patterns.flatMap { p -> methods.map { m -> "$m $p" } }
        }.filter { it.substringAfter(" ").startsWith("$basePath/") }.toSet()
}
