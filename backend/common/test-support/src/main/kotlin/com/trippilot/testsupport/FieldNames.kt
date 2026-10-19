package com.trippilot.testsupport

/**
 * 클래스가 선언한 필드 이름 — **합성 필드는 뺀다.** INV-3("duration 필드 없음") 같은 이름 검사용.
 *
 * `declaredFields` 를 그대로 쓰면 JaCoCo 에이전트가 넣는 `$jacocoData` 까지 걸린다. 지금 금지어와는 안 겹쳐
 * 통과하지만, 겹치는 순간 **에이전트가 켜진 CI 에서만** 깨지고 IDE 실행에서는 통과한다.
 */
fun Class<*>.declaredFieldNames(): List<String> = declaredFields.filterNot { it.isSynthetic }.map { it.name }
