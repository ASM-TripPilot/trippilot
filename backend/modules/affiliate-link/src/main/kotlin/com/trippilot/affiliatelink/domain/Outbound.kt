package com.trippilot.affiliatelink.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 이동 대상 숙소 — 경계 키(합성 stayId)와 표시 이름. 내부 도메인이 아니라 계약값만 담는다. */
data class OutboundStay(val stayId: String, val name: String)

/**
 * 아웃바운드 요청 파라미터. OTA 실가격은 체크인·체크아웃이 있어야 나오므로 지금부터 받아
 * 클릭에 남긴다 — 계약 전에도 "언제 묵으려는 클릭인가"가 협상 근거 데이터가 된다.
 */
data class OutboundQuery(
    val checkIn: LocalDate? = null,
    val checkOut: LocalDate? = null,
    val adults: Int? = null,
)

/** 이동 목적지. [vendor] 는 클릭 행에 남아 "어느 공급자로 보냈나"를 말한다. */
data class OutboundLink(val url: String, val vendor: String)

/**
 * OTA 딥링크 생성 포트(C5). 1차 구현은 웹검색 폴백뿐이다.
 * 실 벤더 어댑터(칸 3)는 [clickId] 를 sub_id 자리에 관통시켜 전환 포스트백과 잇는다 —
 * 그래서 시그니처에 처음부터 있다(폴백은 쓰지 않는다).
 */
interface OtaDeeplinkPort {
    fun buildOutbound(stay: OutboundStay, query: OutboundQuery, clickId: UUID): OutboundLink
}

/**
 * 클릭 한 건 — 내부 지표 전용(BR-U1-32). 사용자 대면 응답 어디에도 싣지 않는다.
 *
 * [accountId] 가 null 이면 **익명 클릭**이다 — 이 엔드포인트는 브라우저·커스텀탭이 열어
 * Authorization 을 실을 수 없다(domain-entities C5 의 accountId 필수에서 이탈, 사유는 V2.59 주석).
 */
data class OutboundClick(
    val clickId: UUID,
    val accountId: UUID?,
    val stayId: String,
    val vendor: String,
    val query: OutboundQuery,
    val clickedAt: Instant,
)

interface OutboundClickPort {
    fun record(click: OutboundClick)
}
