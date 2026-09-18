package com.trippilot.core.event

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.arbitrary.uuid
import io.kotest.property.checkAll
import java.time.Instant

/**
 * PBT 작성 패턴 예시(TRIP-149 템플릿) — 도메인 타입용 커스텀 Arb + checkAll.
 * 이후 유닛은 이 패턴을 복제해 상태머신·직렬화 왕복 등 속성을 검증한다(nfr §7.3 1급 대상).
 */
class EventEnvelopePropertyTest : StringSpec({

    val envelopeArb: Arb<EventEnvelope> = arbitrary {
        EventEnvelope(
            eventId = Arb.uuid().bind(),
            eventType = Arb.string(1, 40).bind(),
            schemaVersion = Arb.int(1, 5).bind(),
            aggregateType = Arb.string(1, 20).bind(),
            aggregateId = Arb.string(1, 40).bind(),
            correlationId = Arb.string(1, 40).orNull().bind(),
            occurredAt = Instant.ofEpochMilli(Arb.long(0L, 2_000_000_000_000L).bind()),
            payload = Arb.string(0, 100).bind(),
        )
    }

    "data class copy 는 동등성을 보존한다 (PBT 패턴 예시)" {
        checkAll(envelopeArb) { envelope ->
            envelope.copy() shouldBe envelope
        }
    }
})
