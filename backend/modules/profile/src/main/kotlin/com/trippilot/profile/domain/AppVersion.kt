package com.trippilot.profile.domain

/** 앱 업데이트 게이트 상태(부트스트랩 우선순위 1위, FD-U1-10). */
enum class AppUpdateStatus { NONE, RECOMMENDED, FORCED }

/**
 * 클라이언트 버전 vs 서버 기준 비교(순수). 최소 미만=FORCED, 권장 미만=RECOMMENDED, 그 외=NONE.
 * 버전 미제공·파싱 불가 시 NONE(차단하지 않음 — 판단 불가로 사용자를 막지 않는다).
 */
object AppVersion {
    fun status(clientVersion: String?, minSupported: String, recommended: String): AppUpdateStatus {
        val client = parse(clientVersion) ?: return AppUpdateStatus.NONE
        return when {
            compare(client, parse(minSupported) ?: return AppUpdateStatus.NONE) < 0 -> AppUpdateStatus.FORCED
            compare(client, parse(recommended) ?: return AppUpdateStatus.NONE) < 0 -> AppUpdateStatus.RECOMMENDED
            else -> AppUpdateStatus.NONE
        }
    }

    /** "x.y.z" → [x,y,z]. 누락 컴포넌트는 0, 숫자 아니면 null. */
    private fun parse(version: String?): List<Int>? {
        if (version.isNullOrBlank()) return null
        val parts = version.trim().split(".")
        return parts.map { it.toIntOrNull() ?: return null }
    }

    private fun compare(a: List<Int>, b: List<Int>): Int {
        val size = maxOf(a.size, b.size)
        for (i in 0 until size) {
            val diff = (a.getOrElse(i) { 0 }) - (b.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return 0
    }
}
