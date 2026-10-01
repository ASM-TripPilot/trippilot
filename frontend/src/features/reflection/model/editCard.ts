import type { ReflectionCard } from '@/shared/api/generated/schemas';

/**
 * TRIP-945 · buildEditCard — 회고 수정 저장(PUT) 바디의 `card` 문자열 조립(결정 2 · BR-U5-36 · PBT-U5-F1).
 *
 * 서버 codec 은 받은 문자열의 최상위 `cover.title` 을 읽는다 — `ReflectionCard` DTO 직렬화가 아니라
 * **카드 원문(payload) 모양**을 보내야 한다. `cover.title` 이 비면 400.
 *  - 원래 payload 가 객체면 `cover.subtitle` 만 바꾸고 cover 밖은 그대로 둔다(DEC-U5-14).
 *  - 제목 채우는 순서: payload 의 cover.title → card.title → 사용자 글의 첫 비지 않은 줄 앞 30자.
 *  - 회고가 없으면 `template_id` 를 보내지 않는다(서버가 `user.edit.v1` 을 붙인다).
 */

const FALLBACK_TITLE_MAX = 30;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 사용자 글의 첫 비지 않은 줄(trim) 앞 30자 — 코드포인트 단위로 잘라 서로게이트 쌍을 가르지 않는다. */
function titleFromText(text: string): string {
  const line = text.split('\n').find(nonEmpty)?.trim() ?? '';
  return Array.from(line).slice(0, FALLBACK_TITLE_MAX).join('');
}

export function buildEditCard(
  card: ReflectionCard | undefined,
  text: string
): string {
  const base = parseObject(card?.payload);
  const cover = isRecord(base.cover) ? base.cover : {};
  const title = nonEmpty(cover.title)
    ? cover.title
    : nonEmpty(card?.title)
      ? card.title
      : titleFromText(text);

  return JSON.stringify({
    ...base,
    cover: { ...cover, title, subtitle: text },
  });
}
