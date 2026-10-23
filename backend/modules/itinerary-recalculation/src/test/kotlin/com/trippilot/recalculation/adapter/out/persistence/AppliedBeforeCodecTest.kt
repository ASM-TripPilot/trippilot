package com.trippilot.recalculation.adapter.out.persistence

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.recalculation.domain.ReplanDiff
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalTime

/**
 * 반영 직전 비교 기준(`applied_before` jsonb · TRIP-1412)의 왕복. 값이 새면 반영 뒤 비교가 반영 전 화면과 다른 말을 한다 —
 * 빠진 곳의 이름이 비거나, 자정 넘김이 사라져 복귀 시각의 부호가 뒤집힌다(HC4).
 *
 * **메모리 맵을 그대로 되읽으면 아무것도 재지 않는다** — 실제 저장은 jsonb 라 한 번은 JSON 을 통과시킨다.
 */
class AppliedBeforeCodecTest : StringSpec({

    @Suppress("UNCHECKED_CAST")
    fun throughJsonb(view: ReplanDiff.SlotView): ReplanDiff.SlotView {
        val mapper = ObjectMapper()
        val raw = mapper.readValue(mapper.writeValueAsString(view.toJsonMap()), Map::class.java) as Map<String, Any>
        return raw.toSlotView()
    }

    "표면까지 다 실린 칸이 그대로 돌아온다 — 자정 넘김 포함" {
        val view = ReplanDiff.SlotView(
            slotKey = "2026-08-11#b5f1", startAt = LocalTime.parse("23:00"), endAt = LocalTime.parse("00:30"),
            isFixed = true, endsNextDay = true, distanceM = 1200,
            nameKo = "야시장", category = "야경", imageUrl = "https://img/x.jpg", lat = 33.4996, lng = 126.5312,
        )

        throughJsonb(view) shouldBe view
    }

    // 정수 표기(`33`)로 적힌 수는 잭슨이 Integer 로 돌려준다 — `as? Double` 이면 조용히 null(= 위치 모름)이 된다.
    // 우리 작성기는 Double 을 `33.0` 으로 적어 이 경우를 만들지 않으므로, 읽기 쪽을 **날 맵**으로 직접 잰다.
    "정수 표기로 적힌 수도 읽는다 — 조용히 모른다가 되지 않는다" {
        val raw = mapOf<String, Any>(
            "slotKey" to "2026-08-11#c", "startAt" to "10:00", "endAt" to "11:00", "isFixed" to false, "endsNextDay" to false,
            "distanceM" to 1200L, "lat" to 33, "lng" to 126,
        )

        val view = raw.toSlotView()
        view.lat shouldBe 33.0
        view.lng shouldBe 126.0
        view.distanceM shouldBe 1200
    }

    "모르는 값은 모르는 채로 — 키를 넣지 않는다" {
        val view = ReplanDiff.SlotView("2026-08-11#d", LocalTime.parse("10:00"), LocalTime.parse("11:00"), false)

        view.toJsonMap().keys shouldBe setOf("slotKey", "startAt", "endAt", "isFixed", "endsNextDay")
        throughJsonb(view) shouldBe view
    }
})
