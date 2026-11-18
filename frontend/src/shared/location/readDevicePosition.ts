import * as Location from 'expo-location';

/** 권한 조회부터 측위까지 합산 한도 — 넘으면 포기하고 늦게 온 좌표는 버린다(TRIP-979 Seed Q2). */
const TIMEOUT_MS = 5_000;
/** `ask` 일 때의 한도 — 사람이 권한 창에 답하는 시간까지 넣는다(웹 도우미 날씨 첫 질문, 2026-11-08). */
const ASK_TIMEOUT_MS = 20_000;
/** 캐시 위치 신선도 한도 — 5분보다 오래된 lastKnown 은 쓰지 않는다(Seed Q1). */
const LAST_KNOWN_MAX_AGE_MS = 300_000;

async function readOnce(
  ask: boolean
): Promise<{ lat: number; lng: number } | null> {
  // 조회만 한다 — 권한 팝업(request)은 `ask` 이고 아직 안 정했을 때만 띄운다. 웹은 거부해도 canAskAgain 이
  // true 라(expo-location 웹 구현) 그 값으로 가르면 거부한 사람에게 매번 묻는다 — 상태로 가른다.
  let permission = await Location.getForegroundPermissionsAsync();
  if (ask && permission.status === Location.PermissionStatus.UNDETERMINED) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) return null;
  const position =
    (await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
    })) ??
    // Android 에서 기기 위치가 꺼져 있어도 시스템 설정 대화상자를 띄우지 않는다(다시 묻지 않음, Seed Q4).
    (await Location.getCurrentPositionAsync({
      mayShowUserSettingsDialog: false,
    }));
  if (!position) return null;
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/**
 * 단말 위치를 1회 읽는다(권한 조회 → 5분 이내 lastKnown → current). 권한 없음·실패·한도 초과는
 * 전부 `null` 로 resolve 한다 — 호출부를 막지 않는다(reject 하지 않음).
 *
 * `ask` 면 권한을 아직 안 정한 단말에만 권한 창을 한 번 띄우고 한도를 20초로 늘린다. 인자 없이 부르면 묻지 않는다.
 */
export async function readDevicePosition({
  ask = false,
}: { ask?: boolean } = {}): Promise<{
  lat: number;
  lng: number;
} | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ask ? ASK_TIMEOUT_MS : TIMEOUT_MS);
  });
  try {
    return await Promise.race([readOnce(ask).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
