import { COVER_GRADIENTS } from './coverGradients';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const colors = require('../../../../tailwind.config.js').theme.extend
  .colors as Record<string, string>;

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// 흰 글자가 얹히는 쪽에서 가장 밝은 stop(대비가 가장 낮은 쪽)
const lightest = (tone: keyof typeof COVER_GRADIENTS) =>
  [...COVER_GRADIENTS[tone]].sort((a, b) => lum(b) - lum(a))[0];
const isRed = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return r - Math.max(g, b) > 40;
};

describe('TRIP-1208 · 커버 그라데이션 stop 은 tailwind 토큰 조합이다(새 색 금지)', () => {
  it.each([
    ['live', ['primary', 'primary-active']],
    ['upcoming', ['ink', 'body']],
    ['ended', ['muted', 'body']],
  ] as const)('%s = %j', (tone, tokens) => {
    expect([...COVER_GRADIENTS[tone]]).toEqual(tokens.map((t) => colors[t]));
  });
});

describe('TRIP-1208 후속 · 코랄은 진행 중 한 장에만', () => {
  it('진행 중은 primary 계열(붉다)', () => {
    COVER_GRADIENTS.live.forEach((c) => expect(isRed(c)).toBe(true));
  });
  it.each(['upcoming', 'ended'] as const)('%s 는 붉지 않다', (tone) => {
    COVER_GRADIENTS[tone].forEach((c) => expect(isRed(c)).toBe(false));
  });
  it('세 톤은 서로 다르다', () => {
    const s = (['live', 'upcoming', 'ended'] as const).map((t) =>
      COVER_GRADIENTS[t].join()
    );
    expect(new Set(s).size).toBe(3);
  });
  it('종료의 밝은 쪽이 예정의 밝은 쪽보다 확실히 밝다(대비 1.5 이상)', () => {
    expect(
      contrast(lightest('ended'), lightest('upcoming'))
    ).toBeGreaterThanOrEqual(1.5);
  });
});

describe('TRIP-1208 후속 · 흰 도시 이름 글자 대비(밝은 stop 기준 4.5:1)', () => {
  it.each(['live', 'upcoming', 'ended'] as const)('%s', (tone) => {
    // live 는 코랄 — 브랜드색 위 흰 글자라 3:1(큰 글자·굵은 글씨 기준)만 요구한다
    const min = tone === 'live' ? 3 : 4.5;
    expect(contrast('#FFFFFF', lightest(tone))).toBeGreaterThanOrEqual(min);
  });
});
