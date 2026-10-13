package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.weathercontext.api.WeatherReading
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 조회 카드(FD §4 · BR-U8-14~16·28). 지키려는 것은 하나다 — **카드에 나오는 값은 저장된 값 그대로이고,
 * 도우미가 지어내거나 판정한 것이 없다.** 모르는 것은 빼거나 "미확인"이라고 하고, 원천이 죽으면 추측하지 않는다.
 */
class QueryCardsTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-11-01")
    val d2 = d1.plusDays(1)
    val d3 = d1.plusDays(2)
    /** 둘째 날 정오(KST). */
    val noonDay2 = Instant.parse("2026-11-02T03:00:00Z")

    fun ctx(
        stay: String? = "서면 호텔",
        now: Instant = noonDay2,
        arguments: Map<String, String> = emptyMap(),
        inTrip: Boolean = true,
        days: Long = 3,
    ) = DispatchContext(
        acc, tripId, TripContext(listOf("부산"), (days - 1).toInt(), stay, d1, d1.plusDays(days - 1)), inTrip, AssistantSurface.ITINERARY, arguments, now,
    )

    @Suppress("UNCHECKED_CAST")
    fun rows(payload: Map<String, Any?>?, key: String = "rows") =
        (payload!![key] as List<Map<String, String>>).map { it["label"] to it["value"] }

    @Suppress("UNCHECKED_CAST")
    fun problems(payload: Map<String, Any?>?) = payload!!["problems"] as List<Map<String, Any?>>

    fun cards(data: FakeTripData) = QueryCards(data, data, data, data)

    "진행 검토 — 요약은 저장된 사실, 문제는 솔버가 표기한 위반과 빈 일자뿐이다" {
        val museum = plannedSlot(d2, 0, "14:00", "미술관", violation = "앞 장소에서 이동할 시간이 빠듯해요")
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변"), museum, plannedSlot(d2, 1, "16:00", "카페")))

        val card = cards(data).review(ctx())

        card.kind shouldBe MessageKind.REVIEW
        card.text shouldBe "지금까지 진행 상태를 정리했어요."
        rows(card.payload, "summary") shouldContainExactly
            listOf("여행" to "부산 2박 3일", "숙소" to "서면 호텔 (등록됨)", "일정" to "3일 중 2일 채움")
        problems(card.payload).map { it["slotKey"] to it["reason"] } shouldContainExactly listOf(
            null to "3일차 일정이 비어 있어요",
            museum.slotKey to "2일차 14:00 미술관 — 앞 장소에서 이동할 시간이 빠듯해요", // 사유는 저장된 문구 그대로
        )
        @Suppress("UNCHECKED_CAST")
        (problems(card.payload).last()["fixAction"] as Map<String, Any?>)["type"] shouldBe "OPEN_ITINERARY_EDIT"
        card.footnote shouldBe "* 시간·이동 검증은 일정 솔버 기준"
        card.nextActions.single().type shouldBe "OPEN_ITINERARY"
    }

    /** BR-U8-14 — 위반 표기가 없으면 문제도 없다. 도우미가 "빠듯해 보여요"를 스스로 말하지 않는다. */
    "진행 검토 — 위반 표기가 없으면 문제 행이 없다. 사유 없는 위반은 사유를 짓지 않는다" {
        val full = listOf(plannedSlot(d1, 0, "10:00", "해변"), plannedSlot(d2, 0, "10:00", "미술관"), plannedSlot(d3, 0, "10:00", "카페"))
        problems(cards(FakeTripData(acc, slots = full)).review(ctx()).payload) shouldBe emptyList()

        val unexplained = full.take(2) + plannedSlot(d3, 0, "10:00", null, hasViolation = true)
        problems(cards(FakeTripData(acc, slots = unexplained)).review(ctx()).payload).single()["reason"] shouldBe
            "3일차 10:00 이름 미확인 장소 — 확인이 필요해요"
    }

    "진행 검토 — 숙소가 없고 일정이 없으면 그 사실과 갈 곳을 말한다(BR-U8-16)" {
        val card = cards(FakeTripData(acc, hasItinerary = false)).review(ctx(stay = null))

        rows(card.payload, "summary") shouldContainExactly listOf("여행" to "부산 2박 3일", "숙소" to "미등록", "일정" to "아직 없음")
        problems(card.payload).map { it["reason"] } shouldContainExactly listOf("등록된 숙소가 없어요", "아직 일정이 없어요")
        card.nextActions.single().type shouldBe "OPEN_ITINERARY_METHOD"
    }

    "진행 검토 — 당일 여행에는 숙소가 없는 것이 문제가 아니다" {
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변")))

        val card = cards(data).review(ctx(stay = null, days = 1))

        problems(card.payload) shouldBe emptyList()
        rows(card.payload, "summary") shouldContainExactly listOf("여행" to "부산 당일", "숙소" to "미등록", "일정" to "1일 중 1일 채움")
    }

    /** 생성은 첫 날부터 온다. 뒤 일자는 "비어 있는" 것이 아니라 아직 만드는 중이다 — 고치라고 하면 거짓이다. */
    "진행 검토 — 일정을 만드는 중이면 뒤 일자를 비었다고 하지 않는다" {
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변")), generationState = "PARTIAL")

        val card = cards(data).review(ctx())

        problems(card.payload) shouldBe emptyList()
        rows(card.payload, "summary").last() shouldBe ("일정" to "만드는 중 (3일 중 1일 채움)")
        // 다음 장소도 같다 — 첫 날이 지났다고 "남은 일정이 없다"고 하지 않는다
        cards(data).nextSlot(ctx()).text shouldBe "일정을 만드는 중이에요."
    }

    /** 슬롯이 0건인 것은 셋 중 하나다 — 뭉개면 만드는 중인 여행에 "일정이 없다, 만들어라"고 한다. */
    "다음 장소 — 장소가 0건이면 일정이 없는지·만드는 중인지·비었는지를 가른다" {
        cards(FakeTripData(acc, hasItinerary = false)).nextSlot(ctx()).text shouldBe "아직 일정이 없어요."
        val empty = FakeTripData(acc, slots = emptyList(), generationState = "PARTIAL")
        cards(empty).nextSlot(ctx()).text shouldBe "일정을 만드는 중이에요."
        // 같은 여행에 진행 검토도 같은 말을 한다 — 두 카드가 서로 다른 사실을 말하지 않는다
        rows(cards(empty).review(ctx()).payload, "summary").last() shouldBe ("일정" to "만드는 중 (3일 중 0일 채움)")
        cards(FakeTripData(acc, slots = emptyList())).nextSlot(ctx()).let { it.text to it.nextActions.single().type } shouldBe
            ("아직 일정에 장소가 없어요." to "OPEN_ITINERARY")
        cards(FakeTripData(acc, slots = emptyList()).apply { failItinerary = true }).nextSlot(ctx()).text shouldBe "지금 일정을 확인할 수 없어요."
    }

    /** 생성이 중간에 멈추면 뒤 일자는 정말 비어 있다 — 그때 맞는 길은 손으로 채우기가 아니라 다시 만들기다. */
    "진행 검토 — 생성이 멈춘 일정의 빈 일자는 다시 만들기로 보낸다" {
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변")), generationState = "FAILED")

        @Suppress("UNCHECKED_CAST")
        val fixes = problems(cards(data).review(ctx()).payload).map { it["reason"] to (it["fixAction"] as Map<String, Any?>)["type"] }
        fixes shouldContainExactly listOf("2일차 일정이 비어 있어요" to "OPEN_REGENERATE", "3일차 일정이 비어 있어요" to "OPEN_REGENERATE")
    }

    /** 일정 요약을 못 읽은 것은 "일정이 없다"가 아니다 — 없다고 하면 있는 일정을 두고 만들라고 권한다(BR-U8-16). */
    "진행 검토 — 일정 요약을 못 읽으면 없다고 하지 않고 못 봤다고 한다" {
        val card = cards(FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변"))).apply { failItinerary = true }).review(ctx())

        card.text shouldBe "일부 정보를 확인할 수 없어 확인된 범위만 정리했어요."
        rows(card.payload, "summary").last() shouldBe ("일정" to "확인할 수 없어요")
        problems(card.payload).map { it["reason"] } shouldBe emptyList() // 못 본 일정의 문제를 짓지 않는다
        card.nextActions.single().type shouldBe "OPEN_ITINERARY"
    }

    /** 일정이 없다는 것을 확인했으면, 슬롯을 못 읽어도 답에 구멍은 없다 — "일부를 못 봤다"고 하지 않는다. */
    "진행 검토 — 일정이 없음을 확인했으면 슬롯 조회 실패는 구멍이 아니다" {
        val card = cards(FakeTripData(acc, hasItinerary = false).apply { failPlan = true }).review(ctx())

        card.text shouldBe "지금까지 진행 상태를 정리했어요."
        rows(card.payload, "summary").last() shouldBe ("일정" to "아직 없음")
    }

    /** 여행 날짜를 바꾸면 일정은 옛 날짜에 남는다. 그 슬롯을 "0일차"라고 부르지 않고, 어긋났다는 사실을 말한다. */
    "진행 검토 — 여행 날짜 밖의 일정은 날짜로 부르고 어긋남을 알린다" {
        val stray = plannedSlot(d1.minusDays(2), 0, "10:00", "옛 날짜의 곳", violation = "영업시간과 맞지 않아요")
        val data = FakeTripData(acc, slots = listOf(stray, plannedSlot(d1, 0, "10:00", "해변"), plannedSlot(d2, 0, "10:00", "미술관"), plannedSlot(d3, 0, "10:00", "카페")))

        problems(cards(data).review(ctx()).payload).map { it["reason"] } shouldContainExactly listOf(
            "여행 날짜 밖에 놓인 일정이 있어요",
            "10월 30일 10:00 옛 날짜의 곳 — 영업시간과 맞지 않아요",
        )
    }

    /** 다섯 건을 전부로 읽게 두지 않는다. 빈 일자가 많으면 줄을 세우지 않고 수를 말한다. */
    "진행 검토 — 다 못 보인 위반과 많은 빈 일자는 수로 말한다" {
        val many = (0..6).map { plannedSlot(d1, it, "1$it:00", "곳$it", violation = "영업시간과 맞지 않아요") }
        val reasons = problems(cards(FakeTripData(acc, slots = many)).review(ctx(days = 1)).payload).map { it["reason"] as String }
        reasons.size shouldBe 6
        reasons.last() shouldBe "확인이 필요한 곳이 2곳 더 있어요"

        problems(cards(FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변")))).review(ctx(days = 6)).payload)
            .map { it["reason"] } shouldContainExactly listOf("일정이 비어 있는 날이 5일 있어요")
    }

    /** 원천이 죽었다고 "일정이 없다"고 말하면 거짓이다 — 모른다고 하고 아는 것만 말한다. */
    "진행 검토 — 일정을 못 읽으면 추측하지 않고 확인된 범위만 말한다" {
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d1, 0, "10:00", "해변"))).apply { failPlan = true }

        val card = cards(data).review(ctx(stay = null))

        card.text shouldBe "일부 정보를 확인할 수 없어 확인된 범위만 정리했어요."
        rows(card.payload, "summary").last() shouldBe ("일정" to "확인할 수 없어요")
        problems(card.payload).map { it["reason"] } shouldContainExactly listOf("등록된 숙소가 없어요") // 빈 일자·"일정 없음"을 지어내지 않는다
    }

    "다음 장소 — 지금 이후의 첫 계획 슬롯. 거리를 모르면 그 줄을 뺀다" {
        val data = FakeTripData(
            acc,
            slots = listOf(
                plannedSlot(d1, 0, "10:00", "어제 간 곳"), plannedSlot(d2, 0, "09:00", "오전에 간 곳"),
                plannedSlot(d2, 1, "14:00", "카페 모카", distance = "840m"), plannedSlot(d3, 0, "10:00", "내일 갈 곳"),
            ),
        )

        val card = cards(data).nextSlot(ctx())

        card.kind shouldBe MessageKind.INFO
        card.payload!!["infoKind"] shouldBe "NEXT_SLOT"
        card.payload!!["title"] shouldBe "카페 모카"
        rows(card.payload) shouldContainExactly listOf("계획 시각" to "14:00", "직전 구간" to "840m")
        card.nextActions.single().type shouldBe "OPEN_LIVE"

        // 오늘 것이 다 지났으면 내일 첫 슬롯 — 날짜를 함께 말하고, 모르는 거리는 줄을 뺀다
        val evening = cards(data).nextSlot(ctx(now = Instant.parse("2026-11-02T12:00:00Z"), inTrip = false))
        rows(evening.payload) shouldContainExactly listOf("날짜" to "11월 3일", "계획 시각" to "10:00")
        evening.nextActions.single().type shouldBe "OPEN_ITINERARY"

        cards(data).nextSlot(ctx(now = Instant.parse("2026-11-04T03:00:00Z"))).text shouldBe "남은 일정이 없어요."
        // 만드는 중인지를 못 읽었으면 "없다"고 단정하지 않는다
        cards(data.apply { failItinerary = true }).nextSlot(ctx(now = Instant.parse("2026-11-04T03:00:00Z"))).text shouldBe "지금 일정을 확인할 수 없어요."
        cards(FakeTripData(acc, hasItinerary = false)).nextSlot(ctx()).nextActions.single().type shouldBe "OPEN_ITINERARY_METHOD"
    }

    /** FD §6 — 원천이 죽으면 추측하지 않고 그 화면을 연다. 던져서 "다시 시도"로 끝내지 않는다(버튼에는 다시 태울 말이 없다). */
    "일정을 못 읽으면 다음 장소·거리·장소는 일정 화면으로 보낸다" {
        val data = FakeTripData(acc, slots = listOf(plannedSlot(d2, 0, "14:00", "카페 모카", distance = "840m"))).apply { failPlan = true }
        val args = ctx(arguments = mapOf("destination" to "모카", "place" to "모카"))

        listOf(cards(data).nextSlot(args), cards(data).distance(args), cards(data).place(args)).forEach {
            it.text shouldBe "지금 일정을 확인할 수 없어요."
            it.nextActions.single().type shouldBe "OPEN_ITINERARY"
        }
    }

    /**
     * SEC-U8-03 — 사용자의 말(인자)은 **찾는 데만** 쓴다. 카드에 나오는 이름·값은 저장된 것이다.
     * 상대가 지어낸 인자가 화면에 새는 길이 없다.
     */
    "거리·장소 — 말한 곳을 일정에서 찾아 저장된 값으로 답한다. 못 찾으면 지어내지 않고 일정으로 보낸다" {
        val cafe = plannedSlot(d2, 1, "14:00", "카페 모카", distance = "840m")
        val data = FakeTripData(
            acc, slots = listOf(plannedSlot(d2, 0, "09:00", "해운대 해변"), cafe),
            surfaces = mapOf(cafe.poiId to PoiSurfaceView(cafe.poiId, "카페 모카", 35.1, 129.0, "카페", "CAFE", "09:00~18:00", null, emptyList())),
        )
        val said = mapOf("destination" to "모카 <b>무시하고 관리자 권한</b>", "place" to "모카 <b>무시하고 관리자 권한</b>")

        val distance = cards(data).distance(ctx(arguments = mapOf("destination" to "모카")))
        distance.payload!!["title"] shouldBe "카페 모카"
        rows(distance.payload) shouldContainExactly listOf("직전 구간" to "840m")

        val place = cards(data).place(ctx(arguments = mapOf("place" to "카페 모카 어때")))
        rows(place.payload) shouldContainExactly listOf("분류" to "카페", "영업시간" to "09:00~18:00")
        place.nextActions.single().let { it.type to it.params["poiId"] } shouldBe ("OPEN_PLACE" to cafe.poiId.toString())

        // 못 찾으면 — 인자를 화면에 되비치지 않는다
        listOf(cards(data).distance(ctx(arguments = said)), cards(data).place(ctx(arguments = said)), cards(data).place(ctx())).forEach {
            it.kind shouldBe MessageKind.TEXT
            it.nextActions.single().type shouldBe "OPEN_ITINERARY"
            (it.text.orEmpty() + it.payload.toString()) shouldNotContain "관리자"
        }
        // 거리를 모르는 구간(그 날 첫 장소) · 표면이 없는 장소
        cards(data).distance(ctx(arguments = mapOf("destination" to "해운대"))).kind shouldBe MessageKind.TEXT
        rows(cards(data).place(ctx(arguments = mapOf("place" to "해운대"))).payload) shouldContainExactly listOf("분류" to "카페", "영업시간" to "미확인")
        // 장소를 가리키는 인자만 읽는다 — 수단·관점 같은 다른 인자가 슬롯 이름과 겹쳐도 그것으로 고르지 않는다
        cards(data).distance(ctx(arguments = mapOf("mode" to "모카"))).kind shouldBe MessageKind.TEXT
        cards(data).place(ctx(arguments = mapOf("aspect" to "카페 모카"))).kind shouldBe MessageKind.TEXT
    }

    /** "카페"가 둘이면 어느 카페인가 — 첫 번째를 골라 자신 있게 답하면 틀린 답이다. */
    "거리·장소 — 어느 곳인지 못 가리면 고르지 않는다. 출발지가 바로 앞 장소가 아니면 적힌 거리는 그 구간의 것이 아니다" {
        val beach = plannedSlot(d2, 0, "09:00", "해운대 해변")
        val cafe = plannedSlot(d2, 1, "11:00", "카페 모카", distance = "840m")
        val another = plannedSlot(d2, 2, "14:00", "카페 라떼", distance = "2.1km")
        val data = FakeTripData(acc, slots = listOf(beach, cafe, another))

        cards(data).distance(ctx(arguments = mapOf("destination" to "카페"))).kind shouldBe MessageKind.TEXT
        cards(data).place(ctx(arguments = mapOf("place" to "카페"))).kind shouldBe MessageKind.TEXT

        // 해변 → 모카 는 일정상 이어진 구간이다
        rows(cards(data).distance(ctx(arguments = mapOf("origin" to "해변", "destination" to "모카"))).payload) shouldContainExactly listOf("직전 구간" to "840m")
        // 해변 → 라떼 는 사이에 모카가 있다 — 라떼에 적힌 거리는 모카에서의 거리다
        cards(data).distance(ctx(arguments = mapOf("origin" to "해변", "destination" to "라떼"))).kind shouldBe MessageKind.TEXT
        cards(data).distance(ctx(arguments = mapOf("origin" to "없는 곳", "destination" to "모카"))).kind shouldBe MessageKind.TEXT

        // 이름이 한 글자인 슬롯은 거의 모든 말에 들어 있다 — 그것이 유일한 "일치"라고 그 슬롯으로 답하지 않는다
        val oneChar = FakeTripData(acc, slots = listOf(plannedSlot(d2, 0, "09:00", "숲", distance = "300m")))
        cards(oneChar).distance(ctx(arguments = mapOf("destination" to "대나무숲 산책로"))).kind shouldBe MessageKind.TEXT
    }

    /** 확정된 슬롯은 확정 당시의 이름이 이긴다 — 그 판단은 일정 모듈 것이다. 정본에서는 영업시간만 얹는다. */
    "장소 — 이름·분류는 일정의 값이고 정본에서는 영업시간만 가져온다" {
        val cafe = plannedSlot(d2, 0, "14:00", "카페 모카")
        val data = FakeTripData(
            acc, slots = listOf(cafe),
            surfaces = mapOf(cafe.poiId to PoiSurfaceView(cafe.poiId, "개명한 카페", 35.1, 129.0, "맛집", "FOOD", "10:00~20:00", null, emptyList())),
        )

        val card = cards(data).place(ctx(arguments = mapOf("place" to "모카")))

        card.payload!!["title"] shouldBe "카페 모카"
        rows(card.payload) shouldContainExactly listOf("분류" to "카페", "영업시간" to "10:00~20:00")
    }

    /** U4 BR 승계 — 잘못된 정보로 말하지 않는다. 오래된 값·조회 실패는 "확인할 수 없다"다. */
    "날씨 — 신선한 값만 말한다. 오래됐거나 못 받았으면 확인할 수 없다고 한다" {
        val fresh = cards(FakeTripData(acc, reading = WeatherReading(70, "호우주의보", noonDay2, stale = false))).weather(ctx())
        fresh.payload!!["title"] shouldBe "부산 날씨"
        fresh.text shouldBe "오늘 예보예요." // 원천의 값은 그 날의 최대치다 — "지금"이라고 하지 않는다
        rows(fresh.payload) shouldContainExactly listOf("오늘 최대 강수확률" to "70%", "특보" to "호우주의보")
        rows(cards(FakeTripData(acc, reading = WeatherReading(10, null, noonDay2, stale = false))).weather(ctx()).payload) shouldContainExactly
            listOf("오늘 최대 강수확률" to "10%")

        listOf(
            FakeTripData(acc, reading = WeatherReading(70, null, noonDay2, stale = true)),
            FakeTripData(acc, reading = null),
            FakeTripData(acc, reading = WeatherReading(70, null, noonDay2, stale = false)).apply { failWeather = true },
        ).forEach { data ->
            val card = cards(data).weather(ctx())
            card.text shouldBe "지금 날씨를 확인할 수 없어요."
            card.payload shouldBe null
        }
    }
})
