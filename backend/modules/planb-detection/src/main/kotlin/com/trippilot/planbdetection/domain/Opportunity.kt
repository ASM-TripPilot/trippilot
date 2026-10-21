package com.trippilot.planbdetection.domain

import java.time.LocalDate
import java.util.UUID

/** 기회 종류(BR-SA-22) — 닫힌 집합. 앱이 이 값으로 고정 템플릿을 고른다(문장은 앱 한 곳에서만 만든다). */
enum class OpportunityKind {
    /** 기간이 겹치는 행사의 행사장 — 행사 좌표 1km 안 + 행사 주소·이름에 그 장소 이름. */
    EVENT_VENUE,

    /** 행사장 가까이 — 행사 좌표 0.3km 안 + 카테고리 적합. */
    EVENT_NEARBY,

    /** 태그 '요즘 인기'. */
    TRENDING,
}

/**
 * 행사 유형 — 상대(AI `EventType`) 값 가운데 카드에 오르는 것(유형 불명 `OTHER` 는 상대가 카드로 만들지 않는다).
 * 날씨 위험 날 무엇을 뺄지 가른다([OpportunityWeather]) — 앱 문장은 이 값으로 바뀌지 않는다.
 */
enum class OpportunityEventType {
    /** 축제 — 야외일 수 있어 날씨 위험 날 뺀다. */
    FESTIVAL,
    PERFORMANCE,
    EXHIBITION,
    POPUP,
    ;

    companion object {
        /** 와이어 문자열 → 유형. 없거나 모르는 값(옛 AI·새 값)은 null — 지어내지 않는다(모름은 날씨 위험 날 축제처럼 빠진다). */
        fun of(raw: String?): OpportunityEventType? = entries.firstOrNull { it.name == raw }
    }
}

/**
 * 기회 한 건 — 그 날 남은 동선 근처의 행사·'요즘 인기' 등록 장소(BR-SA-22 · DEC-SA-6). **값 객체 · 저장 없음.**
 *
 * 트리거도 알림도 아니다(DEC-U4-4 · LEGAL-SA-01) — 상태·스케줄러·마이그레이션이 없고 알림 경로를 타지 않는다.
 * 장소는 언제나 **등록 POI** 다(INV-1 — 행사는 후보가 아니다). 시각 필드가 없고(INV-2 — 행사 원천이 일 단위다),
 * 거리는 표시 문자열뿐이다(INV-3). 문장은 앱의 고정 템플릿이 만든다 — 여기는 재료만 싣는다.
 *
 * @property key 결정론 순위·기기 숨김의 키(`event:{행사}` · `trending:{장소}`).
 * @property eventName 행사 카드만 — [start]·[end] 와 함께 행사 이름·기간(일 단위).
 * @property nearSlotKey 가장 가까운 남은 슬롯(`{date}#{poiId}`).
 * @property distanceLabel 동선에서의 거리 표시(예: `약 400m`) — 소요시간은 어떤 이유로도 없다.
 * @property eventType 행사 카드만 — 행사 유형. null = 요즘 인기이거나 모름(옛 AI·모르는 값).
 */
data class Opportunity(
    val key: String,
    val kind: OpportunityKind,
    val eventName: String?,
    val start: LocalDate?,
    val end: LocalDate?,
    val poiId: UUID,
    val poiName: String,
    val nearSlotKey: String,
    val distanceLabel: String,
    val eventType: OpportunityEventType? = null,
)

/**
 * AI 에 묻는 재료 — **서버가 일정에서 채운다**(앱은 날짜만 보낸다).
 *
 * @property slots 그 날 남은 슬롯(방문 순서) — 좌표는 계획된 장소의 좌표다(사용자 위치가 아니다).
 * @property plannedPoiIds 이미 일정에 있는 장소(일정 전체) — 카드에서 빠진다.
 */
data class OpportunityQuery(
    val date: LocalDate,
    val slots: List<OpportunitySlot>,
    val plannedPoiIds: List<UUID>,
)

data class OpportunitySlot(val slotKey: String, val poiId: UUID, val lat: Double, val lng: Double)

/** AI 답. [notes] 는 재료 실패 사유(행사 미배선·장소 조회 실패·시한) — 관측용이고 화면에 가지 않는다. */
data class OpportunityReply(val items: List<Opportunity>, val notes: List<String>)

/**
 * 기회 조회 경계 — BE → AI `POST /ai/v1/planb/opportunities`(LLM 0회).
 *
 * 무응답·시한 초과·계약 위반은 **예외로** 말한다. 접어서 빈 목록으로 내리는 것은 서비스 몫이다(RES-SA-09) —
 * 어댑터가 빈 답으로 삼키면 "AI 가 없다고 했다"와 "AI 에 닿지 못했다"가 로그에서 갈리지 않는다.
 */
fun interface OpportunityPort {
    fun find(query: OpportunityQuery): OpportunityReply
}

/**
 * 2차 게이트(BR-SA-22 — 상대 판정이 1차, 여기가 2차) — AI 답이 **이 질의에 대한 답으로** 성립하는가.
 *
 * 서버만 아는 것(보낸 슬롯 · 일정에 있는 장소)과 앱 계약의 모양(≤ 3 · 유일 · 행사 카드의 이름·기간)을 본다.
 * 표시 게이트(이름 길이·연락처 꼴)는 상대 판정 한 곳에 둔다 — 같은 문구 규칙을 두 곳에 두면 갈라진다.
 *
 * @return 어긋난 사유 하나(null = 통과). 하나라도 어긋나면 서비스가 **답 전체를 버린다**(RES-SA-09 — 계약 위반은
 *   빈 목록): 일부만 골라 그리면 순위·'날짜당 1장'이 상대가 정한 것과 달라진다.
 */
object OpportunityGate {
    /** 계약 `opportunities.maxItems` — 계약 게이트가 상대 계약과 같은지 잰다. */
    const val MAX_ITEMS = 3

    fun violation(query: OpportunityQuery, items: List<Opportunity>): String? {
        if (items.size > MAX_ITEMS) return "기회 ${items.size}건 — 상한 $MAX_ITEMS 초과"
        if (items.distinctBy { it.key }.size != items.size) return "같은 key 가 두 장"
        if (items.distinctBy { it.poiId }.size != items.size) return "같은 장소가 두 장"
        val sent = query.slots.mapTo(HashSet()) { it.slotKey }
        val planned = query.plannedPoiIds.toHashSet() + query.slots.map { it.poiId }
        for (o in items) {
            if (o.key.isBlank() || o.poiName.isBlank() || o.distanceLabel.isBlank()) return "빈 필드 — key='${o.key}'"
            if (o.nearSlotKey !in sent) return "보내지 않은 슬롯 — ${o.nearSlotKey}"
            if (o.poiId in planned) return "이미 일정에 있는 장소 — ${o.poiId}"
            if (o.kind == OpportunityKind.TRENDING) continue
            val (start, end) = o.start to o.end
            if (o.eventName.isNullOrBlank() || start == null || end == null) return "행사 이름·기간 없음 — key='${o.key}'"
            // 기간이 그 날을 덮어야 한다 — 뒤집힌 기간도 여기서 걸린다(빈 범위).
            if (query.date !in start..end) return "그 날 열리지 않는 행사 — key='${o.key}' $start~$end"
        }
        return null
    }
}

/**
 * 날씨 위험 날의 행사 거르기(BR-SA-22 ④ · G-SA-17 — 2026-10-20 결정 '야외 축제만 뺀다, 실내형 행사는 남긴다').
 *
 * 그 날짜에 날씨 위험(WEATHER ∧ RISK)이 떠 있거나(ACTIVE) [적용]으로 소비됐으면(CONSUMED) 축제와 **유형을 모르는** 행사를
 * 뺀다 — 비 오는데 야외 축제를 권하지 않고, 모르는 것을 실내라고 단정하지 않는다(INV-SA-2). 공연·전시·팝업과 요즘 인기는
 * 남는다. 소비된 것까지 보는 이유: 발화 중인 것만 보던 앱은 [적용] 직후부터 다음 판정 전까지 축제 카드를 되살렸다(적용이
 * 트리거를 닫아도 비는 대개 그대로다). 대가로 반영한 날은 비가 그쳤는지 다시 보지 않는다 — 위험이 풀려 만료(EXPIRED)된 뒤에
 * [적용]해도 소비로 바뀌어(BR-SA-14) 그 날 축제는 비가 그쳐도 빠진다. 해제·만료(EXPIRED)·끈 알림(SUPPRESSED)·주의(CAUTION)는
 * 보지 않는다.
 */
object OpportunityWeather {
    private val BLOCKING_STATES = setOf(TriggerState.ACTIVE, TriggerState.CONSUMED)

    /** 그 날짜에 행사를 거를 날씨 위험이 있는가. [triggers] 는 그 여행의 셀 행이다(상태 무관 — 회수는 호출자가 거른다). */
    fun blocksOutdoor(triggers: List<PlanBTrigger>, date: LocalDate): Boolean = triggers.any {
        it.kind == TriggerKind.WEATHER && it.severity == TriggerSeverity.RISK && it.affectedDate == date && it.state in BLOCKING_STATES
    }

    /** 날씨 위험 날에도 남는가 — 요즘 인기, 그리고 유형을 아는 축제 아닌 행사. */
    fun keeps(o: Opportunity): Boolean =
        o.kind == OpportunityKind.TRENDING || (o.eventType != null && o.eventType != OpportunityEventType.FESTIVAL)
}
