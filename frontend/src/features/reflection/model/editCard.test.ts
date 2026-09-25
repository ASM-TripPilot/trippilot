import fc from 'fast-check';

import type { ReflectionCard } from '@/shared/api/generated/schemas';

import { buildEditCard } from './editCard';

/**
 * TRIP-945 · buildEditCard — 회고 수정 저장 바디의 `card` 문자열 조립(결정 2 · PBT-U5-F1 · BR-U5-36).
 *
 * 무엇을 보장하나:
 *  - 원래 카드의 payload 를 파싱해 `cover.subtitle` 만 사용자 글로 바꾼다. `cover.title` 과 cover 밖
 *    (`template_id`·`format`·`scenes`)은 그대로 둔다(DEC-U5-14).
 *  - payload 가 없거나 깨져도 예외 없이 `cover.title` 이 채워진 카드를 낸다 — 비면 서버가 400 을 낸다.
 *    채우는 순서: payload 의 cover.title → card.title → 사용자 글의 첫 줄 앞 30자.
 *  - 회고가 아예 없으면 `template_id` 를 보내지 않는다(서버가 `user.edit.v1` 을 붙인다).
 *
 * 3동작: 준비=원래 카드(또는 없음)+사용자 글 → 실행=buildEditCard → 단언=JSON.parse 한 결과.
 */

const PLACES = [
  '광안리해수욕장',
  '부산시립미술관',
  '해운대시장',
  '감천문화마을',
];
const RULE_TITLE = '광안리해수욕장 외 3곳';
const RULE_SUBTITLE =
  '광안리해수욕장·부산시립미술관·해운대시장 외 1곳 을(를) 다녀왔어요. 이동 거리는 약 12.0km 였어요. 사진 6장을 남겼어요.';
const RULE_SCENES = PLACES.map((name) => ({
  layout: 'TEXT',
  caption: `${name} 을(를) 다녀왔어요.`,
}));
/** 백엔드 ReflectionNarrator.dailyCard 가 만드는 규칙 카드 원문 모양 그대로. */
const RULE_PAYLOAD = JSON.stringify({
  template_id: 'backend.rule.daily.v1',
  format: 'CARD',
  cover: { title: RULE_TITLE, subtitle: RULE_SUBTITLE },
  scenes: RULE_SCENES,
});

const RULE_CARD: ReflectionCard = {
  templateId: 'backend.rule.daily.v1',
  format: 'CARD',
  title: RULE_TITLE,
  subtitle: RULE_SUBTITLE,
  payload: RULE_PAYLOAD,
};

function withPayload(payload: string, title = RULE_TITLE): ReflectionCard {
  return { ...RULE_CARD, title, payload };
}

describe('AC-4 · 원래 카드의 cover.subtitle 만 바꾼다 (결정 2 · DEC-U5-14)', () => {
  it('cover.subtitle 은 사용자 글, cover.title 과 cover 밖 필드는 원래 값 그대로', () => {
    const text = '바다가 좋았다';

    const parsed = JSON.parse(buildEditCard(RULE_CARD, text));

    expect(parsed.cover.subtitle).toBe(text);
    expect(parsed.cover.title).toBe(RULE_TITLE);
    expect(parsed.template_id).toBe('backend.rule.daily.v1');
    expect(parsed.format).toBe('CARD');
    expect(parsed.scenes).toEqual(RULE_SCENES);
  });

  it('cover 안의 title·subtitle 말고 다른 키(photo_slot)도 그대로 둔다', () => {
    const photoSlot = { visit_ref: 'v1' };
    const card = withPayload(
      JSON.stringify({
        template_id: 'ai.daily.v1',
        cover: {
          title: RULE_TITLE,
          subtitle: RULE_SUBTITLE,
          photo_slot: photoSlot,
        },
        scenes: RULE_SCENES,
      })
    );

    const parsed = JSON.parse(buildEditCard(card, '바다가 좋았다'));

    expect(parsed.cover.photo_slot).toEqual(photoSlot);
    expect(parsed.cover.subtitle).toBe('바다가 좋았다');
  });

  it('화면 입력 상한(4000자)을 채워도 카드 문자열 전체가 20000자 이하다', () => {
    const card = buildEditCard(RULE_CARD, '가'.repeat(4000));

    expect(card.length).toBeLessThanOrEqual(20000);
  });
});

describe('AC-5 · payload 가 없거나 깨져도 cover.title 이 채워진다 (BR-U5-36 · Q2)', () => {
  it('회고가 없으면 사용자 글의 첫 번째 비어 있지 않은 줄(trim)을 제목으로 쓰고 template_id 는 보내지 않는다', () => {
    const text = '\n  오늘은 바다를 보러 갔다  \n둘째 줄';

    const parsed = JSON.parse(buildEditCard(undefined, text));

    expect(parsed.cover.title).toBe('오늘은 바다를 보러 갔다');
    expect(parsed.cover.subtitle).toBe(text);
    expect(parsed).not.toHaveProperty('template_id');
  });

  it('첫 줄이 30자를 넘으면 앞 30자만 제목으로 쓴다', () => {
    const parsed = JSON.parse(buildEditCard(undefined, '가'.repeat(40)));

    expect(parsed.cover.title).toBe('가'.repeat(30));
  });

  it('payload 가 JSON 이 아니면 예외 없이 card.title 을 제목으로 쓴다', () => {
    const text = '다시 쓴 회고';

    const parsed = JSON.parse(buildEditCard(withPayload('not-json'), text));

    expect(parsed.cover.title).toBe(RULE_TITLE);
    expect(parsed.cover.subtitle).toBe(text);
  });

  it('payload 가 객체가 아니라 배열이면 객체 카드를 새로 만들고 card.title 을 제목으로 쓴다', () => {
    const parsed = JSON.parse(buildEditCard(withPayload('[]'), '다시 쓴 회고'));

    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.cover.title).toBe(RULE_TITLE);
  });

  it('payload 에 cover 가 없으면 card.title 로 채우고 cover 밖 필드는 그대로 둔다', () => {
    const parsed = JSON.parse(
      buildEditCard(
        withPayload('{"template_id":"x","scenes":[1]}'),
        '다시 쓴 회고'
      )
    );

    expect(parsed.cover.title).toBe(RULE_TITLE);
    expect(parsed.template_id).toBe('x');
    expect(parsed.scenes).toEqual([1]);
  });

  it('payload 의 cover.title 과 card.title 이 모두 비면 사용자 글의 첫 줄을 제목으로 쓴다', () => {
    const parsed = JSON.parse(
      buildEditCard(
        withPayload('{"cover":{"title":"   ","subtitle":"옛 문장"}}', ''),
        '첫 줄\n둘째'
      )
    );

    expect(parsed.cover.title).toBe('첫 줄');
  });
});

describe('PBT-U5-F1 · 어떤 원래 카드와 사용자 글이어도 저장 카드는 서버 400 을 피한다', () => {
  const payloadArb = fc.oneof(
    fc.constant(RULE_PAYLOAD),
    fc.constant(''),
    fc.constant('not-json'),
    fc.constant('[]'),
    fc.constant('null'),
    fc.constant('"s"'),
    fc.constant('{"cover":null}'),
    fc.constant('{"cover":"x"}'),
    fc.constant('{"cover":{"title":"  "}}'),
    fc.constant('{"cover":{"title":7}}'),
    fc.json(),
    fc.string()
  );

  const maybeText = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant(RULE_TITLE),
    fc.string()
  );

  const cardArb = fc.oneof(
    fc.constant(undefined),
    fc.record(
      {
        templateId: fc.constant('backend.rule.daily.v1'),
        format: fc.constant('CARD'),
        title: maybeText,
        subtitle: maybeText,
        payload: payloadArb,
      },
      { requiredKeys: [] }
    )
  );

  /** 화면이 빈/공백 저장을 막으므로(canSave) 입력은 trim 후 비지 않는 글만. */
  const textArb = fc.oneof(
    fc.constant('\n\n  첫 줄\n둘째'),
    fc.constant('한 줄'),
    fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0)
  );

  it('예외 없이 객체 카드를 내고, cover.title 은 비지 않으며 cover.subtitle 은 사용자 글이다', () => {
    fc.assert(
      fc.property(cardArb, textArb, (card, text) => {
        const parsed = JSON.parse(
          buildEditCard(card as unknown as ReflectionCard | undefined, text)
        );

        expect(typeof parsed).toBe('object');
        expect(parsed).not.toBeNull();
        expect(Array.isArray(parsed)).toBe(false);
        expect(typeof parsed.cover.title).toBe('string');
        expect(parsed.cover.title.trim().length).toBeGreaterThan(0);
        expect(parsed.cover.subtitle).toBe(text);
      })
    );
  });
});
