package com.trippilot.app.web

import org.springframework.core.io.ClassPathResource
import org.yaml.snakeyaml.Yaml

/**
 * 계약 정본(빌드가 classpath 로 복사한 openapi.yaml)을 한 번만 읽어 둔다 — 계약을 읽는 테스트들이 각자 다른 방식으로
 * 읽으면(위치·로더 옵션) 서로 다른 스펙을 보게 된다. 원문 문자열·엄격 모드가 필요한 검사는 따로 읽는다.
 */
internal object OpenApiSpec {
    val document: Map<String, Any> by lazy { Yaml().load(ClassPathResource("static/openapi.yaml").inputStream) }

    @Suppress("UNCHECKED_CAST")
    fun schema(name: String): Map<String, Any> =
        requireNotNull(((document["components"] as Map<String, Any>)["schemas"] as Map<String, Any>)[name] as? Map<String, Any>) {
            "openapi.yaml 에 $name 스키마가 없다"
        }
}
