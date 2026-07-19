package com.trippilot.profile.application

/**
 * 부분 수정 tri-state(PUT /me/preferences) — 축별 3상태 구분.
 * 생략(Keep)=미변경 · null 전송(SetTo(null))=미설정으로 초기화 · 값(SetTo(v))=설정.
 */
sealed interface Patch<out T> {
    data object Keep : Patch<Nothing>
    data class SetTo<out T>(val value: T?) : Patch<T>
}

/** 현재값에 패치 적용 — Keep 은 현재 유지, SetTo 는 제시값(null 포함). */
fun <T> Patch<T>.resolve(current: T?): T? = when (this) {
    is Patch.Keep -> current
    is Patch.SetTo -> value
}

/** 7축 부분 수정 명령. */
data class PreferencePatch(
    val styles: Patch<List<String>> = Patch.Keep,
    val budgetTier: Patch<String> = Patch.Keep,
    val budgetRawAmount: Patch<Long> = Patch.Keep,
    val companionTypes: Patch<List<String>> = Patch.Keep,
    val petFlag: Patch<Boolean> = Patch.Keep,
    val activities: Patch<List<String>> = Patch.Keep,
    val transportModes: Patch<List<String>> = Patch.Keep,
    val foodTastes: Patch<List<String>> = Patch.Keep,
    val pace: Patch<String> = Patch.Keep,
)
