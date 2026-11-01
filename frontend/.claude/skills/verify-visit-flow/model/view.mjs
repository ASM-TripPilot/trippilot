// 여행 중 방문·Plan-B 모델의 한국어 라벨. 장소 a·b·c 는 오늘 일정의 1·2·3번째 장소다.
const NAME = { a: "A", b: "B", c: "C", d: "D" };
const seq = (s) => Object.keys(s).sort((x, y) => x - y).map((k) => s[k]);

// 허브 카드가 보여 주는 상태(클라이언트 캐시 기준, CODE MIRROR 와 같은 판정).
const cards = (v, which = v.plan) => {
  const plan = seq(which);
  const opt = new Set(v.opt);
  const done = (p) => v.cache[p] === "done";
  const cand = (p) => (v.cache[p] === "open" || opt.has(p)) && !done(p);
  const active = plan.findIndex(cand);
  return plan.map((p, i) => {
    const n = NAME[p];
    if (done(p)) return `${n} 완료`;
    if (i === active) return `${n} 진행 중`;
    if (v.cache[p] === "skipped") return `${n} 건너뜀(예정 칸)`;
    return `${n} 예정`;
  });
};

const SCREEN = { none: "허브", applied: "허브(재계획 반영)", solving: "재계획 진행", draft: "재계획안" };

export const state = (v) => {
  const pending = v.hub.k !== "none" || v.cmp !== "-" || v.skp !== "-" ? " · 응답 기다림" : "";
  const open = Object.values(v.srv).filter((s) => s === "open").length;
  const srvNote = open > 1 ? ` · 서버에 진행 중 ${open}곳` : "";
  const shown = v.rp === "draft" ? cards(v, v.draft) : cards(v);
  return `${SCREEN[v.rp]}: ${shown.join(" · ") || "(빈 일정)"}${pending}${srvNote}`;
};

export const group = (v) => (v.rp === "solving" || v.rp === "draft" ? "재계획" : v.rp === "applied" ? "반영 뒤" : "허브");
export const colors = { 허브: "blue", 재계획: "orange", "반영 뒤": "purple" };
export const title = "여행 중 방문 체크와 Plan-B 재계획";

export const step = (action, from, to) => {
  switch (action) {
    case "YouPressArrive":
    case "PressArrive":
      return to.hub.k === "chainC"
        ? `${NAME[to.hub.to]} [도착]을 누른다 [진행 중인 ${NAME[to.hub.from]} 완료부터]`
        : `${NAME[to.hub.to]} [도착]을 누른다`;
    case "ChainCompleteOk": return `${NAME[from.hub.from]} 완료가 기록되고 ${NAME[from.hub.to]} 도착을 보낸다`;
    case "ChainCompleteNetFail": return "앞 장소 완료가 네트워크로 실패한다";
    case "ChainCompleteRejected": return "서버가 앞 장소 완료를 거절한다(409)";
    case "ArriveOk": return `${NAME[from.hub.to]} 도착이 기록된다`;
    case "ArriveNetFail": return "도착이 네트워크로 실패한다";
    case "ArriveRejected": return "서버가 도착을 거절한다(409) — 「도착을 기록하지 못했어요」";
    case "PressComplete": return `${NAME[to.cmp]} [방문 완료]를 누른다`;
    case "CompleteOk": return "완료가 기록된다";
    case "CompleteFail": return "완료가 실패한다(네트워크)";
    case "YouSkipInJ01":
    case "J01Skip": return `기록 화면에서 ${NAME[to.skp]} 「건너뛰기」를 확정한다`;
    case "SkipOk": return "건너뜀이 기록된다";
    case "SkipFail": return "건너뛰기가 실패한다";
    case "Refetch": return "그날 방문 기록을 다시 받는다";
    case "RequestReplan": return "「AI에게 맡기기」로 재계획을 요청한다";
    case "ServerDraft": return "재계획안이 나온다";
    case "ServerNoDraft": return "대안 없음·실패 — 원 일정 그대로";
    case "Leave": return "「나가기」";
    case "Apply": return "「적용하기」";
    default: return action;
  }
};
