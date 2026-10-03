/**
 * 약관 본문(서버 시드 = 마크다운)을 화면 블록으로 바꾼다(TRIP-935).
 * 시드가 쓰는 문법만 안다 — 제목·인용·번호/글머리 목록·표·구분선·**굵게**·`코드`.
 * 새 문법이 시드에 들어오면 여기에 한 줄 더한다(일반 마크다운 렌더러 의존성을 들이지 않은 이유:
 * 문법 6종이 전부라 의존성이 쓰임보다 크다).
 */
export interface Span {
  text: string;
  bold?: true;
}

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'item'; marker: string; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'rule' }
  | { kind: 'table'; header: string[]; rows: Span[][][] };

function parseInline(raw: string): Span[] {
  const spans: Span[] = [];
  raw
    .replace(/`([^`]*)`/g, '$1')
    .split(/(\*\*[^*]+\*\*)/)
    .forEach((part) => {
      if (part === '') return;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        spans.push({ text: part.slice(2, -2), bold: true });
      } else {
        spans.push({ text: part });
      }
    });
  return spans;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const isTableRow = (l: string) => l.trim().startsWith('|');
const isDivider = (l: string) => /^\|[\s|:-]+\|?$/.test(l.trim());
const HEADING = /^(#{1,6})\s+(.*)$/;
const ORDERED = /^(\d+\.)\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;

export function parseTermsMarkdown(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({
        kind: 'paragraph',
        spans: parseInline(paragraph.join(' ')),
      });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const last = blocks[blocks.length - 1];
    let m: RegExpMatchArray | null;

    if (trimmed === '') {
      flush();
    } else if (/^-{3,}$/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if ((m = trimmed.match(HEADING))) {
      flush();
      blocks.push({
        kind: 'heading',
        level: m[1].length,
        spans: parseInline(m[2]),
      });
    } else if (trimmed.startsWith('>')) {
      flush();
      blocks.push({
        kind: 'quote',
        spans: parseInline(trimmed.replace(/^>\s?/, '')),
      });
    } else if (isTableRow(line)) {
      flush();
      const header = splitRow(line);
      const rows: Span[][][] = [];
      i += 1;
      if (i < lines.length && isDivider(lines[i])) i += 1;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'table', header, rows });
    } else if ((m = line.match(ORDERED)) || (m = line.match(BULLET))) {
      flush();
      const ordered = /^\d+\./.test(line);
      blocks.push({
        kind: 'item',
        marker: ordered ? m[1] : '•',
        spans: parseInline(ordered ? m[2] : m[1]),
      });
    } else if (
      /^\s+\S/.test(line) &&
      last?.kind === 'item' &&
      paragraph.length === 0
    ) {
      // 들여쓴 이어지는 줄 — 앞 항목에 붙인다
      last.spans = parseInline(
        [
          ...last.spans.map((s) => (s.bold ? `**${s.text}**` : s.text)),
          '',
        ].join('') +
          ' ' +
          trimmed
      );
    } else {
      paragraph.push(trimmed);
    }
  }
  flush();
  return blocks;
}
