import type {
  ChangeLogEntrySourceType,
  TripRecord,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-570 · j02 기록 비교 — TripRecord 를 화면 행(CompareRow[])으로 접는 순수 조립 함수.
 *
 * 계획·실제·변경을 한 리스트로 접되, 판정은 세 갈래로 갈린다:
 *  - actual : 그 날의 방문(ActualVisit) → 방문 시각(arrivedAt) 을 HH:mm 로 잘라 표시.
 *  - unvisited : 서버 `unvisitedSlotKeys` 직독(BR-U5-28) — planned vs actual 재판정 안 함.
 *    poiId 는 planned 슬롯 조인으로만 얻고(재판정 아님), 못 찾으면 slotKey 폴백.
 *  - change : changes[] 항목(BR-U5-30) → 전(before)·후(after) 장소·사유(reason)·시각(at).
 *
 * 장소명은 `nameByPoi[poiId] ?? poiId` best-effort — 이름 맵이 없거나 스냅숏이 결측이면
 * poiId(또는 폴백 문자열)로 구조만 유지한다(이름 완전 해소는 place-data 배치 조회 후속).
 *
 * 방어(반쪽 방어 금지): record.days[].{planned,actual,unvisitedSlotKeys}·changes[].{before,after}
 * 의 중첩 결측을 매 단계 `?.`로 막는다 — 상위만 막으면 계약 위반 응답에서 크래시한다.
 *
 * INV-3: 반환 어디에도 소요시간·`duration` 을 두지 않는다. timeLabel 은 ISO 문자열을 `slice(11,16)`
 * 로 잘라 얻은 시각 표기일 뿐이다(`new Date` 없이 — 타임존 이동·소요시간 오해 원천 차단).
 */

export type CompareTab = 'planned' | 'actual' | 'change';
export type CompareRowKind = 'actual' | 'unvisited' | 'change';

export interface ActualCompareRow {
  kind: 'actual';
  key: string;
  date: string;
  poiId: string;
  placeLabel: string;
  timeLabel: string;
}

export interface UnvisitedCompareRow {
  kind: 'unvisited';
  key: string;
  date: string;
  poiId: string;
  placeLabel: string;
}

export interface ChangeCompareRow {
  kind: 'change';
  key: string;
  date: string;
  beforeLabel: string;
  afterLabel: string;
  reason: string | null;
  timeLabel: string;
  sourceType: ChangeLogEntrySourceType;
}

export type CompareRow =
  ActualCompareRow | UnvisitedCompareRow | ChangeCompareRow;

/** ISO('...T14:20:00Z') → 'HH:mm'. 16글자 미만·비문자열이면 ''(new Date 금지, INV-3·타임존 안전). */
function toTimeLabel(iso: string | null | undefined): string {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '';
}

export function buildCompareRows(
  record: TripRecord,
  nameByPoi: Record<string, string> = {}
): CompareRow[] {
  const label = (poiId: string): string => nameByPoi[poiId] ?? poiId;
  const rows: CompareRow[] = [];

  for (const day of record?.days ?? []) {
    const date = day?.date ?? '';

    for (const visit of day?.actual ?? []) {
      rows.push({
        kind: 'actual',
        key: `actual#${date}#${visit.poiId}#${visit.visitCheckId}`,
        date,
        poiId: visit.poiId,
        placeLabel: label(visit.poiId),
        timeLabel: toTimeLabel(visit.arrivedAt),
      });
    }

    // 미방문은 서버 목록만 신뢰(재판정 X). poiId 는 planned 조인으로만 얻고, 없으면 slotKey 폴백.
    const planned = day?.planned ?? [];
    for (const slotKey of day?.unvisitedSlotKeys ?? []) {
      const poiId =
        planned.find((p) => p?.slotKey === slotKey)?.poiId ?? slotKey;
      rows.push({
        kind: 'unvisited',
        key: `unvisited#${slotKey}`,
        date,
        poiId,
        placeLabel: label(poiId),
      });
    }
  }

  for (const [index, change] of (record?.changes ?? []).entries()) {
    // 계약이 full 스냅숏만 줘 단건 diff 가 없다 — 첫 슬롯 poiId 로 구조만 잠근다(정확 diff 는 후속).
    const beforePoi = change?.before?.days?.[0]?.slots?.[0]?.poiId;
    const afterPoi = change?.after?.days?.[0]?.slots?.[0]?.poiId;
    rows.push({
      kind: 'change',
      key: `change#${index}#${change?.at ?? ''}`,
      date:
        change?.before?.days?.[0]?.date ?? change?.after?.days?.[0]?.date ?? '',
      beforeLabel: beforePoi !== undefined ? label(beforePoi) : '이전 장소',
      afterLabel: afterPoi !== undefined ? label(afterPoi) : '변경된 장소',
      reason: change?.reason ?? null,
      timeLabel: toTimeLabel(change?.at),
      sourceType: change?.sourceType ?? 'MANUAL',
    });
  }

  return rows;
}
