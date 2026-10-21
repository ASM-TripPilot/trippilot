/**
 * TRIP-1212 · 회고 문장 정리 — 서버·AI 응답에 미치환 템플릿(`{region} · {start_date}~{end_date}`)이
 * 그대로 실려 오면(AI 프롬프트가 이 형태를 요구한다) 값을 주입하고, 값이 없으면 중괄호를 지워
 * 템플릿 원문이 사용자에게 보이지 않게 한다. 서버 안내문(기록 0곳 기본 문장)은 편집 시드·저장에서 거른다.
 */

export interface TemplateContext {
  region?: string;
  startDate?: string;
  endDate?: string;
  /** TRIP-1497 · 기록된 stats 값 — 있으면 `{visit_count}`·`{distance_km}`·`{photo_count}` 를 채운다(숫자만, 단위는 문장이 쓴다). */
  visitCount?: number;
  distanceKm?: number;
  photoCount?: number;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;
/** 값이 없어도 자리표시자만 걷고 문장은 남기는 종류(TRIP-1212) — 그 밖(통계·`{poi:…}`·모르는 것)은 값이 없으면 문장을 뺀다. */
const STRIP_ONLY_KEYS = new Set(['region', 'start_date', 'end_date']);

/** 백엔드 `ReflectionNarrator.BASIC_DAILY` 와 같은 문장 — 회고 글이 아니라 안내문이다. */
export const GUIDE_TEXTS: readonly string[] = [
  '이 날은 기록된 방문이 없어요. 다녀온 곳을 남기면 회고가 채워져요.',
];

export function isGuideText(text: string): boolean {
  return GUIDE_TEXTS.includes(text.trim());
}

/** TRIP-1425 · 자리표시자 `{…}`·구분자 `·` `~`·공백을 걷으면 아무것도 안 남는 문장인가(템플릿뿐). */
export function isTemplateOnly(text: string): boolean {
  const rest = text.replace(/\{[^{}]*\}/g, '');
  return rest !== text && rest.replace(/[\s·~]/g, '') === '';
}

export function fillTemplate(text: string, ctx: TemplateContext): string {
  const known: Record<string, string | undefined> = {
    region: ctx.region,
    start_date: ctx.startDate,
    end_date: ctx.endDate,
    visit_count: ctx.visitCount?.toString(),
    distance_km:
      ctx.distanceKm === undefined
        ? undefined
        : String(Math.round(ctx.distanceKm * 10) / 10),
    photo_count: ctx.photoCount?.toString(),
  };
  // TRIP-1425 · 하루 회고는 시작=끝=그날 — `X~X` 대신 날짜 하나로 접는다.
  const folded =
    ctx.startDate !== undefined && ctx.startDate === ctx.endDate
      ? text.replace(
          /\{\s*start_date\s*\}\s*~\s*\{\s*end_date\s*\}/g,
          '{start_date}'
        )
      : text;
  // TRIP-1497 · 채울 수 없는 통계·모르는 자리표시자가 낀 문장은 통째로 뺀다 — 토큰만 지우면 "오늘 곳을 다녀왔어요"처럼 깨진다.
  // 조각 = 마침표류(뒤에 공백·끝이 올 때만 — 3.5km·9.30 의 점은 안 자른다)·`·`·줄바꿈까지(뒤따르는 공백 포함해 이어 붙여도
  // 모양이 같다). `{…}` 는 쪼개지 않는다(`{poi:1.name}` 의 점). `·` 로 끊어 "3곳 · {거리} · 사진 2장" 은 거리 조각만 빠진다.
  const lookup = (key: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(known, key) ? known[key] : undefined;
  const unfillable = (sentence: string): boolean =>
    [...sentence.matchAll(PLACEHOLDER)].some((m) => {
      const key = (m[1] ?? '').trim();
      return !STRIP_ONLY_KEYS.has(key) && lookup(key) === undefined;
    });
  const kept = (
    folded.match(
      /(?:\{[^{}]*\}|[^.!?。…·\n]|[.!?。…](?=\S))+(?:[.!?。…]+|·)?\s*|\n|·\s*/g
    ) ?? [folded]
  )
    .filter((sentence) => !unfillable(sentence))
    .join('');
  return kept
    .replace(PLACEHOLDER, (_, key: string) => lookup(key.trim()) ?? '')
    .replace(/\s*[·~]\s*(?=[·~]|$)/g, '') // 값이 빠져 매달린 구분자
    .replace(/^\s*[·~]\s*/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
