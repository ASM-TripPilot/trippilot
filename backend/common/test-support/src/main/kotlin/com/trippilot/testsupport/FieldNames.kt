package com.trippilot.testsupport

/**
 * 클래스가 선언한 필드 이름 — **합성 필드는 뺀다.** INV-3("duration 필드 없음") 같은 이름 검사용.
 *
 * `declaredFields` 를 그대로 쓰면 JaCoCo 에이전트가 넣는 `$jacocoData` 까지 걸린다. 지금 금지어와는 안 겹쳐
 * 통과하지만, 겹치는 순간 **에이전트가 붙는 Gradle 실행**(CI·로컬 `./gradlew test` 모두 — 루트 빌드가 모든 모듈에 jacoco 를
 * 건다)에서만 깨지고, 에이전트 없는 실행(IDE 자체 러너 등)에서는 통과한다.
 */
fun Class<*>.declaredFieldNames(): List<String> = declaredFields.filterNot { it.isSynthetic }.map { it.name }
