import tailwindConfig from '../../tailwind.config.js';

// 기대값은 Figma TripPilot 컬렉션(파일 1MTF3dtptIrbg8gld5IdO2)의 2026-07-18 라이브 덤프를
// 독립 전사한 것이다 — config 와 이 매니페스트가 모두 일치해야 하므로 한쪽의 오타를 잡는다.
const FIGMA_COLORS = {
  primary: '#FF385C',
  'primary-active': '#E00B41',
  'primary-pale': '#FFE4E9',
  'primary-text': '#C13515',
  'on-primary': '#FFFFFF',
  canvas: '#FFFFFF',
  'canvas-alt': '#FAFAFA',
  'surface-soft': '#F7F7F7',
  'surface-strong': '#F2F2F2',
  hairline: '#EDEDED',
  'hairline-strong': '#DDDDDD',
  ink: '#222222',
  body: '#3F3F3F',
  muted: '#6A6A6A',
  'muted-soft': '#9AA1AB',
  link: '#1659C9',
  info: '#0B6E63',
  'info-bg': '#F0FCFA',
  'info-border': '#A1E8DD',
  success: '#0E9384',
  'success-bg': '#E4F5F1',
  'presence-blue': '#1B6EF3',
  'presence-blue-bg': '#E7F0FB',
  'presence-teal': '#14B8A6',
  scrim: '#000000',
};

const FIGMA_RADIUS = {
  card: '16px',
  'sheet-top': '24px',
  button: '12px',
  input: '12px',
  thumb: '12px',
  pill: '999px',
};

const FIGMA_SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
};

// lineHeight 는 Figma 의 % 를 px 로 반올림한 파생값이다 (RN 은 unitless 미지원).
const FIGMA_FONT_SIZE = {
  display: ['26px', { lineHeight: '34px' }], // 26 × 130%
  hero: ['22px', { lineHeight: '29px' }], // 22 × 130%
  section: ['17px', { lineHeight: '23px' }], // 17 × 135%
  'card-title': ['15px', { lineHeight: '20px' }], // 15 × 135%
  body: ['14px', { lineHeight: '20px' }], // 14 × 145%
  label: ['13px', { lineHeight: '18px' }], // 13 × 140%
  caption: ['12px', { lineHeight: '16px' }], // 12 × 135%
  micro: ['11px', { lineHeight: '14px' }], // 11 × 130%
};

describe('디자인 토큰 미러 (Figma TripPilot ↔ tailwind.config.js)', () => {
  // Config 타입상 theme/extend 는 optional — 부재 자체가 미러 실패이므로 가드가 곧 검증이다.
  if (!tailwindConfig.theme?.extend) {
    throw new Error('tailwind.config.js 에 theme.extend 가 없다 — 미러 미구현');
  }
  const extend = tailwindConfig.theme.extend;

  it('색 토큰 25종이 Figma 확정값과 정확히 일치한다 (잉여·누락 없음)', () => {
    expect(extend.colors).toEqual(FIGMA_COLORS);
  });

  it('반경 토큰 6종이 Figma 확정값과 정확히 일치한다', () => {
    expect(extend.borderRadius).toEqual(FIGMA_RADIUS);
  });

  it('스페이싱 토큰 7종이 Figma 확정값과 정확히 일치한다', () => {
    expect(extend.spacing).toEqual(FIGMA_SPACING);
  });

  it('타이포 램프 8종이 [크기, lineHeight] 튜플로 정확히 일치한다', () => {
    expect(extend.fontSize).toEqual(FIGMA_FONT_SIZE);
  });

  it('미러 무결성 — extend 에 선언한 4개 그룹 외 잉여 그룹이 없다', () => {
    expect(Object.keys(extend).sort()).toEqual([
      'borderRadius',
      'colors',
      'fontSize',
      'spacing',
    ]);
  });
});
