import { COVER_GRADIENTS } from './coverGradients';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const colors = require('../../../../tailwind.config.js').theme.extend
  .colors as Record<string, string>;

describe('TRIP-1208 · 커버 그라데이션 stop 은 tailwind 토큰 조합이다(새 색 금지)', () => {
  it.each([
    ['live', ['primary', 'primary-active']],
    ['upcoming', ['primary-active', 'primary-text']],
    ['ended', ['muted', 'body']],
  ] as const)('%s = %j', (tone, tokens) => {
    expect([...COVER_GRADIENTS[tone]]).toEqual(tokens.map((t) => colors[t]));
  });
});
