/**
 * TRIP-1212 · 회고 문장 정리 — 서버·AI 응답에 미치환 템플릿(`{region} · {start_date}~{end_date}`)이
 * 그대로 실려 오면(AI 프롬프트가 이 형태를 요구한다) 값을 주입하고, 값이 없으면 중괄호를 지워
 * 템플릿 원문이 사용자에게 보이지 않게 한다. 서버 안내문(기록 0곳 기본 문장)은 편집 시드·저장에서 거른다.
 */

export interface TemplateContext {
  region?: string;
  startDate?: string;
  endDate?: string;
}

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
  };
  // TRIP-1425 · 하루 회고는 시작=끝=그날 — `X~X` 대신 날짜 하나로 접는다.
  const folded =
    ctx.startDate !== undefined && ctx.startDate === ctx.endDate
      ? text.replace(
          /\{\s*start_date\s*\}\s*~\s*\{\s*end_date\s*\}/g,
          '{start_date}'
        )
      : text;
  return folded
    .replace(/\{([^{}]*)\}/g, (_, key: string) => known[key.trim()] ?? '')
    .replace(/\s*[·~]\s*(?=[·~]|$)/g, '') // 값이 빠져 매달린 구분자
    .replace(/^\s*[·~]\s*/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
