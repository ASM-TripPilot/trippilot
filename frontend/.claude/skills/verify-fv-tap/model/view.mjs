// 연타 잠금 모델의 한국어 라벨. 한 틱 = 100ms. 경로 이름은 cfg 의 Path.
const ms = (t) => `${t * 100}ms`;

const SURFACE = { src: "누른 화면", next: "바뀐 화면", after: "바뀐 화면 버튼까지 누름" };

export const state = (v) => {
  const pend = v.inflight.length > 0 ? ` · 응답 기다림 ${v.inflight.length}건` : "";
  const ok = v.srvOk ? " · 서버 반영됨" : "";
  const note = v.note ? " · 실패 안내 보임" : "";
  return `${SURFACE[v.surface]}${pend}${ok}${note}`;
};

export const group = (v) => (v.surface === "src" ? "누른 화면" : "바뀐 화면");
export const colors = { "누른 화면": "blue", "바뀐 화면": "purple" };
export const title = "버튼 연타와 400ms 창";

export const step = (action, from, to) => {
  switch (action) {
    case "YouTap":
      return to.sent > from.sent
        ? `버튼을 누른다(${ms(from.now)}) — ${to.surface !== from.surface ? "이동" : "요청이 나간다"}`
        : `버튼을 누른다(${ms(from.now)}) — 잠금에 막힘`;
    case "YouTapNext": return `바뀐 화면의 버튼을 누른다(${ms(from.now)})`;
    case "ServerAccepts": return `서버가 받아들인다(${ms(from.now)})`;
    case "ServerRejects": return `서버가 거절한다 409(${ms(from.now)})`;
    case "NetworkFails": return `네트워크로 실패한다(${ms(from.now)})`;
    case "TimePasses": return "100ms 지난다";
    case "Done": return "끝";
    default: return action;
  }
};
