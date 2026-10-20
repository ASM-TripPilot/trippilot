import { isAxiosError } from 'axios';

import { parseSlotKey } from '@/entities/itinerary-slot';
import { buildStartReplanRequest } from '@/features/request-replan';
import type {
  ReplanDiffSlot,
  ReplanSession,
  StartReplanRequest,
} from '@/shared/api/index.schemas';

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i06 최소 변경의 판정(순수, 페이지는 배선만).
 *
 *  - 낡은 미리 준비한 대안: apply 409 + 오류 코드 `EXPIRED`·`STALE`(BR-SA-19 · INV-SA-7). 409 를 일반 실패로 접지 않는다 —
 *    코드로 가른다(코드 없는 409·5xx·네트워크는 기존 "변경을 반영하지 못했어요").
 *  - [새 대안 보기]: 같은 입력(사유·지시·제외·범위·날짜·트리거)으로 새 세션 봉투. 시각을 다시 추정하지 않고 서버가 다시 짠다.
 *    i06 실패 얼굴·i05 8분 상한 얼굴의 [다시 시도]도 같은 봉투다(사용자 결정 2026-10-20 — 알림과 끊긴 빈 요청 화면 대신).
 *  - [조건 바꿔 다시 짜기](대안 없음): 같은 입력을 시드로, 같은 트리거에 이어 요청 화면(i04)을 여는 라우트 쿼리.
 *  - 미포함 안내: 넣으려던 POI(`includePoiId`)가 초안 `after` 에 없으면 `‘{장소}’은 이번 안에 넣지 못했어요.`(INV-4).
 */

const STALE_CODES = new Set(['EXPIRED', 'STALE']);

export function isStaleApplyError(error: unknown): boolean {
  if (!isAxiosError(error) || error.response?.status !== 409) return false;
  const data = error.response.data as
    { error?: { code?: unknown } } | null | undefined;
  const code = data?.error?.code;
  return typeof code === 'string' && STALE_CODES.has(code);
}

/**
 * 같은 입력으로 새 세션 — 오늘이면 날짜 키를 싣지 않고(생략 = 오늘), 오늘이 아니면 그 날 + FULL_DAY(서버 400 규칙).
 * 출발 좌표는 싣지 않는다 — 시간이 지났으니 서버 사다리(마지막 방문지·숙소)가 다시 정한다.
 */
export function staleRetryRequest(
  session: ReplanSession,
  today: string
): StartReplanRequest {
  const otherDay =
    session.targetDate !== today ? session.targetDate : undefined;
  return buildStartReplanRequest({
    scope: otherDay ? 'FULL_DAY' : session.scope,
    targetDate: otherDay,
    reasons: session.reasons ?? [],
    directives: session.directives ?? [],
    freeText: session.freeText ?? '',
    triggerId: session.triggerId ?? null,
    excludedPoiIds: session.excludedPoiIds ?? [],
  });
}

/**
 * 대안 없음 [조건 바꿔 다시 짜기]의 i04 라우트 쿼리 — 조건을 바꾸라는 뜻이라 바로 다시 짜지 않고, 같은 입력을 시드로 채운
 * 요청 화면을 같은 트리거에 이어 연다(진입 게이트의 i04 시드와 같은 props — 라우트가 갈라 내린다). 목록은 쉼표로 잇는다
 * (사유·지시 key 는 ASCII 코드, 제외는 POI id 라 쉼표가 없다). 시드 세 키는 비어도 싣는다 — 시드가 있다는 사실이 라우트를
 * 게이트 대신 i04 로 보낸다. 날짜는 오늘이 아니면만(그 날 FULL_DAY 는 i04 가 고정), 범위는 오늘이면만 싣는다.
 */
export function reopenRequestParams(
  session: ReplanSession,
  today: string,
  includePoiId?: string
): Record<string, string> {
  const otherDay =
    session.targetDate !== today ? session.targetDate : undefined;
  return {
    seedReasons: (session.reasons ?? []).join(','),
    seedDirectives: (session.directives ?? []).join(','),
    seedExcludedPoiIds: (session.excludedPoiIds ?? []).join(','),
    ...(session.triggerId ? { triggerId: session.triggerId } : {}),
    ...(otherDay ? { targetDate: otherDay } : { scope: session.scope }),
    ...(session.freeText ? { prefill: session.freeText } : {}),
    ...(includePoiId ? { includePoiId } : {}),
  };
}

/** 넣으려던 POI 가 초안 after 의 어느 슬롯에도 없나 — 넣으려던 POI 가 없으면(일반 재계획) 늘 거짓. */
export function isIncludeMissing(
  includePoiId: string | undefined,
  after: ReplanDiffSlot[]
): boolean {
  if (!includePoiId) return false;
  return !after.some((slot) => {
    const parsed = parseSlotKey(slot.slotKey);
    return parsed.kind === 'ok' && parsed.poiId === includePoiId;
  });
}

const HANGUL_FIRST = 0xac00; // 가
const HANGUL_LAST = 0xd7a3; // 힣
const JONG_COUNT = 28;

/** 주제 조사 은/는 — 끝 글자가 한글 음절이면 받침으로 고르고, 아니면 읽는 법을 몰라 `은(는)` 병기(objectParticle 선례). */
function topicParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    return (code - HANGUL_FIRST) % JONG_COUNT !== 0 ? '은' : '는';
  }
  return '은(는)';
}

/** 미포함 안내 문장 — 이름을 모르면(조회 실패) 이름 없이 말한다(조용히 넘기지 않는다, INV-4). */
export function includeMissingText(name: string | null): string {
  return name
    ? `‘${name}’${topicParticle(name)} 이번 안에 넣지 못했어요.`
    : '넣으려던 장소는 이번 안에 넣지 못했어요.';
}
