// Two draggable edges: the agent rail and the list pane of each lens (list | detail).
// Each edge has one real handle element (fixed, 14px wide, centered on the edge) that is kept
// in place as the page re-renders. Its cursor comes from CSS, so it does not flicker, and the
// pointer is captured while dragging. The widths live in CSS variables on <html>.
const RZ_KEY = "agent-dash.widths";
const RZ_LIMITS = { "--rail-w": [200, 440], "--list-w": [260, 640] };
const RZ_TARGETS = [
  { selector: ".rail", name: "--rail-w", usable: () => !document.querySelector(".concept-a.rail-folded") && innerWidth > 980 },
  { selector: ".split > .pane-list", name: "--list-w", usable: () => innerWidth > 860 },
];

const rzClamp = (name, px) => Math.min(RZ_LIMITS[name][1], Math.max(RZ_LIMITS[name][0], Math.round(px)));

function rzSaved() {
  try {
    return JSON.parse(localStorage.getItem(RZ_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function rzRemember(name, px) {
  try {
    localStorage.setItem(RZ_KEY, JSON.stringify({ ...rzSaved(), [name]: px }));
  } catch {
    // storage unavailable: the width only lasts until reload
  }
}

function rzHandle(target) {
  const el = document.createElement("div");
  el.className = "rz-handle";
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "vertical");
  el.hidden = true;
  el.addEventListener("pointerdown", (event) => {
    const edge = document.querySelector(target.selector);
    if (!edge) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    el.classList.add("on");
    document.documentElement.classList.add("rz-dragging");
    const left = edge.getBoundingClientRect().left;
    const move = (e) => {
      document.documentElement.style.setProperty(target.name, `${rzClamp(target.name, e.clientX - left)}px`);
      rzPlace();
    };
    const stop = () => {
      el.classList.remove("on");
      document.documentElement.classList.remove("rz-dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
      const px = parseInt(getComputedStyle(document.documentElement).getPropertyValue(target.name), 10);
      if (Number.isFinite(px)) rzRemember(target.name, px);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  });
  document.body.appendChild(el);
  return el;
}

let rzHandles = [];
let rzQueued = false;

function rzPlace() {
  rzHandles.forEach(({ el, target }) => {
    const edge = document.querySelector(target.selector);
    if (!edge || !target.usable()) {
      el.hidden = true;
      return;
    }
    const box = edge.getBoundingClientRect();
    el.hidden = false;
    el.style.left = `${box.right - 7}px`;
    el.style.top = `${box.top}px`;
    el.style.height = `${box.height}px`;
  });
}

function rzSchedule() {
  if (rzQueued) return;
  rzQueued = true;
  requestAnimationFrame(() => {
    rzQueued = false;
    rzPlace();
  });
}

// Scrollbars appear while an element scrolls and fade out shortly after.
const rzTimers = new WeakMap();
function rzScrolling() {
  document.addEventListener("scroll", (event) => {
    const el = event.target instanceof Element ? event.target : document.documentElement;
    el.classList.add("is-scrolling");
    clearTimeout(rzTimers.get(el));
    rzTimers.set(el, setTimeout(() => el.classList.remove("is-scrolling"), 900));
  }, { capture: true, passive: true });
}

function rzInstall() {
  rzScrolling();
  const stored = rzSaved();
  for (const name of Object.keys(RZ_LIMITS)) {
    if (typeof stored[name] === "number") document.documentElement.style.setProperty(name, `${rzClamp(name, stored[name])}px`);
  }
  rzHandles = RZ_TARGETS.map((target) => ({ target, el: rzHandle(target) }));
  // The views are redrawn from scratch: put the handles back whenever the page changes.
  new MutationObserver(rzSchedule).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", rzSchedule);
  rzSchedule();
}
