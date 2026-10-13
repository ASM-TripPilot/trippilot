import type { AutoQueueItem } from './autoEventQueue';
import type { RawSample } from './routeDistance';
import type { JudgeState } from './visitJudge';

/**
 * TRIP-1338 · 기기 로컬 저장소 (NFR LC-U10-4 AutomationStore · P-STORE-U10-1~4).
 *
 * - 파일 I/O 는 `StoreFs` 뒤에 가둔다 — 실물은 expo-file-system(`expoFs.ts`, 캐시 디렉토리 U10 전용 폴더),
 *   테스트·프리뷰는 `createMemoryFs()`.
 * - 상태는 A/B 두 슬롯에 세대 번호와 함께 번갈아 쓴다(원자 rename 에 기대지 않는다). 읽을 때 파싱되는
 *   것 중 세대가 큰 쪽을 고른다 — 마지막 쓰기가 찢겨도 직전 세대가 남는다.
 * - 읽기 자체가 throw 하면(잠금 상태 wake) `readable:false` — 그 wake 에서는 쓰지 않는다(덮어쓰기 방지).
 * - 원시 표본은 날짜별 파일(기기 밖으로 안 나간다, BR-U10-35). 삭제는 폴더째(`wipe`).
 *
 * 좌표는 원시 표본 파일에만 있다 — 상태 파일·로그·Sentry 로 새지 않는다(SEC-U10-05).
 */

export interface AutomationSlotRef {
  slotKey: string;
  poiId: string;
  lat: number | null;
  lng: number | null;
}

export interface AutomationVisitRef {
  slotKey: string;
  status: 'arrived' | 'completed' | 'skipped' | 'suppressed';
  at: number;
}

/** 포그라운드가 기록하는 유일한 문맥 — 백그라운드 wake 는 이것만 보고 판단한다. */
export interface AutomationContext {
  tripId: string;
  startDate: string;
  endDate: string;
  /** 여행지(KST) 기준 오늘. */
  date: string;
  consentOn: boolean;
  /** 오늘 계획 순번 슬롯. */
  slots: AutomationSlotRef[];
  /** 오늘 서버 실적(서버 우선 — judge 에 external 로 반영). */
  visits: AutomationVisitRef[];
}

export interface OpenInterval {
  intervalId: string;
  kind: 'GEOFENCE_ARMED' | 'ROUTE_RECORDING';
  startedAt: string;
}

export interface AutomationNotice {
  kind: 'degraded' | 'route-expired';
  reason: string;
}

export interface AutomationState {
  ctx: AutomationContext | null;
  judge: { date: string; state: JudgeState } | null;
  queue: AutoQueueItem[];
  explainerAskedTrips: string[];
  intervals: OpenInterval[];
  notice: AutomationNotice | null;
  droppedCount: number;
  /** 서버 킬 스위치 직전 값(NFR 델타 4). */
  serverEnabled: boolean;
  /** 원시 표본이 남아 있는 날짜(업로드 대기). */
  rawDates: string[];
}

export const EMPTY_STATE: AutomationState = {
  ctx: null,
  judge: null,
  queue: [],
  explainerAskedTrips: [],
  intervals: [],
  notice: null,
  droppedCount: 0,
  serverEnabled: true,
  rawDates: [],
};

export interface StoreFs {
  read(name: string): string | null;
  write(name: string, text: string): void;
  remove(name: string): void;
  wipe(): void;
}

const SLOT_FILES = ['state-a.json', 'state-b.json'] as const;

interface Envelope {
  gen: number;
  state: AutomationState;
}

function parseEnvelope(text: string | null): Envelope | null {
  if (text == null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Envelope>;
    if (typeof parsed.gen !== 'number' || !parsed.state) return null;
    return { gen: parsed.gen, state: { ...EMPTY_STATE, ...parsed.state } };
  } catch {
    return null;
  }
}

/** 두 슬롯 중 파싱되는 최신 세대. 둘 다 없으면 EMPTY, 있는데 둘 다 깨졌으면 RESET. */
export function pickLatest(
  a: string | null,
  b: string | null
): Envelope | 'EMPTY' | 'RESET' {
  const ea = parseEnvelope(a);
  const eb = parseEnvelope(b);
  if (!ea && !eb) return a == null && b == null ? 'EMPTY' : 'RESET';
  if (!ea) return eb as Envelope;
  if (!eb) return ea;
  return eb.gen > ea.gen ? eb : ea;
}

export interface AutomationStore {
  load(): { state: AutomationState; readable: boolean };
  save(state: AutomationState): void;
  readRaw(date: string): RawSample[];
  writeRaw(date: string, samples: readonly RawSample[]): void;
  removeRaw(date: string): void;
  wipe(): void;
}

export function createAutomationStore(fs: StoreFs): AutomationStore {
  let gen = 0;
  let readable = true;
  const rawName = (date: string) => `raw-${date}.json`;

  return {
    load() {
      let texts: (string | null)[];
      try {
        texts = SLOT_FILES.map((f) => fs.read(f));
      } catch {
        readable = false;
        return { state: EMPTY_STATE, readable };
      }
      readable = true;
      const picked = pickLatest(texts[0], texts[1]);
      if (picked === 'EMPTY' || picked === 'RESET') {
        gen = 0;
        return { state: EMPTY_STATE, readable };
      }
      gen = picked.gen;
      return { state: picked.state, readable };
    },
    save(state) {
      if (!readable) return; // 잠금 wake — 덮어쓰지 않는다
      gen += 1;
      fs.write(SLOT_FILES[gen % 2], JSON.stringify({ gen, state }));
    },
    readRaw(date) {
      try {
        const text = fs.read(rawName(date));
        return text ? (JSON.parse(text) as RawSample[]) : [];
      } catch {
        return [];
      }
    },
    writeRaw(date, samples) {
      if (!readable) return;
      fs.write(rawName(date), JSON.stringify(samples));
    },
    removeRaw(date) {
      fs.remove(rawName(date));
    },
    wipe() {
      fs.wipe();
      gen = 0;
    },
  };
}

/** 메모리 파일 시스템 — 테스트·프리뷰·가짜 실행용. */
export function createMemoryFs(): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (name) => files.get(name) ?? null,
    write: (name, text) => {
      files.set(name, text);
    },
    remove: (name) => {
      files.delete(name);
    },
    wipe: () => files.clear(),
  };
}

let chain: Promise<unknown> = Promise.resolve();

/** 포그라운드·백그라운드 공통 단일 작성자 — 저장소 접근을 한 줄로 세운다(P-BG-U10-5). */
export function withStore<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
