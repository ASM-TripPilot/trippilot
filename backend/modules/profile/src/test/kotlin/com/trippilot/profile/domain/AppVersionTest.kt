package com.trippilot.profile.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/** 앱 버전 게이트 — 최소 미만=FORCED, 권장 미만=RECOMMENDED, 판단불가=NONE. */
class AppVersionTest : StringSpec({

    "최소 미만은 FORCED" {
        AppVersion.status("0.9.0", minSupported = "1.0.0", recommended = "1.5.0") shouldBe AppUpdateStatus.FORCED
    }

    "최소 이상·권장 미만은 RECOMMENDED" {
        AppVersion.status("1.2.0", minSupported = "1.0.0", recommended = "1.5.0") shouldBe AppUpdateStatus.RECOMMENDED
    }

    "권장 이상은 NONE" {
        AppVersion.status("1.5.0", minSupported = "1.0.0", recommended = "1.5.0") shouldBe AppUpdateStatus.NONE
        AppVersion.status("2.0.0", minSupported = "1.0.0", recommended = "1.5.0") shouldBe AppUpdateStatus.NONE
    }

    "숫자 비교(사전식 아님) — 1.10.0 > 1.9.0" {
        AppVersion.status("1.10.0", minSupported = "1.9.0", recommended = "1.9.0") shouldBe AppUpdateStatus.NONE
        AppVersion.status("1.9.0", minSupported = "1.10.0", recommended = "1.10.0") shouldBe AppUpdateStatus.FORCED
    }

    "버전 미제공·파싱불가는 NONE(차단하지 않음)" {
        AppVersion.status(null, "1.0.0", "1.5.0") shouldBe AppUpdateStatus.NONE
        AppVersion.status("abc", "1.0.0", "1.5.0") shouldBe AppUpdateStatus.NONE
        AppVersion.status("", "1.0.0", "1.5.0") shouldBe AppUpdateStatus.NONE
    }

    "누락 컴포넌트는 0 취급 — 1 == 1.0.0" {
        AppVersion.status("1", minSupported = "1.0.0", recommended = "1.0.0") shouldBe AppUpdateStatus.NONE
    }
})
