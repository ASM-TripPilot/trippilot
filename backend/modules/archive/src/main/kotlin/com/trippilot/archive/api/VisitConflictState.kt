package com.trippilot.archive.api

import java.time.Instant
import java.util.UUID

/**
 * 충돌 응답이 실어 내는 서버 쪽 상태(BR-U5-21·22).
 *
 * [updatedAt] 이 충돌 판정의 기준이다 — 로컬 편집 시각이 이보다 이르면 그 편집은 서버가 이미 지나간
 * 상태 위에서 만들어진 것이다. 메모를 별도 테이블로 뺀 것도 이 값을 지키기 위해서다(TRIP-542):
 * 메모 편집이 실적 행을 건드리면 없던 충돌이 생긴다.
 *
 * 2열 비교에 필요한 나머지(시각·상태·메모·사진 수)는 여기 싣지 않는다 — 오류 봉투를 자료 전달 통로로
 * 쓰면 계약이 흐려진다. 클라이언트는 이 id 로 3종 비교 표면(TRIP-544)에서 서버 버전을 읽는다.
 */
data class VisitConflictState(val visitCheckId: UUID, val updatedAt: Instant)
