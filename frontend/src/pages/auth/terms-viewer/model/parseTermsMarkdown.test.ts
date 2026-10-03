import { parseTermsMarkdown } from './parseTermsMarkdown';

/**
 * 약관 본문(서버 시드 = 마크다운)을 화면 블록으로 바꾸는 최소 파서 (TRIP-935 · 가이드라인 5.1.1(i)).
 * 시드가 쓰는 문법만 안다 — 제목(#)·인용(>)·번호/글머리 목록·표·구분선·**굵게**·`코드`.
 * 3동작 뼈대: 준비(마크다운 문자열) → 실행(parse) → 단언(블록 모양).
 */
describe('parseTermsMarkdown', () => {
  it('제목은 # 개수만큼 level 로, # 기호는 글자에서 빠진다', () => {
    expect(parseTermsMarkdown('# 서비스 이용약관\n\n## 제1조 (목적)')).toEqual([
      { kind: 'heading', level: 1, spans: [{ text: '서비스 이용약관' }] },
      { kind: 'heading', level: 2, spans: [{ text: '제1조 (목적)' }] },
    ]);
  });

  it('**굵게** 는 bold span 으로 갈리고 별표는 사라진다', () => {
    expect(parseTermsMarkdown('**14세 미만은** 가입할 수 없습니다.')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: '14세 미만은', bold: true },
          { text: ' 가입할 수 없습니다.' },
        ],
      },
    ]);
  });

  it('`코드` 의 백틱은 벗기고 글자만 남긴다', () => {
    expect(parseTermsMarkdown('> terms_type: `PRIVACY_POLICY` · 필수')).toEqual(
      [
        {
          kind: 'quote',
          spans: [{ text: 'terms_type: PRIVACY_POLICY · 필수' }],
        },
      ]
    );
  });

  it('번호 목록은 번호를 marker 로 두고, 들여쓴 이어지는 줄은 앞 항목에 붙는다', () => {
    expect(
      parseTermsMarkdown('1. 첫째는 길어서\n   다음 줄로 넘어갑니다.\n2. 둘째')
    ).toEqual([
      {
        kind: 'item',
        marker: '1.',
        spans: [{ text: '첫째는 길어서 다음 줄로 넘어갑니다.' }],
      },
      { kind: 'item', marker: '2.', spans: [{ text: '둘째' }] },
    ]);
  });

  it('글머리(-)는 • marker 가 된다', () => {
    expect(parseTermsMarkdown('- 항목')).toEqual([
      { kind: 'item', marker: '•', spans: [{ text: '항목' }] },
    ]);
  });

  it('표는 머리행·구분선·본문행을 한 블록으로 묶고 | 와 구분선은 글자로 남지 않는다', () => {
    const md =
      '| 항목 | 보유기간 |\n|---|---|\n| 닉네임 | 탈퇴 + 30일 |\n| 토큰 | **즉시 폐기** |';
    expect(parseTermsMarkdown(md)).toEqual([
      {
        kind: 'table',
        header: ['항목', '보유기간'],
        rows: [
          [[{ text: '닉네임' }], [{ text: '탈퇴 + 30일' }]],
          [[{ text: '토큰' }], [{ text: '즉시 폐기', bold: true }]],
        ],
      },
    ]);
  });

  it('--- 는 구분선 블록이다', () => {
    expect(parseTermsMarkdown('앞\n\n---\n\n뒤')).toEqual([
      { kind: 'paragraph', spans: [{ text: '앞' }] },
      { kind: 'rule' },
      { kind: 'paragraph', spans: [{ text: '뒤' }] },
    ]);
  });

  it('빈 줄 없이 이어진 문단 줄은 한 문단으로 합친다 (원문이 줄바꿈으로 접혀 있다)', () => {
    expect(parseTermsMarkdown('첫 줄\n둘째 줄\n\n새 문단')).toEqual([
      { kind: 'paragraph', spans: [{ text: '첫 줄 둘째 줄' }] },
      { kind: 'paragraph', spans: [{ text: '새 문단' }] },
    ]);
  });

  it('마크다운 기호가 없는 한 줄 본문은 문단 하나로 그대로 나온다', () => {
    expect(parseTermsMarkdown('서비스 이용약관 전문 — 제1조(목적)')).toEqual([
      {
        kind: 'paragraph',
        spans: [{ text: '서비스 이용약관 전문 — 제1조(목적)' }],
      },
    ]);
  });

  it('빈 문자열은 블록 0개다', () => {
    expect(parseTermsMarkdown('')).toEqual([]);
  });
});
