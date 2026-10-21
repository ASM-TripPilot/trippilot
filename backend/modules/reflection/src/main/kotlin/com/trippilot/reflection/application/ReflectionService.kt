package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.reflection.api.event.ReflectionReady
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.ReflectionStats
import com.trippilot.reflection.domain.UnreadableDraft
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import com.trippilot.trip.api.TripPeriod
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionOperations
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 하루 회고 생성(US-REC-06 · BR-U5-31~34).
 *
 * **빈 화면을 그리지 않는 것**이 이 서비스의 계약이다(PBT-U5-1). 방문 0곳·사진 0장·메모 0개여도
 * `stats` 를 채운 기본 카드가 나온다 — 폴백 3단(AI → 규칙 → 기본)의 아래 두 단이 여기 있다.
 *
 * **방향은 한쪽뿐이다**: 여기서 `ArchiveRecordFacade` 를 읽고, archive 는 이 모듈을 모른다(BR-U5-51).
 */
@Service
class ReflectionService internal constructor(
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val reflections: ReflectionRepository,
    private val cards: ReflectionCardCodec,
    private val agent: ReflectionAgentPort,
    private val events: DomainEventPublisher,
    private val metrics: ReflectionMetrics,
    private val clock: Clock,
    private val materials: ReflectionMaterials,
    /** 쓰기 트랜잭션 — 생성·수정은 초안(AI 호출·재료 조회)을 **이 밖에서** 만들고, 잠금·저장·발행만 이 안에서 한다. */
    private val writes: TransactionOperations,
) {
    @Autowired
    constructor(
        trips: TripFacade,
        archive: ArchiveRecordFacade,
        poiSurfaces: PoiSurfaceFacade,
        reflections: ReflectionRepository,
        cards: ReflectionCardCodec,
        agent: ReflectionAgentPort,
        events: DomainEventPublisher,
        metrics: ReflectionMetrics,
        clock: Clock,
        materials: ReflectionMaterials,
        transactions: PlatformTransactionManager,
    ) : this(trips, archive, poiSurfaces, reflections, cards, agent, events, metrics, clock, materials, TransactionTemplate(transactions))

    /**
     * 그 날의 회고를 만들거나 다시 만든다. 하루 한 장이라 행은 늘지 않는다.
     *
     * **다시 만들어도 갈리는 것은 초안뿐이다**(TRIP-553) — 사용자가 쓴 수정본과 최초 생성 시각은
     * 그대로다. 매번 새 행을 얹던 이전 구현은 재생성 한 번에 사용자의 문장을 지웠다.
     *
     * 발행은 같은 트랜잭션 안이다 — 회고는 저장됐는데 알림 이벤트만 사라지는 구간을 만들지 않는다.
     *
     * **트랜잭션은 쓰기에만 연다**(TRIP-1463). 초안 준비 — AI 호출(읽기 제한 21초)과 재료 조회(취향·변경 이력) — 는 그 밖이다. 안에서 하면
     * 생성 한 번이 AI 를 기다리는 내내 커넥션을 쥐고, 재료 조회가 실패하면 바깥 트랜잭션이 rollback-only 가 돼 회고 저장까지 무너진다.
     * 잠금(권고 잠금 + 행 잠금)은 종전대로 쓰기 트랜잭션 첫머리의 [ReflectionRepository.findForRedraft] 가 잡는다 — 겹친 생성의 순서·결과는 그대로다.
     */
    fun generateDaily(accountId: UUID, tripId: UUID, dayDate: LocalDate): Reflection {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        requireWithinTrip(period, dayDate)
        // 수정본을 못 읽는 하루(TRIP-1476)는 **AI 를 부르기 전에** 409 로 끝낸다 — 어차피 쓰지 못하고, 앱은 화면을 열 때마다
        // 이 요청을 보낸다. 초안·출처만 못 읽는 하루는 아래에서 초안을 다시 만들어 고치므로 그대로 간다.
        // 이 읽기와 아래 잠근 뒤 읽기(findForRedraft)가 둘 다 근거 수치를 읽으므로, 수치가 깨진 하루의 생성은 WARN 을 두 줄 남긴다(수정은 한 줄).
        try {
            reflections.find(tripId, dayDate)
        } catch (_: UnreadableDraft) {
            // 고칠 수 있는 하루다.
        }

        val draft = prepare(accountId, tripId, dayDate)
        return writes.execute {
            val saved = reflections.upsert(finish(tripId, dayDate, draft))
            events.publish(
                ReflectionReady(
                    aggregateId = saved.reflectionId.toString(),
                    tripId = tripId.toString(),
                    dayDate = dayDate.toString(),
                    kind = KIND_DAILY,
                    source = saved.source.name,
                ),
            )
            saved
        }!!
    }

    @Transactional(readOnly = true)
    fun find(accountId: UUID, tripId: UUID, dayDate: LocalDate): Reflection? {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return reflections.find(tripId, dayDate)
    }

    @Transactional(readOnly = true)
    fun listByTrip(accountId: UUID, tripId: UUID): List<Reflection> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return reflections.findByTrip(tripId)
    }

    /**
     * 사용자가 문장을 고친다. **초안은 남는다**(INV-U5-06) — 2열 비교의 왼쪽이 그것이다.
     *
     * 회고가 아직 없으면 **기본 카드를 만들어 그 위에 얹는다**(BR-U5-36 "생성이 실패한 경우에도
     * 직접 회고를 쓸 수 있다"). 404 로 막으면 화면은 "쓰려면 먼저 생성 버튼을 누르세요"가 되는데,
     * 생성이 실패해서 여기 온 사용자에게 그건 답이 아니다. 만들어지는 초안은 근거 수치만으로 된
     * 기본 카드라 **지어낸 문장이 아니다**(BR-U5-31).
     *
     * 초안이 필요한 하루(행이 없거나 초안·출처를 못 읽는다)면 그 초안을 **쓰기 트랜잭션 밖에서** 만든다 — 생성과 같은 이유다([generateDaily]).
     * 초안을 못 읽는 하루는 잠근 읽기로 그 사실을 안 뒤 트랜잭션을 닫고 초안을 만들어 다시 연다 — 드문 경로라 두 번 여는 값을 감수한다.
     */
    fun edit(
        accountId: UUID,
        tripId: UUID,
        dayDate: LocalDate,
        cardPayload: String?,
        mood: String? = null,
        shortMemo: String? = null,
    ): Reflection {
        // 셋 다 비면 바꿀 것이 없다 — 조용히 200 을 내면 "저장됐다"로 읽힌다.
        if (cardPayload == null && mood == null && shortMemo == null) {
            throw ValidationFailed(listOf(FieldError("card", "card·mood·shortMemo 중 하나는 보내야 합니다")))
        }
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        requireWithinTrip(period, dayDate)
        fun applied(current: Reflection): Reflection {
            val now = clock.instant()
            // 카드는 **보냈을 때만** 갈아끼운다(TRIP-828) — 기분만 고치는 요청이 카드를 건드리면 안 된다.
            val carded = cardPayload?.let { current.edit(cards.read(it), now) } ?: current
            return reflections.upsert(carded.note(mood, shortMemo, now))
        }
        // 행이 있고 초안을 읽을 수 있으면 잠근 채 고치고 끝이다. 수정본을 못 읽는 하루는 잠근 읽기가 409 로 끝낸다(행은 그대로다).
        if (reflections.exists(tripId, dayDate)) {
            writes.execute { lockedOrRedraft(tripId, dayDate)?.let(::applied) }?.let { return it }
            // 초안·출처를 못 읽는 하루 — 아래에서 초안을 다시 만들어 그 위에 얹는다(BR-U5-36).
        }
        // 초안은 **잠그기 전에**, 트랜잭션 밖에서 만든다 — 잠근 채 AI 를 기다리면 그 하루의 다른 쓰기가 전부 멈추고, 커넥션도 그동안 쥔다.
        // 그사이 행이 생겼으면 finish 가 그 행을 잠가 읽어 온다(초안만 갈아끼운다).
        val draft = prepare(accountId, tripId, dayDate)
        return writes.execute { applied(finish(tripId, dayDate, draft)) }!!
    }

    /**
     * 초안·출처를 못 읽는 하루(TRIP-1476)면 null 이다 — 부르는 쪽이 미리 만든 초안([prepare])을 [finish] 로 얹는다. 수정본·기분·메모는
     * 저장된 그대로 실린다(BR-U5-36: 생성이 망가진 하루에도 직접 쓸 수 있다).
     * 수정본을 못 읽는 하루는 여기서 409 로 끝난다(행은 그대로다).
     */
    private fun lockedOrRedraft(tripId: UUID, dayDate: LocalDate): Reflection? = try {
        reflections.findForUpdate(tripId, dayDate)
    } catch (_: UnreadableDraft) {
        null
    }

    /** 쓰기 트랜잭션 전에 만든 초안 — 그날 방문·표면과 고른 카드·출처. 저장된 행은 아직 읽지 않았다. */
    private class PreparedDraft(
        val visits: List<ArchiveVisitView>,
        val surfaces: Map<UUID, PoiSurfaceView>,
        val draft: ReflectionCard,
        val source: ReflectionSource,
    )

    /**
     * 그 날의 초안을 만든다 — **트랜잭션 밖에서** 부른다(AI 호출·재료 조회가 커넥션을 쥐지 않게). 저장된 행은 읽지 않는다.
     */
    private fun prepare(accountId: UUID, tripId: UUID, dayDate: LocalDate): PreparedDraft {
        val visits = archive.findDailyVisits(tripId).firstOrNull { it.date == dayDate }?.visits.orEmpty()
        val surfaces = poiSurfaces.findSurfaces(visits.map { it.poiId })
        val stats = statsOf(visits, surfaces, archive.findRouteDistances(tripId)[dayDate])
        // 근거 안에서만 쓴다(BR-U5-31) — 이름을 못 찾은 방문은 문장에 넣지 않는다.
        val placeNames = visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }
        // 폴백 3단(BR-U5-32): AI 카드 → 규칙 카드 → 기본 카드.
        // 포트는 못 만들면 null 을 준다(예외 아님) — 판단이 두 곳에 흩어지지 않게.
        val aiCard = aiCardOrNull(accountId, tripId, dayDate, visits, surfaces)
        val draft = aiCard ?: ReflectionNarrator.dailyCard(placeNames, stats)
        val source = if (aiCard != null) ReflectionSource.AI else ReflectionNarrator.sourceFor(stats)
        return PreparedDraft(visits, surfaces, draft, source)
    }

    /**
     * 준비한 초안을 그 날의 행에 얹는다 — **쓰기 트랜잭션 안에서** 부른다. 기존 행이 있으면 **초안만 갈아끼운다**(수정본·최초 생성 시각 보존).
     *
     * 발행은 여기서 하지 않는다. 수정 경로가 이 함수를 쓰기 때문이다 — 사용자가 글을 쓰는 순간에
     * `ReflectionReady` 가 나가면 "회고가 준비됐어요" 알림이 본인에게 간다.
     */
    private fun finish(tripId: UUID, dayDate: LocalDate, prepared: PreparedDraft): Reflection {
        val now = clock.instant()
        // AI 호출이 끝난 **뒤에** 잠그고 읽는다 — 먼저 읽어 두면 생성 중에 들어온 기분·수정본을 옛 값으로 덮는다.
        // 갈아끼울 초안·출처는 저장된 것을 읽지 않는다 — 그래서 그 둘을 못 읽는 하루도 여기서 낫는다(TRIP-1476).
        val current = reflections.findForRedraft(tripId, dayDate, prepared.draft, prepared.source)
        // 통계는 잠근 **뒤에** 다시 센다 — AI 를 기다리는 사이 경로가 올라오면, 앞에서 센 근사값이 경로 갱신(refreshRouteStats)을
        // 덮어쓴다. 잠근 뒤라면 그 갱신은 이 저장 뒤에 돌거나 이미 커밋돼 여기서 보인다.
        val fresh = statsOf(prepared.visits, prepared.surfaces, archive.findRouteDistances(tripId)[dayDate])
        return current?.regenerate(prepared.draft, prepared.source, fresh, now)
            ?: Reflection.of(tripId, dayDate, prepared.draft, prepared.source, fresh, now)
    }

    /**
     * AI 단 시도. **무엇이 잘못돼도 `null` 이다** — 여기서 예외가 새면 폴백(BR-U5-32)이 통째로 무력화된다.
     *
     * 왜 카드를 [ReflectionCardCodec] 에 다시 태우나: 포트가 준 [com.trippilot.reflection.domain.ReflectionCard] 는
     * 제목·원문이 비었는지만 검사받았고 **`payload` 가 유효 JSON 인지는 아무도 안 봤다.** 깨진 채로 두면
     * 저장 시점(`readValue`)에서 500 으로 터진다 — 원인에서 먼 자리이고, 그때는 규칙 카드로 내려갈 기회도 없다.
     * 사용자 수정본과 **같은 문을 지나게** 해서 그 구멍을 막는다.
     *
     * 꺼져 있으면 입력도 만들지 않는다 — region 조회가 항상 null 을 줄 호출을 위해 돈다.
     */
    private fun aiCardOrNull(
        accountId: UUID,
        tripId: UUID,
        dayDate: LocalDate,
        visits: List<ArchiveVisitView>,
        surfaces: Map<UUID, PoiSurfaceView>,
    ) = if (!agent.enabled) {
        null
    } else {
        runCatching {
            agentInput(accountId, tripId, dayDate, visits, surfaces)
                ?.let { agent.generate(it) }
                ?.let { cards.read(it.payload) }
                ?.takeIf { card -> notHallucinating(card.payload, tripId, dayDate, visits, surfaces) }
        }
            // 침묵하지 않는다(INV-4) — 규칙 카드로 내려간 사실과 사유가 남아야 원인이 보인다.
            .onFailure { log.warn("회고 AI 카드를 쓸 수 없어 규칙 카드로 갑니다. tripId={} date={}", tripId, dayDate, it) }
            .getOrNull()
    }

    /**
     * 안 간 곳을 말하는 카드는 쓰지 않는다(BR-U5-31). 걸리면 폴백 사다리(BR-U5-32)를 그대로 타
     * 규칙 카드로 내려간다 — 새 경로를 만들지 않는다.
     *
     * 금지 목록은 **건너뛴 방문지**다. 그것이 우리가 "안 갔다"고 확실히 아는 유일한 집합이고,
     * 입력 조립이 이미 같은 기준으로 거르고 있다(`filterNot { it.skipped }`) — 추가 조회가 없다.
     */
    private fun notHallucinating(
        payload: String,
        tripId: UUID,
        dayDate: LocalDate,
        visits: List<ArchiveVisitView>,
        surfaces: Map<UUID, PoiSurfaceView>,
    ): Boolean {
        val notVisited = visits.filter { it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }
        // 실제로 간 곳도 함께 넘긴다 — 금지 이름이 그쪽에 삼켜지면 오탐이라 게이트가 뺀다.
        val visited = visits.filterNot { it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }
        val offending = HallucinationGate.offendingPlaces(payload, notVisited, visited)
        if (offending.isEmpty()) return true
        // 조용히 내려가면 "AI 를 켰는데 왜 규칙 카드만 나오지"에 답할 수 없다(INV-4).
        // 이 수치가 AI 를 계속 켤지 판단하는 근거이기도 하다.
        log.warn(
            "회고 AI 카드가 안 간 장소를 말해 규칙 카드로 강등합니다. tripId={} date={} 장소={}",
            tripId, dayDate, offending,
        )
        metrics.hallucinationRejected()
        return false
    }

    /**
     * 경계 입력 조립 — **근거 안에서만**(BR-U5-31). 건너뛴 방문은 싣지 않는다: 안 간 곳이
     * 카드 장면이 되면 안 된다. 건너뛴 사실은 이름 없이 사건([ReflectionMaterials.eventsOn])으로만 간다.
     *
     * `region` 은 **그날의** 목적지다 — 다목적지 여행의 둘째 날이 첫 목적지로 나가던 것을 고쳤다(TRIP-1463).
     * 상대가 받지 않을 입력(목적지 없음·실을 방문 0곳 — [ReflectionAgentInput.callable])이면 **null** 이고 재료를 읽지 않는다 —
     * 부르지 않을 호출을 위해 취향·변경 이력을 조회하지 않는다. 지어내지도 않는다.
     * 성향·사건은 [ReflectionMaterials] 가 채운다. 날씨는 비운다 — 그 이유도 거기 있다.
     */
    private fun agentInput(
        accountId: UUID,
        tripId: UUID,
        dayDate: LocalDate,
        visits: List<ArchiveVisitView>,
        surfaces: Map<UUID, PoiSurfaceView>,
    ): ReflectionAgentInput? {
        val ctx = trips.findGenerationContext(accountId, tripId)
        val region = materials.regionOn(ctx, dayDate)
        val shown = visits.filterNot { it.skipped }.mapIndexedNotNull { index, v ->
            surfaces[v.poiId]?.let { poi ->
                ReflectionVisit(v.poiId, dayDate, poi.nameKo, poi.category, index + 1, v.photoCount)
            }
        }
        if (!ReflectionAgentInput.callable(region, shown)) {
            log.debug("목적지나 실을 방문이 없어 회고 AI 를 부르지 않습니다 — 규칙 카드로 갑니다. tripId={} date={}", tripId, dayDate)
            return null
        }
        return ReflectionAgentInput(
            kind = "DAILY",
            region = region,
            startDate = dayDate,
            endDate = dayDate,
            visits = shown,
            personaSummary = materials.personaOf(accountId, ctx),
            weatherSummary = null,
            events = materials.eventsOn(accountId, tripId, dayDate, skippedCount = visits.count { it.skipped }),
        )
    }

    /**
     * 여행 기간 밖 날짜는 거부한다.
     *
     * 근거 데이터가 그 날에 없다는 것이 이유의 전부다 — 만들면 방문 0곳짜리 기본 카드가 여행과
     * 무관한 날짜에 생기고, 목록·캘린더가 그것을 여행의 하루로 그린다.
     */
    private fun requireWithinTrip(period: TripPeriod, dayDate: LocalDate) {
        if (dayDate.isBefore(period.startDate) || dayDate.isAfter(period.endDate)) {
            throw ValidationFailed(listOf(FieldError("dayDate", "여행 기간 안의 날짜여야 합니다")))
        }
    }

    /**
     * 그날 실제 경로가 올라왔다(U10 `ActualRouteStored`) — **통계만** 다시 센다(BR-U10-39). 본문(카드)은 다시 만들지 않는다:
     * 이미 읽은 글이 바뀌고, AI 를 또 부르게 된다. 회고가 아직 없으면 할 일이 없다 — 나중에 만들 때 경로를 읽는다.
     */
    @Transactional
    fun refreshRouteStats(tripId: UUID, dayDate: LocalDate) {
        // 그 하루를 못 읽으면(TRIP-1476) 건너뛴다 — 행 위에 쓰지 않으므로 수정본이 남고, 던지지 않으므로 같은 이벤트의
        // 요약 갱신이 마저 돈다(던지면 릴레이가 재시도하다 포기해 요약까지 근사값에 남는다). 못 읽은 사유는 저장소가 남겼다(INV-4).
        // 초안만 깨진 하루도 여기서 고치지 않는다 — 고치려면 초안을 다시 만들어야 하고(AI 호출), 그것은 생성·수정의 몫이다.
        val current = try {
            reflections.findForUpdate(tripId, dayDate)
        } catch (e: RuntimeException) {
            if (e !is UnreadableDraft && e !is ConflictDetected) throw e
            log.warn("회고를 읽을 수 없어 이 하루의 경로 통계 갱신은 건너뜁니다. tripId={} date={}", tripId, dayDate)
            null
        } ?: return
        val visits = archive.findDailyVisits(tripId).firstOrNull { it.date == dayDate }?.visits.orEmpty()
        val stats = statsOf(visits, poiSurfaces.findSurfaces(visits.map { it.poiId }), archive.findRouteDistances(tripId)[dayDate])
        reflections.upsert(current.copy(stats = stats))
    }

    /**
     * 근거 수치. **비어 있을 수 없다**(INV-U5-07) — 방문이 0곳이면 0으로 채운다.
     *
     * 거리는 그날 **실제 경로**가 있으면 그 거리(클램프 후, [DistanceSource.ROUTE])이고, 없으면 **방문점 연결선 근사**다
     * ([DistanceSource.VISIT_LINE], BR-U5-43 · U10 FD §7.2). 출처를 함께 실어 받는 쪽이 근사값을 실측으로 읽지 않게 한다.
     */
    private fun statsOf(visits: List<ArchiveVisitView>, surfaces: Map<UUID, PoiSurfaceView>, routeM: Int?): ReflectionStats {
        if (visits.isEmpty() && routeM == null) return ReflectionStats.empty()
        val points = visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId] }
        val km = points.zipWithNext { a, b -> haversineKm(a.lat, a.lng, b.lat, b.lng) }.sum()
        return ReflectionStats(
            visitCount = visits.count { !it.skipped },
            distanceKm = routeM?.let { it / 1000.0 } ?: km,
            distanceSource = if (routeM != null) DistanceSource.ROUTE else DistanceSource.VISIT_LINE,
            photoCount = visits.sumOf { it.photoCount },
        )
    }

    /** 두 점 사이 대권 거리(km). 도로 거리가 아니다 — 그래서 [DistanceSource.VISIT_LINE] 이다. */
    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(a)))
    }

    companion object {
        private val log = LoggerFactory.getLogger(ReflectionService::class.java)

        const val KIND_DAILY = "DAILY"

        private const val EARTH_RADIUS_KM = 6371.0
    }
}
