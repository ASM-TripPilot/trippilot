// 색 토큰의 정본(TRIP-1774) — 토큰 값(색 hex)은 이 파일에만 적는다. 나머지는 여기서 읽는다(면제 6파일도 토큰과 같은 값은 여기서 읽고, 토큰 밖 고유 색만 리터럴로 남긴다):
//  · tailwind.config.js 가 이 객체를 theme.extend.colors 에 그대로 쓴다(bg-primary·text-muted-soft … 클래스).
//  · TS 소스는 `@/shared/config` 의 COLOR_TOKENS 로 꺼낸다(SVG stroke/fill·LinearGradient 처럼 className 을 못 받는 곳).
// Figma TripPilot 변수 컬렉션(파일 1MTF3dtptIrbg8gld5IdO2)의 미러다. Figma 변수를 바꾸면 여기만 고친다.
// Figma ↔ 값 일치는 기계 장치가 없다(소스 안 값끼리의 일치는 src/__tests__/colorTokens.test.ts 와 `trippilot/no-raw-hex` 린트가 지킨다).
// plain CommonJS 인 이유: tailwind.config.js 와 eslint 규칙(scripts/noRawHex.cjs)이 node 로 바로 require 한다.
// `@type {const}` 캐스트가 있어야 TS 가 키·값을 리터럴로 읽는다(없으면 값이 string 으로 넓어진다).
module.exports = /** @type {const} */ ({
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
  scrim: '#000000', // 사용처에서 40% opacity (bg-scrim/40)
});
