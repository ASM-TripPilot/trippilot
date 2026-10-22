import type {
  AssistantMessage,
  CandidatesPayload,
  NextAction,
  ProposalSlotFace,
  QuickReply,
} from '../api/assistantContract';

/**
 * 카드 렌더 모델(TRIP-1320 · PBT-U8-8 FE 몫). 서버 문자열을 이어 붙이기만 한다 — 시각·거리를 계산하거나
 * 소요시간 문구를 만들지 않는다(INV-2·3, BR-U8-35). 이동은 거리만(`이동 630m`, b02).
 */
export function slotFaceLine(face: ProposalSlotFace): string {
  const head = `${face.startAt} ${face.name}`;
  return face.distanceRange ? `${head} · 이동 ${face.distanceRange}` : head;
}

/**
 * 후보 카드 한 장이 눌렀을 때 무엇을 뜻하는가(TRIP-1564) — 그 카드가 속한 메시지 하나만 본다.
 * 고르기(PICK_CANDIDATE) > 장소 보기(OPEN_PLACE) > 없음. 카드 얼굴·버튼 줄 숨김·누름 처리가 이 한 판정을 같이 쓴다.
 */
export type CandidateTarget =
  | { kind: 'PICK'; reply: QuickReply }
  | { kind: 'OPEN'; action: NextAction }
  | { kind: 'NONE' };

export function candidateTarget(
  message: AssistantMessage,
  poiId: string
): CandidateTarget {
  const reply = message.quickReplies?.find(
    (r) => r.action === 'PICK_CANDIDATE' && r.params.poiId === poiId
  );
  if (reply) return { kind: 'PICK', reply };
  const action = message.nextActions.find(
    (a) => a.type === 'OPEN_PLACE' && a.params.poiId === poiId
  );
  return action ? { kind: 'OPEN', action } : { kind: 'NONE' };
}

/** 카드가 스스로 그린(OPEN 얼굴) 후보의 `OPEN_PLACE` 행동 — 아래 버튼 줄에서 빼 같은 장소가 두 번 나오지 않게. */
export function candidateConsumedActions(
  message: AssistantMessage
): NextAction[] {
  if (message.kind !== 'CANDIDATES') return [];
  const candidates = (message.payload as CandidatesPayload | null | undefined)
    ?.candidates;
  if (!candidates) return [];
  const opened = new Set(
    candidates
      .filter((c) => candidateTarget(message, c.poiId).kind === 'OPEN')
      .map((c) => c.poiId)
  );
  return message.nextActions.filter(
    (a) => a.type === 'OPEN_PLACE' && opened.has(a.params.poiId)
  );
}
