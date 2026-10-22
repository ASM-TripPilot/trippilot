package com.trippilot.reflection.domain.port

/**
 * j06 공유 카드 아래 붙는 두 자리 — 캡션 한 문단과 해시태그(US-REC-13 · TRIP-1411).
 *
 * 카드 이미지는 여기 없다 — 기기가 그린다(BR-U5-46). 서버가 주는 것은 문구뿐이다.
 *
 * @property isFallback AI 문구가 아니라 규칙 조립이다. 화면은 그대로 쓰면 된다(빈 값이 아니다).
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
