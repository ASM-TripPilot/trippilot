// TRIP-1774 · raw hex 가드 — ESLint 로컬 규칙 `trippilot/no-raw-hex` 와 그 순수 함수. eslint.config.js 는 배선만 한다.
// 소스 안 문자열(리터럴·템플릿)에 3·6·8자리 hex 가 적히면 error — 색은 정본(src/shared/config/colorTokens.cjs)에서 읽는다.
// 못 보는 것: rgba()·이름 색(white·black)·문자열 연결로 만든 hex·4·5·7자리·JSX 텍스트·주석·.js/.cjs/.json·루트 app.config.ts.
// 정본을 plain require 하는 이유: eslint.config.js 는 ESLint 가 node 로 바로 로드하므로 TS 를 못 쓴다.
const tokens = require('../src/shared/config/colorTokens.cjs');

// 비교용 정규화 — 소문자, 3자리는 6자리로 늘린다(#000 ↔ #000000). 8자리는 알파가 달라 토큰과 같다고 안 본다.
const normalize = (hex) => {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
};

// matchAll 은 호출마다 정규식 복사본을 돌려 lastIndex 상태가 새지 않는다.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

const findRawHex = (text, tokenMap) =>
  [...text.matchAll(HEX)].map(([hex]) => ({
    hex,
    tokens:
      hex.length === 9
        ? []
        : Object.keys(tokenMap).filter(
            (name) => normalize(tokenMap[name]) === normalize(hex)
          ),
  }));

const message = ({ hex, tokens: names }) =>
  names.length
    ? `raw hex ${hex} 금지 — 같은 값 토큰: ${names.map((n) => `\`${n}\``).join(' / ')}. @/shared/config 의 COLOR_TOKENS 에서 읽는다(TRIP-1774).`
    : `raw hex ${hex} 금지 — 토큰에 없는 값이다. 정말 Figma raw 값이면 윗줄에 \`// eslint-disable-next-line trippilot/no-raw-hex -- <사유>\` (TRIP-1774).`;

const rule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const check = (node, text) => {
      for (const found of findRawHex(text, tokens)) {
        context.report({ node, message: message(found) });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

module.exports = { findRawHex, rule };
