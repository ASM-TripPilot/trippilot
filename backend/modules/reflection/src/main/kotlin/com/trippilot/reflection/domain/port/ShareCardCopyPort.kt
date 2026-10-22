package com.trippilot.reflection.domain.port

import java.time.LocalDate
import java.util.UUID

/**
 * j06 공유 카드 아래 붙는 두 자리 — 캡션 한 문단과 해시태그(US-REC-13 · TRIP-1411).
 *
 * 카드 이미지는 여기 없다 — 기기가 그린다(BR-U5-46). 서버가 주는 것은 문구뿐이다.
 *
 * @property caption AI 문구면 1~150자(UTF-16 코드 유닛). 규칙 조립([isFallback])이면 **빈 문자열**이다 — 앱이 문장 시드를 걷어냈고(TRIP-766)
 *   캡션은 사용자가 쓴다.
 * @property hashtags `#` 로 시작, 최대 10개. 목적지를 모르는 규칙 조립이면 비어 있을 수 있다.
 * @property isFallback AI 문구가 아니라 규칙 조립이다.
 */
data class ShareCardCopy(val caption: String, val hashtags: List<String>, val isFallback: Boolean)

/**
 * 공유 카드 문구 경계(`POST /ai/v1/reflection/share-card`).
 *
 * [ReflectionAgentPort] 와 같은 규칙이다 — **못 만들면 `null`**, 예외를 던지지 않는다. 사유는 구현이 로그로 남긴다(INV-4).
 * 요청은 회고 생성과 같은 재료([ReflectionAgentInput])다 — 상대가 같은 스키마(`ReflectionGenerateRequest`)를 받는다.
 */
interface ShareCardCopyPort {
    /** 켜져 있지 않으면 입력 조립(방문·장소·취향 조회)을 아예 하지 않는다 — [ReflectionAgentPort.enabled] 와 같은 이유. */
    val enabled: Boolean

    fun copy(input: ReflectionAgentInput): ShareCardCopy?
}

/**
 * 공유 문구 AI 호출의 계정당 하루 횟수(TRIP-1411). 부를 때마다 LLM 1회이고 저장할 결과가 없어 따로 센다.
 */
interface ShareCardUsageRepository {
    /**
     * 그날 한 번을 **집는다** — [limit] 에 아직 안 닿았으면 1 을 더하고 true, 닿았으면 아무것도 바꾸지 않고 false.
     * 세기와 더하기가 한 문장이라 동시 요청 둘이 같은 수를 보고 함께 통과하지 못한다.
     */
    fun claim(accountId: UUID, day: LocalDate, limit: Int): Boolean
}
