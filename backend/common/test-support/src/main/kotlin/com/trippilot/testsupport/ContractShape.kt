package com.trippilot.testsupport

import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

/**
 * 경계 계약 **모양 대조** — 이름이 같고 모양이 다른 경우를 잡는다.
 *
 * ## 왜 필요한가
 *
 * 우리 계약 게이트들은 오래도록 **속성 이름만** 대조했다. 그래서 배열 원소가 문자열인지 객체인지,
 * 그 객체 안이 무엇인지는 아무도 안 봤다. 실측(2026-09-16): 알림 경계가 `slots` 를 **문자열 배열**로
 * 보내는데 계약은 **객체 배열**이었고, `slots` 라는 **이름은 양쪽에 다 있어서** 게이트가 통과했다.
 * 그 상태로 켜면 **매 호출이 422** 이고, 어댑터가 실패를 삼켜 *"AI 를 켰는데 늘 상수 문구"* 로만 보인다.
 *
 * ## 왜 모듈마다 두지 않나
 *
 * 세 경계(일정·알림·회고)가 같은 검사를 필요로 한다. 복사하면 갈라지고, 갈라지면 **한 곳만 고쳐진
 * 채로 나머지가 무방비로 남는다** — 이 리포는 손으로 관리하던 경로 목록이 둘로 갈라져 `explanations`
 * 가 오래도록 게이트 밖에 있던 전력이 있다.
 *
 * ## 무엇을 보지 않는가
 *
 * **null 은 건너뛴다.** 값이 없으면 우리가 의도한 타입을 알 수 없다. nullable 여부는 이 검사가 아니라
 * 실호출이 답한다 — 그래서 표본은 모든 필드를 채우는 편이 낫다.
 *
 * **제약도 안 본다**(`minItems`·`maxItems`·enum 값·문자열 길이). 그것들은 각 게이트가 계약에서 직접
 * 읽어 생산 상수와 대조하는 편이 낫다.
 */
object ContractShape {

    /**
     * [value] 를 [mapper] 로 직렬화해 [schemaName] 스키마와 모양을 견준다.
     *
     * @param schemas 계약의 `components.schemas` 노드.
     * @return 어긋난 자리들(`"경로: 계약=[...] 우리=..."`). 비어 있으면 일치.
     */
    fun mismatches(mapper: ObjectMapper, schemas: JsonNode, value: Any, schemaName: String): List<String> {
        val out = mutableListOf<String>()

        fun resolve(node: JsonNode?): JsonNode? {
            val ref = node?.get("\$ref")?.asString() ?: return node
            return schemas[ref.substringAfterLast('/')]
        }

        /** 계약이 허용하는 JSON 종류. `anyOf`(= OpenAPI 3.1 의 nullable 표기)는 갈래를 모두 편다. */
        fun kinds(spec: JsonNode?): Set<String> {
            val s = resolve(spec) ?: return emptySet()
            s["anyOf"]?.let { return it.flatMap { branch -> kinds(branch) }.toSet() }
            val declared = s["type"]?.asString()
            return when {
                declared != null -> setOf(declared)
                s["properties"] != null -> setOf("object")
                s["enum"] != null -> setOf("string")
                else -> emptySet() // 모양을 말하지 않는 스키마 — 주장하지 않는다
            }
        }

        fun kindOf(n: JsonNode): String = when {
            n.isArray -> "array"
            n.isObject -> "object"
            n.isBoolean -> "boolean"
            n.isIntegralNumber -> "integer"
            n.isNumber -> "number"
            else -> "string"
        }

        fun walk(actual: JsonNode, spec: JsonNode?, path: String) {
            if (actual.isNull) return
            val allowed = kinds(spec)
            val got = kindOf(actual)
            // 계약이 number 인데 우리가 정수를 보내는 것은 어긋남이 아니다.
            val ok = allowed.isEmpty() || got in allowed || (got == "integer" && "number" in allowed)
            if (!ok) {
                out += "${path.ifEmpty { "(루트)" }}: 계약=${allowed.sorted()} 우리=$got"
                return // 이미 어긋난 가지는 더 내려가 봐야 소음만 는다
            }
            val s = resolve(spec) ?: return
            when {
                actual.isArray -> actual.forEachIndexed { i, e -> walk(e, s["items"], "$path[$i]") }
                actual.isObject -> {
                    val propSpecs = s["properties"] ?: return
                    actual.properties().forEach { (k, v) ->
                        walk(v, propSpecs[k], if (path.isEmpty()) k else "$path.$k")
                    }
                }
            }
        }

        walk(mapper.readTree(mapper.writeValueAsString(value)), schemas[schemaName], "")
        return out
    }
}
