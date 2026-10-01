// The header every page shares:
//   <header class="topbar" data-page="maps" data-title="Map Maker" data-tagline="How to use it (HTML, <kbd> ok)"></header>

const PAGES = [
  ["index.html", "home", "Home"],
  ["maps.html", "maps", "Map Maker"],
  ["tokens.html", "tokens", "Token Kit"],
  ["stamper.html", "stamper", "Token Stamper"],
];

for (const bar of document.querySelectorAll("header.topbar")) {
  const here = bar.dataset.page;
  const title = bar.dataset.title || "LANCERTools";
  const tagline = bar.dataset.tagline || "A suite of prep tools for LANCER games on Roll20.";
  bar.innerHTML = `<div class="band"><div class="wrap"><a class="brand" href="index.html" title="LANCERTools home">${title}.</a>
    <span class="tagline">${tagline}</span></div></div>
    <div class="wrap"><nav>${PAGES.map(([href, id, label]) =>
      `<a href="${href}"${id === here ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav></div>`;
}
