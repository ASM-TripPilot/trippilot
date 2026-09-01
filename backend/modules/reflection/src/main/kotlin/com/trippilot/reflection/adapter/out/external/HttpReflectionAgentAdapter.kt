package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.domain.ReflectionCard
import tools.jackson.databind.JsonNode
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import java.time.Clock
import java.util.UUID

/**
 * 실 AI 회고 경계(`POST /ai/v1/reflection/generate` · G-U5-4 해소).
 *
 * **실패를 값으로 낮춘다.** 호출측([com.trippilot.reflection.application.ReflectionService])이 이미
 * `runCatching` 으로 감싸지만, 여기서도 `null` 로 내리는 이유는 **사유를 남길 수 있는 자리가 여기**이기
 * 때문이다 — 위에서만 잡으면 "AI 카드가 안 나온다"는 사실만 남고 어느 단계에서 틀어졌는지가 사라진다.
 *
 * 응답 본문의 **안쪽을 모델링하지 않는다**(DEC-U5-14). `cover` 만 읽어 제목·부제를 뽑고 나머지는 그대로
 * 카드 원문에 싣는다 — 안쪽을 타입으로 받으면 상대가 템플릿을 하나 늘릴 때마다 우리가 깨진다.
 * (원문은 매퍼를 한 번 지나 정규화된다. jsonb 가 어차피 공백·키 순서를 정규화하므로 손실이 아니다.)
 */
class HttpReflectionAgentAdapter(
    private val client: RestClient,
    private val properties: ReflectionAgentProperties,
    private val clock: Clock,
) : ReflectionAgentPort {

    override val enabled = true

    override fun generate(input: ReflectionAgentInput): ReflectionCard? {
        // 목적지를 모르면 부르지 않는다 — 상대가 `region` 을 필수로 요구해 422 가 확정이다.
        // 빈 값을 보내 거절당하느니, 호출 자체를 아끼고 규칙 카드로 간다(지어내지 않는다).
        if (input.region.isBlank()) {
            log.debug("목적지를 몰라 회고 AI 를 부르지 않습니다 — 규칙 카드로 갑니다.")
            return null
        }
        return runCatching { call(input) }
            .onFailure { log.warn("회고 AI 호출 실패 — 규칙 카드로 갑니다. base={}", properties.baseUrl, it) }
            .getOrNull()
    }

    private fun call(input: ReflectionAgentInput): ReflectionCard? {
        val body = AiReflectionGenerateRequest(
            requestMeta = AiReflectionRequestMeta(UUID.randomUUID().toString(), clock.instant(), properties.readTimeoutMs),
            kind = input.kind,
            region = input.region,
            startDate = input.startDate,
            endDate = input.endDate,
            visits = input.visits.map {
                AiReflectionVisit(
                    ref = AiReflectionVisitRef(it.date, it.poiId.toString()),
                    poiName = it.poiName, category = it.category,
                    orderInDay = it.orderInDay, photoCount = it.photoCount,
                )
            },
            personaSummary = input.personaSummary.orEmpty(),
            events = emptyList(),
            weatherSummary = input.weatherSummary.orEmpty(),
        )

        // **JsonNode 로 받는다.** 경계 매퍼 컨버터를 0번에 꽂아 뒀으므로 `String`·`ByteArray` 로 받으면
        // 그 컨버터가 application/json 을 가로채 역직렬화하려다 깨진다(실측: MismatchedInputException).
        //
        // 바이트 동일성은 애초에 목표가 아니다 — jsonb 가 공백·키 순서를 정규화하므로 어느 경로든 같다.
        val node = client.post().uri(AiReflectionPaths.GENERATE).body(body)
            .retrieve().body(JsonNode::class.java)
            ?: return null
        // 제목 검사를 여기 두지 않는다 — [ReflectionCard] 의 불변식이 이미 막고(PBT-U5-F1),
        // 위 runCatching 이 그것을 null 로 낮춘다. 역검증에서 이 가드를 지워도 아무 테스트가 안 깨졌다:
        // 도메인과 **중복**이었다는 뜻이라 지운다(가드를 남기면 테스트가 못 보는 분기가 늘어난다).
        val title = node.path("cover").path("title").asString("").trim()
        // `is_fallback` 이면 상대도 자기 폴백이었다는 뜻이다. **그래도 쓴다** — 우리 규칙 카드보다
        // 근거가 많고, 사실은 `source` 가 아니라 이 로그로 남긴다(BR-U5-33 은 우리 단을 말한다).
        if (node.path("is_fallback").asBoolean(false)) log.info("회고 AI 가 자기 폴백으로 답했습니다.")

        return ReflectionCard(
            templateId = node.path("template_id").asString(""),
            format = node.path("format").asString("CARD"),
            title = title,
            subtitle = node.path("cover").path("subtitle").asString("").trim(),
            payload = MAPPER.writeValueAsString(node),
        )
    }

    private companion object {
        private val log = LoggerFactory.getLogger(HttpReflectionAgentAdapter::class.java)
        private val MAPPER = ReflectionBoundaryMapper.create()
    }
}
