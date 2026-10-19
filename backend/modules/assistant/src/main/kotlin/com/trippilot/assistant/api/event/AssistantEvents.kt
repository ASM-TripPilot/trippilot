package com.trippilot.assistant.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 대화를 지웠으니 상대(AI) 세션 메모리도 지워 달라(DE §4.1 · BR-AO-10). 이력 지우기가 대화 삭제와 **같은 트랜잭션**에서
 * 아웃박스에 남기고, 구독자가 상대를 부른다 — 실패하면 릴레이가 재시도한다(미결 #13: 동기 최선 노력이던 때는 상대가
 * 잠깐 불통이면 "지웠는데 기억한다"가 상대 TTL 90일 남았다). [aggregateId] 는 세션 id 다.
 */
data class DialogueForgetRequested(override val aggregateId: String) : DomainEvent {
    override val eventType: String = "assistant.DialogueForgetRequested"
    override val aggregateType: String = "AssistantSession"
}
