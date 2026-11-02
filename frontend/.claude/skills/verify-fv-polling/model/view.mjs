// 일정 생성 폴링 모델의 한국어 라벨 — /statechart 가 읽는다.
const SCREEN = { Entry: "진입 화면", Gen: "생성 중 화면", Obs: "생성 중 화면(관찰)", Draft: "초안", Away: "홈" };
const ROW = { None: "없음", Old: "예전 완성본", Partial: "1일차만(만드는 중)", Complete: "완성", Failed: "실패", NoData: "비어 있음" };

const posts = (v) => Object.values(v.post).filter((p) => p.cli !== "idle");
// MaxPoll 은 cfg 값(2) — 상한 도달 여부만 라벨에 쓴다.
const MAX_POLL = 2;
const draftFace = (v) => {
  const capped = v.polls >= MAX_POLL;
  if (v.cache.st === "NoData") return v.err ? "실패" : "불러오는 중";
  if (v.cache.st === "Partial") return v.err || capped ? "「만드는 중」 카드 + 실패 안내·[다시 시도]" : "「만드는 중」 카드";
  if (v.cache.run) return !v.err && !capped ? "불러오는 중(다시 만드는 중)" : "결과 + 실패 안내";
  if (v.cache.st === "Failed" || v.err) return "결과 + 실패 안내";
  return v.cache.st === "Old" ? "예전 일정을 완성본으로" : "완성된 일정";
};

export const state = (v) => {
  let face;
  if (v.scr === "Gen") face = v.post[v.top].cli === "err" ? "실패 얼굴" : "진행 중";
  else if (v.scr === "Draft") face = draftFace(v);
  else if (v.scr === "Obs") face = v.err ? "실패 얼굴" : "진행 중";
  else face = "";
  const waiting = posts(v).filter((p) => p.cli === "waiting").length;
  const extra = [];
  if (waiting > 0) extra.push(`생성 요청 ${waiting}건 대기`);
  if (v.get.ph !== "none") extra.push("일정 조회 중");
  if (v.stale) extra.push("다시 물어야 함");
  if (v.sent > v.intents) extra.push(`누름 ${v.intents}번에 요청 ${v.sent}건`);
  extra.push(`서버: ${ROW[v.row.st]}`);
  return `${SCREEN[v.scr]}${face ? ` — ${face}` : ""} · ${extra.join(" · ")}`;
};

export const group = (v) => (v.scr === "Draft" ? "초안" : v.scr === "Gen" || v.scr === "Obs" ? "생성 중" : "그 밖");
export const colors = { "생성 중": "orange", 초안: "blue", "그 밖": "purple" };
export const title = "AI 일정 생성과 폴링";

export const step = (action, from, to) => {
  switch (action) {
    case "PressStart": return "「다음」으로 생성을 시작한다";
    case "PressRegenerate": return "초안에서 [다시 짜기]";
    case "PressRetry": return "[다시 시도]를 누른다";
    case "EchoTap": return "화면이 바뀌기 전에 같은 버튼을 한 번 더 친다";
    case "Leave": return "‹ 로 홈에 나간다";
    case "Return": return "홈 카드로 다시 연다";
    case "Reload": return from.scr === "Gen" && to.scr === "Obs" ? "브라우저 새로고침(주소에 mode 없음 — 관찰 모드)" : "브라우저 새로고침";
    case "ServePost": return "서버가 생성 요청을 받아 AI 를 돌린다";
    case "CommitPost": return "서버가 1일차를 저장한다";
    case "FailPostServer": return "서버의 1일차 생성이 실패한다";
    case "PostOk": return "생성 응답(1일차)이 도착한다";
    case "PostErr": return "생성 요청이 실패한다";
    case "StartGet": return "일정을 다시 묻는다";
    case "ServeGet": return "서버가 일정을 읽는다";
    case "GetOk": return "일정 응답이 도착한다";
    case "GetFail": return "일정 조회가 실패한다";
    case "SecondPhaseDone": return to.row.st === "Complete" ? "나머지 일차가 완성된다" : "나머지 일차 생성이 실패한다";
    case "Sweep": return "서버가 멈춘 생성을 실패로 닫는다";
    default: return action;
  }
};
