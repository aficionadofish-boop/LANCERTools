// 5etools' [–] / [+] on section titles: every .sec inside a .section gets one; the state is
// remembered in this browser (per page and section title).

const KEY = "lancertools.collapsed." + location.pathname.split("/").pop();
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}

for (const sec of document.querySelectorAll(".section > .sec")) {
  const box = sec.parentElement, name = sec.textContent.trim().split(/\s+/)[0];
  const t = document.createElement("span");
  t.className = "toggle";
  t.style.marginLeft = "8px";
  const set = (c) => {
    box.classList.toggle("collapsed", c);
    t.textContent = c ? "[+]" : "[–]";
    t.title = c ? "Show" : "Hide";
  };
  set(!!saved[name]);
  t.onclick = () => {
    const c = !box.classList.contains("collapsed");
    set(c);
    saved[name] = c;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
  };
  sec.append(t);
}
