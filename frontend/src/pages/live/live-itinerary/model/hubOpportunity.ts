import type { Opportunity, Trigger } from '@/shared/api/index.schemas';

/**
 * 상황 감지 FE-C · frontend-components §4.1·§4.2·§4.3 · BR-SA-22 — 허브 기회 카드의 판정(순수, 허브 페이지는 배선만).
 *
 * 자격(여행 중·남은 날·범위)과 순위는 서버가 정한다 — 여기는 받은 순서에서 **날짜당 1장**을 고르고, 고정 템플릿으로
 * 문장을 만들고, [넣어서 다시 짜기]의 i04 경로를 만든다. 시각·소요시간을 만들지 않는다(INV-2·3 — 거리는 서버
 * `distanceLabel` 그대로, 기간은 일 단위 `end` 뿐). node-safe(시계를 읽지 않는다).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface OpportunityContext {
  /** 허브가 보고 있는 날짜 'YYYY-MM-DD'. */
  date: string;
  /** 발화 중 트리거(`GET /triggers`). `undefined` = 아직 모른다(조회 중·실패). */
  triggers: readonly Trigger[] | undefined;
  /** 이 날 기기에서 숨긴 기회 key — 없으면 null. */
  hiddenKey: string | null;
}

const isEvent = (item: Opportunity): boolean => item.kind !== 'TRENDING';

/** 같은 날짜에 발화 중인 날씨 위험 — severity 가 없으면(옛 서버) 위험으로 읽는다(계약 주석). */
const blocksEvents = (trigger: Trigger, date: string): boolean =>
  trigger.kind === 'WEATHER' &&
  trigger.severity !== 'CAUTION' &&
  trigger.affectedDate === date;

/** 행사 카드는 이름·마지막 날이 있어야 문장이 선다 — 서버 2차 게이트가 막는 결측이지만 깨진 제목을 그리지 않는다. */
const hasEventCopy = (item: Opportunity): boolean =>
  (item.eventName ?? '').trim() !== '' && DATE_RE.test(item.end ?? '');

/**
 * 날짜당 1장 — ① 같은 날 날씨 위험이 발화 중이면(또는 트리거를 아직 모르면) 행사 카드를 뺀다(비 오는 날 야외 축제를
 * 권하지 않는다) ② 남은 첫 항목(서버 순위) ③ 그 항목을 이 날 숨겼으면 없음 — 숨긴 자리를 다음 항목으로 채우지 않는다.
 */
export function pickOpportunity(
  items: readonly Opportunity[],
  { date, triggers, hiddenKey }: OpportunityContext
): Opportunity | null {
  const eventsBlocked =
    triggers === undefined ||
    triggers.some((trigger) => blocksEvents(trigger, date));
  const first = items.find((item) =>
    isEvent(item) ? !eventsBlocked && hasEventCopy(item) : true
  );
  if (first === undefined || first.key === hiddenKey) return null;
  return first;
}

export interface OpportunityCopy {
  title: string;
  body: string;
  /** 행사 카드만 — 열리는 날·시간을 단정하지 않는다(주말만 여는 축제가 있다). */
  note: string | null;
}

const TRENDING_TITLE = '요즘 많이 찾는 곳이 동선 근처에 있어요';
const EVENT_NOTE = '열리는 날·시간은 행사 안내를 확인해 주세요';

const HANGUL_FIRST = 0xac00; // 가
const HANGUL_LAST = 0xd7a3; // 힣
const JONG_COUNT = 28;

/** 주격 조사 이/가 — 끝 글자가 한글 음절이면 받침으로 고르고, 아니면 읽는 법을 몰라 `이(가)` 병기(objectParticle 선례). */
function withSubjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    return word + ((code - HANGUL_FIRST) % JONG_COUNT !== 0 ? '이' : '가');
  }
  return `${word}이(가)`;
}

/** 'YYYY-MM-DD' → 'M월 d일'(앞자리 0 없음). 형식이 아니면 빈 문자열. */
function monthDay(date: string | null | undefined): string {
  const match = DATE_RE.exec(date ?? '');
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : '';
}

/** kind 별 고정 템플릿 — 문장은 이 한 곳에서만 만든다(서버는 이름·거리 표시·기간 재료만 준다). */
export function opportunityCopy(item: Opportunity): OpportunityCopy {
  const distance = `동선에서 ${item.distanceLabel}`;
  if (item.kind === 'TRENDING') {
    return {
      title: TRENDING_TITLE,
      body: `${item.poiName} · ${distance}`,
      note: null,
    };
  }
  const where =
    item.kind === 'EVENT_VENUE'
      ? `${item.poiName}에서 열려요`
      : `행사장 가까이에 ${withSubjectParticle(item.poiName)} 있어요`;
  return {
    title: `‘${item.eventName ?? ''}’ 기간이에요`,
    body: `${where} · ${distance} · ${monthDay(item.end)}까지`,
    note: EVENT_NOTE,
  };
}

/** [넣어서 다시 짜기] 목적지 — `router.push` 에 그대로 넘긴다. */
export interface OpportunityReplanHref {
  pathname: '/trips/[tripId]/planb';
  params: {
    tripId: string;
    prefill: string;
    includePoiId: string;
    targetDate?: string;
  };
}

/**
 * i04 를 자유 입력 `{장소명} 꼭 넣어서 다시 짜 줘` + 넣으려던 POI 로 연다. 오늘이면 날짜를 싣지 않고(생략 = 오늘 —
 * [AI에게 맡기기]와 같은 규칙), 오늘이 아니면 그 날짜를 `targetDate` 로 싣는다. 트리거가 없어 진입 게이트를 지나지 않는다.
 */
export function opportunityReplanHref(
  tripId: string,
  item: Opportunity,
  date: string,
  today: string
): OpportunityReplanHref {
  return {
    pathname: '/trips/[tripId]/planb',
    params: {
      tripId,
      prefill: `${item.poiName} 꼭 넣어서 다시 짜 줘`,
      includePoiId: item.poiId,
      ...(date !== today ? { targetDate: date } : {}),
    },
  };
}
