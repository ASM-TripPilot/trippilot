/**
 * 서버 `placementReason`(해시태그를 공백으로 이은 문자열)을 카드에 그릴 태그 목록으로 바꾼다.
 * 전부 `#X` 꼴일 때만 입력 순서 그대로 돌려주고, 하나라도 아니면(옛 문장·혼재·`#` 단독) 빈 배열 —
 * 반쪽 표시나 만들어 낸 태그를 그리지 않는다(INV-4).
 */
export function parseReasonTags(
  raw: string | null | undefined
): readonly string[] {
  const tokens = (raw ?? '').split(/\s+/).filter((token) => token !== '');
  return tokens.every((token) => token.startsWith('#') && token.length > 1)
    ? tokens
    : [];
}
