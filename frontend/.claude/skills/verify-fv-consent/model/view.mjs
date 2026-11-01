// 동의 토글(위치 l06 · 개인화) + 위치 권한 미러 모델의 한국어 라벨. 기기 = 앱·웹(같은 계정).
const DEV = { app: "앱", web: "웹" };
const KIND = { loc: "위치", pers: "개인화" };
const ONOFF = { on: "켜짐", off: "꺼짐", none: "모름", hidden: "토글 없음" };

const shown = (v, d, k) => {
  const x = v.data[d][k];
  if (k === "loc") return v.err[d][k] || x === "none" ? "hidden" : x;
  return x === "none" ? "off" : x;
};
const reqs = (v) => Object.values(v.req);
const inflight = (v) => reqs(v).some((r) => r.ph === "send" || r.ph === "refetch") || Object.values(v.mp).some(Boolean) || Object.values(v.lf).some(Boolean);

export const state = (v) => {
  const srv = Object.keys(KIND).map((k) => `${KIND[k]} ${v.srv[k] ? "동의" : "미동의"}`).join("·");
  const screens = Object.keys(DEV)
    .map((d) => `${DEV[d]}(${Object.keys(KIND).map((k) => `${KIND[k]} ${ONOFF[shown(v, d, k)]}`).join("·")})`)
    .join(" ");
  const flags = [inflight(v) ? "응답 기다림" : null, Object.values(v.dup).some(Boolean) ? "같은 증적 2번" : null].filter(Boolean);
  return `서버 ${srv} · 미러 ${v.mir} | ${screens}${flags.length ? " · " + flags.join(" · ") : ""}`;
};

export const group = (v) => (inflight(v) ? "요청 중" : "한가");
export const colors = { "요청 중": "orange", 한가: "blue" };
export const title = "동의 토글과 법적 동의 기록 (앱과 웹, 같은 계정)";

const who = (r) => `${DEV[r.d]} ${KIND[r.k]}`;
const changed = (from, to) => Object.keys(to.req).find((i) => from.req[i].ph !== to.req[i].ph);
const changedDev = (from, to, f) => Object.keys(to[f]).find((d) => JSON.stringify(from[f][d]) !== JSON.stringify(to[f][d]));

export const step = (action, from, to) => {
  const i = changed(from, to);
  const r = i ? to.req[i] : null;
  switch (action) {
    case "YouTap":
    case "Tap":
      return `${who(r)} 토글을 누른다 → ${r.v ? "승낙" : "철회"} 요청`;
    case "YouEnter":
    case "Enter": return `${DEV[changedDev(from, to, "mounted")]}에서 위치 동의 화면에 들어간다`;
    case "YouLeave":
    case "Leave": return `${DEV[changedDev(from, to, "mounted")]}에서 위치 동의 화면을 나간다`;
    case "FetchConsent":
    case "Load": return "동의 상태를 다시 받는다";
    case "ServerSaves":
    case "ServerSavesReplyLost":
    case "ServerApply":
      return r.ph === "done" ? `서버가 ${who(r)} 요청을 저장했는데 응답이 끊긴다` : `서버가 ${who(r)} 요청을 저장한다`;
    case "SaveFails":
    case "SendFail": return `${who(r)} 요청이 서버에 닿기 전에 실패한다`;
    case "RefetchArrives":
    case "RefetchOk": return `${who(r)} 저장 뒤 다시 받기가 끝난다`;
    case "RefetchFails":
    case "RefetchFail": return `${who(r)} 저장 뒤 다시 받기가 실패한다`;
    case "MirrorReported":
    case "MirrorOk": return `${DEV[changedDev(from, to, "mp")]} 위치 권한(${to.mir})이 서버에 보고된다`;
    case "MirrorReportFails":
    case "MirrorFail": return "위치 권한 보고가 실패한다";
    default: return action;
  }
};
