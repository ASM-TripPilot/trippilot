package com.trippilot.profile.domain

import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldNotThrowAny
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/** 취향 7축 — 중립 기본값 파생(INV-PR2/PR5) + 허용값·예산쌍 검증(INV-PR3). */
class PreferenceSetTest : StringSpec({

    val account = UUID.randomUUID()
    val now = Instant.parse("2026-07-19T00:00:00Z")

    fun empty() = PreferenceSet.empty(account, now)

    "미설정 계정 view — 이동=대중교통, 그 외 배열=[], 스칼라=null (전부 isNeutralDefault)" {
        val v = empty().view()
        v.transportModes shouldBe ArrayAxisView(listOf("대중교통"), isNeutralDefault = true)
        v.styles shouldBe ArrayAxisView(emptyList(), isNeutralDefault = true)
        v.activities shouldBe ArrayAxisView(emptyList(), isNeutralDefault = true)
        v.pace shouldBe ScalarAxisView(null, isNeutralDefault = true)
        v.budget shouldBe BudgetView(null, null, isNeutralDefault = true)
        v.companion shouldBe CompanionView(emptyList(), petFlag = false, isNeutralDefault = true)
    }

    "설정된 축은 isNeutralDefault=false 로 그 값을 반환" {
        val p = PreferenceSet.of(
            account, styles = listOf("휴양", "미식"), budgetTier = "고급", budgetRawAmount = 3_000_000,
            companionTypes = listOf("혼자"), petFlag = true, activities = null,
            transportModes = listOf("도보"), foodTastes = null, pace = "알차게", now = now,
        )
        val v = p.view()
        v.styles shouldBe ArrayAxisView(listOf("휴양", "미식"), isNeutralDefault = false)
        v.transportModes shouldBe ArrayAxisView(listOf("도보"), isNeutralDefault = false)
        v.pace shouldBe ScalarAxisView("알차게", isNeutralDefault = false)
        v.budget shouldBe BudgetView("고급", 3_000_000, isNeutralDefault = false)
        v.companion shouldBe CompanionView(listOf("혼자"), petFlag = true, isNeutralDefault = false)
        // 미설정 축은 여전히 중립
        v.activities.isNeutralDefault shouldBe true
    }

    "INV-PR3 — 금액만 있고 등급 없으면 ValidationFailed" {
        shouldThrow<ValidationFailed> {
            PreferenceSet.of(account, null, budgetTier = null, budgetRawAmount = 100_000, null, false, null, null, null, null, now)
        }
    }

    "INV-PR3 — 등급만(금액 없음)은 허용" {
        shouldNotThrowAny {
            PreferenceSet.of(account, null, budgetTier = "중간", budgetRawAmount = null, null, false, null, null, null, null, now)
        }
    }

    "금액은 0 이하 불가" {
        shouldThrow<ValidationFailed> {
            PreferenceSet.of(account, null, "저가", budgetRawAmount = 0, null, false, null, null, null, null, now)
        }
    }

    "허용되지 않은 축 값은 ValidationFailed" {
        shouldThrow<ValidationFailed> {
            PreferenceSet.of(account, styles = listOf("우주여행"), null, null, null, false, null, null, null, null, now)
        }
    }

    "PBT — 허용 스타일의 임의 부분집합은 항상 저장되고 그대로 조회된다" {
        // **`Arb.set` 으로 뽑지 않는다.** 모집단이 7개인데 크기 상한도 7 이면 "전부 모으기"를 요구하는
        // 꼴이라 쿠폰 수집 문제가 된다 — kotest 는 새 원소 없이 70회 연속 뽑으면 포기하고
        // `target size requirement of 7 could not be satisfied` 로 **테스트를 실패시킨다**(실측
        // 2026-09-15 전체 빌드 1회). 확률이 낮아 재실행하면 사라지는, 가장 진단하기 나쁜 형태다.
        // 축마다 포함 여부를 뽑으면 같은 부분집합 공간을 **고갈 없이·균등하게** 덮는다.
        val subsets = Arb.list(Arb.boolean(), PreferenceSet.STYLES.size..PreferenceSet.STYLES.size)
        checkAll(subsets) { mask ->
            val list = PreferenceSet.STYLES.toList().filterIndexed { i, _ -> mask[i] }
            val v = PreferenceSet.of(account, list, null, null, null, false, null, null, null, null, now).view()
            if (list.isEmpty()) {
                // 빈 리스트도 '설정함'(비NULL) — 중립 아님
                v.styles shouldBe ArrayAxisView(emptyList(), isNeutralDefault = false)
            } else {
                v.styles shouldBe ArrayAxisView(list, isNeutralDefault = false)
            }
        }
    }
})
