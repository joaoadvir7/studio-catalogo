const $ = (sel) => document.querySelector(sel);
const results = $("#results");
const toolbar = $("#toolbar");
const statusEl = $("#status");
const pager = $("#pager");
const player = $("#player");

const state = {
  tab: "textures",
  q: "",
  page: 1,
  category: "",
  loadedFonts: new Set(),
  ph: null,
  fonts: null,
};

const PAGE = 24;
const TABS = {
  textures: { hint: "Poly Haven · CC0 · PBR" },
  fonts: { hint: "Google Fonts — preview, CSS e TTF" },
  sfx: { hint: "Internet Archive · efeitos sonoros livres" },
  tracks: { hint: "Internet Archive · trilhas e música livre" },
  images: { hint: "Wikimedia Commons · imagens de apoio" },
  convert: { hint: "Metadados de YouTube + conversão local no navegador" },
};

document.querySelectorAll("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b === btn));
    state.tab = btn.dataset.tab;
    state.page = 1;
    state.q = "";
    state.category = "";
    renderToolbar();
    load();
  });
});
$("#detail-close").addEventListener("click", () => $("#detail").close());

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/"/g, "&" + "quot;")
    .replace(/</g, "&" + "lt;");
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;");
}
function paginate(list, page, size = PAGE) {
  const p = Math.max(1, page | 0);
  const start = (p - 1) * size;
  return {
    page: p,
    pageSize: size,
    total: list.length,
    pageCount: Math.max(1, Math.ceil(list.length / size)),
    items: list.slice(start, start + size),
  };
}
function qmatch(hay, needle) {
  if (!needle) return true;
  return String(hay || "").toLowerCase().includes(needle.toLowerCase());
}
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("falha ao buscar dados (" + res.status + ")");
  return res.json();
}

function renderToolbar() {
  if (state.tab === "convert") {
    toolbar.innerHTML = "";
    return;
  }
  const extra =
    state.tab === "textures" || state.tab === "fonts"
      ? `<select id="category"><option value="">categoria</option></select>`
      : "";
  toolbar.innerHTML = `
    <input id="q" placeholder="buscar..." value="${escapeAttr(state.q)}" />
    ${extra}
    <button id="go" type="button">Buscar</button>
  `;
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchNow();
  });
  $("#go").addEventListener("click", searchNow);
}

function searchNow() {
  state.q = $("#q")?.value || "";
  state.category = $("#category")?.value || "";
  state.page = 1;
  load();
}

function fillCategories(cats) {
  const sel = $("#category");
  if (!sel || sel.dataset.filled) return;
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
  sel.dataset.filled = "1";
  sel.value = state.category;
  sel.addEventListener("change", () => {
    state.category = sel.value;
    state.page = 1;
    load();
  });
}

async function loadPh() {
  if (state.ph) return state.ph;
  const data = await getJson("https://api.polyhaven.com/assets?t=textures");
  const cats = new Set();
  state.ph = Object.entries(data).map(([id, meta]) => {
    (meta.categories || []).forEach((c) => cats.add(c));
    return {
      id,
      source: "polyhaven",
      name: meta.name || id,
      tags: meta.tags || [],
      categories: meta.categories || [],
      thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=400`,
      page: `https://polyhaven.com/a/${id}`,
      license: "CC0",
    };
  });
  state.phCats = [...cats].sort();
  return state.ph;
}

async function loadFonts() {
  if (state.fonts) return state.fonts;
  const data = await getJson(
    "https://cdn.jsdelivr.net/gh/herrstrietzel/fonthelpers@main/json/gfontsAPI.json"
  );
  state.fonts = (data.items || []).map((f) => ({
    family: f.family,
    category: f.category,
    variants: f.variants || [],
    files: f.files || {},
    variable: Array.isArray(f.axes) && f.axes.length > 0,
    css: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}:ital,wght@0,400;0,700;1,400&display=swap`,
    page: `https://fonts.google.com/specimen/${encodeURIComponent(f.family.replace(/ /g, "+"))}`,
  }));
  state.fontCats = [...new Set(state.fonts.map((f) => f.category).filter(Boolean))].sort();
  return state.fonts;
}

async function archiveSearch(q, extra, page) {
  const safe = (q || "").replace(/[:"]/g, " ").trim();
  const query = safe ? `(${extra}) AND (${safe})` : extra;
  const url =
    "https://archive.org/advancedsearch.php?" +
    new URLSearchParams({
      q: query,
      rows: String(PAGE),
      page: String(page || 1),
      output: "json",
    }) +
    "&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads desc";
  const data = await getJson(url);
  const docs = data.response?.docs || [];
  const total = data.response?.numFound || docs.length;
  const items = [];
  await Promise.all(
    docs.map(async (doc) => {
      try {
        const meta = await getJson("https://archive.org/metadata/" + encodeURIComponent(doc.identifier));
        const files = meta.files || [];
        const audio = files.find((f) =>
          /\.(mp3|ogg|wav|flac|m4a)$/i.test(f.name || "") ||
          ["VBR MP3", "MP3", "Ogg Vorbis"].includes(f.format)
        );
        if (!audio) return;
        const preview = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(audio.name)}`;
        items.push({
          id: doc.identifier,
          title: doc.title || meta.metadata?.title || doc.identifier,
          creator: Array.isArray(doc.creator) ? doc.creator[0] : doc.creator || "Internet Archive",
          license: meta.metadata?.licenseurl || "IA",
          preview,
          download: preview,
          page: `https://archive.org/details/${doc.identifier}`,
          source: "archive.org",
        });
      } catch (_) {}
    })
  );
  return {
    page,
    pageSize: PAGE,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE)),
    items,
  };
}

async function wikiImages(q, page) {
  const offset = (Math.max(1, page) - 1) * PAGE;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q || "landscape",
    gsrnamespace: "6",
    gsrlimit: String(PAGE),
    gsroffset: String(offset),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "640",
    format: "json",
    origin: "*",
  });
  const data = await getJson("https://commons.wikimedia.org/w/api.php?" + params);
  const pages = Object.values(data.query?.pages || {});
  const items = pages
    .map((p) => {
      const info = (p.imageinfo || [])[0];
      if (!info) return null;
      const meta = info.extmetadata || {};
      return {
        id: String(p.pageid),
        title: (p.title || "").replace(/^File:/, ""),
        creator: meta.Artist?.value?.replace(/<[^>]+>/g, "") || "Wikimedia",
        license: meta.LicenseShortName?.value || "Commons",
        thumb: info.thumburl || info.url,
        url: info.url,
        page: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(p.title),
        source: "wikimedia",
      };
    })
    .filter(Boolean);
  return { page, pageSize: PAGE, total: items.length + offset + (data.continue ? PAGE : 0), pageCount: data.continue ? page + 1 : page, items };
}

function ytId(input) {
  const s = String(input || "").trim();
  const pats = [
    /(?:v=|vi=)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

async function fetchTab() {
  if (state.tab === "textures") {
    let list = await loadPh();
    if (state.q) {
      list = list.filter(
        (t) =>
          qmatch(t.name, state.q) ||
          t.tags.some((x) => qmatch(x, state.q)) ||
          t.categories.some((x) => qmatch(x, state.q))
      );
    }
    if (state.category) list = list.filter((t) => t.categories.includes(state.category));
    const paged = paginate(list, state.page);
    paged.categories = state.phCats;
    return paged;
  }
  if (state.tab === "fonts") {
    let list = await loadFonts();
    if (state.q) list = list.filter((f) => qmatch(f.family, state.q));
    if (state.category) list = list.filter((f) => f.category === state.category);
    const paged = paginate(list, state.page, 30);
    paged.categories = state.fontCats;
    return paged;
  }
  if (state.tab === "sfx") {
    return archiveSearch(
      state.q || "whoosh",
      'mediatype:audio AND (subject:"sound effect" OR subject:foley OR collection:opensource_audio)',
      state.page
    );
  }
  if (state.tab === "tracks") {
    return archiveSearch(
      state.q || "piano",
      "mediatype:audio AND (collection:netlabels OR collection:musopen OR subject:soundtrack OR subject:instrumental)",
      state.page
    );
  }
  if (state.tab === "images") {
    return wikiImages(state.q || "landscape", state.page);
  }
  return { items: [] };
}

async function load() {
  results.innerHTML = "";
  pager.innerHTML = "";
  results.style.display = "";
  if (state.tab === "convert") {
    statusEl.textContent = TABS.convert.hint;
    renderConvert();
    return;
  }
  statusEl.textContent = "carregando...";
  try {
    const data = await fetchTab();
    statusEl.textContent = `${TABS[state.tab].hint} · ${data.total ?? data.items?.length ?? 0} itens`;
    if (data.categories) fillCategories(data.categories);
    renderItems(data.items || []);
    renderPager(data);
  } catch (err) {
    statusEl.textContent = "erro: " + err.message;
  }
}

function renderItems(items) {
  if (!items.length) {
    results.innerHTML = "<p class='muted'>Nenhum resultado.</p>";
    return;
  }
  if (state.tab === "fonts") {
    items.forEach(ensureFont);
    results.innerHTML = items.map(fontCard).join("");
    results.querySelectorAll("[data-copy]").forEach((b) =>
      b.addEventListener("click", () => navigator.clipboard.writeText(b.dataset.copy))
    );
    return;
  }
  if (state.tab === "sfx" || state.tab === "tracks") {
    results.innerHTML = items.map(audioCard).join("");
    results.querySelectorAll("[data-play]").forEach((b) =>
      b.addEventListener("click", () => play(b.dataset.play))
    );
    return;
  }
  if (state.tab === "images") {
    results.innerHTML = items.map(imageCard).join("");
    return;
  }
  results.innerHTML = items.map(textureCard).join("");
  results.querySelectorAll("[data-detail]").forEach((b) =>
    b.addEventListener("click", () => openTexture(b.dataset.id, b.dataset.name))
  );
}

function textureCard(t) {
  return `<article class="card">
    <img src="${escapeAttr(t.thumb)}" alt="" loading="lazy" />
    <div class="body">
      <h3>${escapeHtml(t.name)}</h3>
      <div class="meta">${escapeHtml((t.categories || []).slice(0, 3).join(", "))} · ${escapeHtml(t.license)}</div>
      <div class="row">
        <button data-detail data-id="${escapeAttr(t.id)}" data-name="${escapeAttr(t.name)}">arquivos</button>
        <a href="${escapeAttr(t.page)}" target="_blank" rel="noopener">página</a>
      </div>
    </div>
  </article>`;
}

function ensureFont(f) {
  if (state.loadedFonts.has(f.family)) return;
  state.loadedFonts.add(f.family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = f.css;
  document.head.appendChild(link);
}

function fontCard(f) {
  const file = f.files.regular || f.files["400"] || Object.values(f.files)[0] || "";
  const css = `@import url('${f.css}');\nfont-family: '${f.family}', ${f.category};`;
  return `<article class="card">
    <div class="swatch" style="font-family:'${escapeAttr(f.family)}', sans-serif">Ag</div>
    <div class="body">
      <h3>${escapeHtml(f.family)}</h3>
      <div class="meta">${escapeHtml(f.category)} · ${f.variants.length} estilos ${f.variable ? "· variável" : ""}</div>
      <div class="row">
        <a href="${escapeAttr(file)}" download>TTF</a>
        <button data-copy="${escapeAttr(css)}">copiar CSS</button>
        <a href="${escapeAttr(f.page)}" target="_blank" rel="noopener">Google Fonts</a>
      </div>
    </div>
  </article>`;
}

function audioCard(a) {
  return `<article class="card">
    <div class="body">
      <h3>${escapeHtml(a.title)}</h3>
      <div class="meta">${escapeHtml(a.creator || a.source)} · ${escapeHtml(a.license || "")}</div>
      <div class="row">
        <button data-play="${escapeAttr(a.preview || "")}">ouvir</button>
        <a href="${escapeAttr(a.download || a.preview)}" target="_blank" rel="noopener">baixar</a>
        <a href="${escapeAttr(a.page)}" target="_blank" rel="noopener">origem</a>
      </div>
    </div>
  </article>`;
}

function imageCard(img) {
  return `<article class="card">
    <img src="${escapeAttr(img.thumb)}" alt="" loading="lazy" />
    <div class="body">
      <h3>${escapeHtml(img.title)}</h3>
      <div class="meta">${escapeHtml(img.creator || img.source)} · ${escapeHtml(img.license || "")}</div>
      <div class="row">
        <a href="${escapeAttr(img.url)}" target="_blank" rel="noopener">arquivo</a>
        <a href="${escapeAttr(img.page)}" target="_blank" rel="noopener">origem</a>
      </div>
    </div>
  </article>`;
}

function renderPager(data) {
  if (!data.pageCount || data.pageCount <= 1) return;
  pager.innerHTML = `
    <button id="prev" ${data.page <= 1 ? "disabled" : ""}>anterior</button>
    <span class="muted">página ${data.page} / ${data.pageCount}</span>
    <button id="next" ${data.page >= data.pageCount ? "disabled" : ""}>próxima</button>
  `;
  $("#prev")?.addEventListener("click", () => {
    state.page -= 1;
    load();
  });
  $("#next")?.addEventListener("click", () => {
    state.page += 1;
    load();
  });
}

async function openTexture(id, name) {
  $("#detail-title").textContent = name || id;
  $("#detail-body").textContent = "carregando arquivos...";
  $("#detail").showModal();
  try {
    const files = await getJson("https://api.polyhaven.com/files/" + encodeURIComponent(id));
    const downloads = [];
    for (const [mapName, resolutions] of Object.entries(files)) {
      if (!resolutions || typeof resolutions !== "object") continue;
      for (const [resName, formats] of Object.entries(resolutions)) {
        if (!formats || typeof formats !== "object") continue;
        for (const [fmt, info] of Object.entries(formats)) {
          if (info && info.url) {
            downloads.push({ map: mapName, resolution: resName, format: fmt, url: info.url, size: info.size || 0 });
          }
        }
      }
    }
    const order = { "1k": 1, "2k": 2, "4k": 3, "8k": 4 };
    downloads.sort((a, b) => (order[a.resolution] || 9) - (order[b.resolution] || 9) || a.map.localeCompare(b.map));
    const rows = downloads
      .slice(0, 80)
      .map(
        (d) => `<tr>
          <td>${escapeHtml(d.map)}</td>
          <td>${escapeHtml(d.resolution)}</td>
          <td>${escapeHtml(d.format)}</td>
          <td>${d.size ? Math.round(d.size / 1024) + " KB" : ""}</td>
          <td><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">baixar</a></td>
        </tr>`
      )
      .join("");
    $("#detail-body").innerHTML = `
      <img src="https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=800" alt="" style="max-width:100%" />
      <p class="meta">licença CC0 · <a href="https://polyhaven.com/a/${encodeURIComponent(id)}" target="_blank" rel="noopener">página oficial</a></p>
      <table>
        <thead><tr><th>mapa</th><th>res</th><th>fmt</th><th>tam</th><th>link</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=5>sem arquivos</td></tr>"}</tbody>
      </table>
    `;
  } catch (err) {
    $("#detail-body").textContent = err.message;
  }
}

function play(url) {
  if (!url) return;
  player.src = url;
  player.style.display = "block";
  player.play();
}

function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytes = len * numCh * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  const writeStr = (o, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = buffer.getChannelData(ch)[i];
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

function renderConvert() {
  results.style.display = "block";
  results.innerHTML = `
    <div class="convert">
      <div class="box">
        <h2>Link do YouTube</h2>
        <p class="warn">Este app não baixa MP3/MP4 do YouTube (viola os termos e direitos autorais). Ele só mostra título, autor e o player oficial.</p>
        <label>URL <input id="yt" placeholder="https://www.youtube.com/watch?v=..." style="width:100%" /></label>
        <button type="button" id="yt-go">obter metadados</button>
        <div id="yt-out"></div>
      </div>
      <div class="box">
        <h2>Conversor local (no navegador)</h2>
        <p class="muted">Arquivo que você já possui. Áudio/vídeo → WAV. Não envia nada a um servidor.</p>
        <form id="conv">
          <input type="file" id="conv-file" accept="audio/*,video/*" required />
          <button type="submit">converter para WAV e baixar</button>
        </form>
        <p id="conv-status" class="muted"></p>
      </div>
    </div>
  `;
  $("#yt-go").addEventListener("click", async () => {
    const url = $("#yt").value;
    const id = ytId(url);
    $("#yt-out").textContent = "consultando...";
    if (!id) {
      $("#yt-out").textContent = "URL do YouTube inválida";
      return;
    }
    const watch = "https://www.youtube.com/watch?v=" + id;
    try {
      const info = await getJson(
        "https://www.youtube.com/oembed?url=" + encodeURIComponent(watch) + "&format=json"
      );
      $("#yt-out").innerHTML = `
        <img src="${escapeAttr(info.thumbnail_url)}" alt="" style="max-width:240px" />
        <h3>${escapeHtml(info.title)}</h3>
        <p class="meta">${escapeHtml(info.author_name)}</p>
        <p><a href="${escapeAttr(watch)}" target="_blank" rel="noopener">abrir no YouTube</a></p>
        <iframe width="360" height="203" src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe>
      `;
    } catch (err) {
      $("#yt-out").textContent = err.message;
    }
  });
  $("#conv").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#conv-file").files[0];
    const status = $("#conv-status");
    if (!file) return;
    status.textContent = "decodificando no navegador...";
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await file.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf.slice(0));
      const blob = encodeWav(audio);
      const a = document.createElement("a");
      const name = file.name.replace(/\.[^.]+$/, "") + ".wav";
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      status.textContent = "concluído: " + name;
    } catch (err) {
      status.textContent = "erro: não foi possível decodificar esse arquivo (" + err.message + ")";
    }
  });
}

renderToolbar();
load();
