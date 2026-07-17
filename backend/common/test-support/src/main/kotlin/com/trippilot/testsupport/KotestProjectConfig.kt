package com.trippilot.testsupport

import io.kotest.core.config.AbstractProjectConfig
import io.kotest.property.PropertyTesting

/**
 * Kotest 전역 설정 — 속성 기반 테스트(PBT) 기본값(PBT-08).
 * kotest-property 는 실패 시 시드를 로그로 출력하고 shrinking 을 기본 수행하므로 재현 가능하다.
 * 여기선 전 유닛 공통 반복 수만 고정한다(유닛별 override 가능).
 */
object KotestProjectConfig : AbstractProjectConfig() {
    override suspend fun beforeProject() {
        PropertyTesting.defaultIterationCount = 200
    }
}
