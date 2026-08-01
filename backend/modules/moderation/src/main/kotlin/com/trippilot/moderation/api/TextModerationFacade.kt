package com.trippilot.moderation.api

/**
 * 텍스트 검증 퍼사드(C3) — 타 모듈이 의존하는 **유일한 공개 계약**(R1: `..api..` 만 노출).
 * 닉네임(profile)·후속 UGC 가 재사용한다. 동기 호출(저장 전 차단, fail-fast).
 */
interface TextModerationFacade {
    /**
     * 활성 금칙어 사전으로 검사한다. **매칭된 원문은 반환하지 않는다**(INV-B3 — 역추적 방지).
     * 활성 사전이 없으면 예외(fail-closed, INV-B2) — 자동 통과시키지 않는다.
     */
    fun inspect(text: String): ModerationVerdict
}

/** 검증 결과 — 통과 여부 + 위반 범주(원문 미포함). */
data class ModerationVerdict(
    val clean: Boolean,
    val category: String?,
)
