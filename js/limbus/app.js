(() => {
  // ════════════════════════════════════════════════
  // 저장소 계층 — 원래 Flask 백엔드(/api/*) 대신, TheCFG는 정적
  // 사이트(Netlify)이므로 브라우저 localStorage에 데이터를 보관한다.
  // 최초 실행 시 번들된 기본 인격/용어사전 데이터로 부트스트랩하고,
  // 이후로는 이 브라우저(기기)에 저장된 내용을 계속 사용한다.
  // 이미지 업로드는 서버가 없으므로 base64 data URL로 변환해 그대로
  // JSON 안에 담는다 (내보내기 JSON에도 그대로 포함됨).
  // ════════════════════════════════════════════════
  const LS_IDENTITIES = "thecfg-limbus-identities";
  const LS_VOCAB = "thecfg-limbus-vocab";
  const LS_BOOTSTRAPPED = "thecfg-limbus-bootstrapped";

  function lsGetJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function lsSetJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function bootstrapData() {
    if (localStorage.getItem(LS_BOOTSTRAPPED)) return;
    try {
      const [identitiesRes, vocabRes] = await Promise.all([
        fetch("/js/limbus/data/identities.json"),
        fetch("/js/limbus/data/vocab.json"),
      ]);
      const identitiesMap = identitiesRes.ok ? await identitiesRes.json() : {};
      const vocabData = vocabRes.ok ? await vocabRes.json() : { triggers: [], keywords: [] };
      lsSetJSON(LS_IDENTITIES, identitiesMap);
      lsSetJSON(LS_VOCAB, vocabData);
    } catch {
      // 오프라인 등으로 기본 데이터를 불러오지 못해도 빈 상태로 계속 진행
      if (!lsGetJSON(LS_IDENTITIES, null)) lsSetJSON(LS_IDENTITIES, {});
      if (!lsGetJSON(LS_VOCAB, null)) lsSetJSON(LS_VOCAB, { triggers: [], keywords: [] });
    }
    localStorage.setItem(LS_BOOTSTRAPPED, "1");
  }

  function safeSlug(name) {
    let slug = name.trim().replace(/ /g, "_").replace(/:/g, "-");
    slug = slug.replace(/[^\w\-\[\]가-힣.]/g, "");
    return slug || "identity";
  }

  // ---------- local "API" (동일한 형태의 응답을 흉내내는 로컬 함수들) ----------
  const localApi = {
    async listIdentities() {
      const map = lsGetJSON(LS_IDENTITIES, {});
      return Object.entries(map)
        .map(([id, data]) => ({
          id,
          name: data.name || id,
          sinner: data.sinner || "",
          rank: data.rank || "",
          season: data.season || "",
          thumbnail: (data.images || {}).sd_after || (data.images || {}).sd_before,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async getIdentity(id) {
      const map = lsGetJSON(LS_IDENTITIES, {});
      return map[id] || null;
    },
    async saveIdentity(payload) {
      const name = (payload.name || "").trim();
      if (!name) return { error: "name is required" };
      const requestedId = payload._id;
      const newId = safeSlug(name);
      const map = lsGetJSON(LS_IDENTITIES, {});
      if (requestedId && requestedId !== newId) delete map[requestedId];
      const clean = { ...payload };
      delete clean._id;
      map[newId] = clean;
      lsSetJSON(LS_IDENTITIES, map);
      return { id: newId };
    },
    async deleteIdentity(id) {
      const map = lsGetJSON(LS_IDENTITIES, {});
      delete map[id];
      lsSetJSON(LS_IDENTITIES, map);
      return { ok: true };
    },
    async getVocab() {
      return lsGetJSON(LS_VOCAB, { triggers: [], keywords: [] });
    },
    async addVocabKeyword(value) {
      const data = lsGetJSON(LS_VOCAB, { triggers: [], keywords: [] });
      if (!data.keywords.includes(value)) data.keywords.push(value);
      lsSetJSON(LS_VOCAB, data);
      return data;
    },
    async removeVocabKeyword(value) {
      const data = lsGetJSON(LS_VOCAB, { triggers: [], keywords: [] });
      data.keywords = data.keywords.filter((v) => v !== value);
      lsSetJSON(LS_VOCAB, data);
      return data;
    },
    async uploadImage(file) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      return { path: dataUrl };
    },
  };

  const emptyLines = () => ({ lines: [] }); // {lines: [{trigger:"", text:""}]}

  const emptyIdentity = () => ({
    _id: null,
    name: "", get_script: "", synchro_script: "",
    hp: "", speed: "", defense: "", slash: "", pierce: "", blunt: "",
    sinner: "", season: "", rank: "", release: "", ticket: "", howtoget: "",
    keywords: [],
    synchro1: emptyLines(), synchro2: emptyLines(), synchro3: emptyLines(),
    staggers: ["", "", ""],
    images: [],   // [{label, path}]
    skills: [],    // [{key,name,coins,attack,type,sin,amount,power,coin_power,weight,script:{lines},image,coineffects:[{coin,lines}]}]
    passives: [],   // [{name, content, resources:[{key,val}]}]
    sppassives: [],
    panic_category: "", panic_script: "",
    sanity_increase: "", sanity_decrease: "",
  });

  let current = emptyIdentity();
  let identities = [];
  let saveTimer = null;
  let vocab = { triggers: [], keywords: [] };

  // ---------- helpers ----------
  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (o[key] == null) o[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      o = o[key];
    }
    o[parts[parts.length - 1]] = value;
  }
  function setStatus(text) {
    const el = document.getElementById("save-status");
    el.textContent = text;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (el.textContent = ""), 2500);
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  // ---------- vocabulary (fixed triggers + editable keywords) ----------
  async function loadVocab() {
    vocab = await localApi.getVocab();
    renderTriggerOptions();
    renderVocabModal();
  }
  function renderTriggerOptions() {
    const dl = document.getElementById("trigger-options");
    dl.innerHTML = vocab.triggers.map(t => `<option value="${escapeHtml(t)}">`).join("");
  }
  function renderVocabModal() {
    // triggers: fixed reference list, read-only (no add/remove in UI)
    const trigWrap = document.getElementById("vocab-triggers");
    trigWrap.innerHTML = vocab.triggers.map(t =>
      `<span class="tag-chip" style="background:var(--panel-2);color:var(--gold);">${escapeHtml(t)}</span>`
    ).join("");

    // keywords: user-editable
    const kwWrap = document.getElementById("vocab-keywords");
    kwWrap.innerHTML = "";
    vocab.keywords.forEach(k => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.innerHTML = `${escapeHtml(k)} <button type="button">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => removeVocab("keywords", k));
      kwWrap.appendChild(chip);
    });
  }
  async function addVocab(type, value) {
    if (type !== "keywords" || !value.trim()) return;
    vocab = await localApi.addVocabKeyword(value.trim());
    renderTriggerOptions();
    renderVocabModal();
    refreshAllPreviews();
  }
  async function removeVocab(type, value) {
    if (type !== "keywords") return;
    vocab = await localApi.removeVocabKeyword(value);
    renderTriggerOptions();
    renderVocabModal();
    refreshAllPreviews();
  }

  // keyword matching: longest-match-first, non-overlapping scan over plain text
  function matchKeywordSegments(text) {
    if (!text) return [];
    const terms = [...vocab.keywords].filter(Boolean).sort((a, b) => b.length - a.length);
    const segments = [];
    let i = 0;
    while (i < text.length) {
      let hit = null;
      for (const term of terms) {
        if (term && text.startsWith(term, i)) { hit = term; break; }
      }
      if (hit) {
        segments.push({ type: "keyword", value: hit });
        i += hit.length;
      } else {
        if (segments.length && segments[segments.length - 1].type === "text") {
          segments[segments.length - 1].value += text[i];
        } else {
          segments.push({ type: "text", value: text[i] });
        }
        i++;
      }
    }
    return segments;
  }
  function renderPreviewHtml(text) {
    const segs = matchKeywordSegments(text);
    return segs.map(s => s.type === "keyword"
      ? `<mark class="mk-keyword">${escapeHtml(s.value)}</mark>`
      : escapeHtml(s.value)
    ).join("");
  }

  // ---------- line-block script model ----------
  // A "script field" is {lines: [{trigger, text}]}. trigger === "" means a free-text line.
  function linesToPlainText(state) {
    return state.lines.map(l => (l.trigger ? `[${l.trigger}] ${l.text}` : l.text)).join("\n");
  }
  function linesToBlocks(state) {
    return state.lines.map(l => ({ trigger: l.trigger || "", segments: matchKeywordSegments(l.text) }));
  }
  function autoParseLines(text) {
    if (!text) return [];
    const matches = [...text.matchAll(/\[([^\[\]]{1,24})\]/g)];
    if (!matches.length) {
      return text.split(/\n+/).map(s => s.trim()).filter(Boolean).map(t => ({ trigger: "", text: t }));
    }
    const out = [];
    const firstIdx = matches[0].index;
    if (firstIdx > 0) {
      const pre = text.slice(0, firstIdx).trim();
      if (pre) pre.split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(t => out.push({ trigger: "", text: t }));
    }
    for (let i = 0; i < matches.length; i++) {
      const trigger = matches[i][1].trim();
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      out.push({ trigger, text: text.slice(start, end).trim() });
    }
    return out;
  }
  function blocksToLines(blocks) {
    return (blocks || []).map(b => ({
      trigger: b.trigger || "",
      text: (b.segments || []).map(s => s.value).join(""),
    }));
  }
  // load a script field, preferring saved structured blocks over re-parsing plain text
  function loadScriptField(plainText, blocksData) {
    if (Array.isArray(blocksData) && blocksData.length) return { lines: blocksToLines(blocksData) };
    return { lines: autoParseLines(plainText || "") };
  }

  // ---- line editor component (reused for synchro / skill script / coin effects) ----
  function renderLineEditor(container, state) {
    container.innerHTML = "";
    const list = document.createElement("div");
    list.className = "line-editor";
    state.lines.forEach((line, i) => list.appendChild(renderLineRow(line, i, state, container)));
    container.appendChild(list);

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "8px";
    btnRow.style.marginTop = "4px";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-add small";
    addBtn.textContent = "＋ 줄 추가";
    addBtn.addEventListener("click", () => {
      state.lines.push({ trigger: "", text: "" });
      renderLineEditor(container, state);
    });
    btnRow.appendChild(addBtn);

    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "btn btn-ghost small";
    pasteBtn.textContent = "원문 붙여넣어 자동 분해";
    pasteBtn.addEventListener("click", () => {
      const raw = prompt("나무위키 등에서 복사한 원문을 붙여넣으세요. 기존 줄 뒤에 추가됩니다.");
      if (raw && raw.trim()) {
        state.lines.push(...autoParseLines(raw));
        renderLineEditor(container, state);
      }
    });
    btnRow.appendChild(pasteBtn);

    btnRow.appendChild(buildDefInsertWidget((line) => {
      state.lines.push(line);
      renderLineEditor(container, state);
    }));

    container.appendChild(btnRow);
    container._linesState = state; // for refreshAllPreviews
  }

  // ---- 트리거/효과 함수 검색·삽입 위젯 (HOI4Editor의 _makeAddBtn 패턴 이식) ----
  // onInsert({trigger, text}) 콜백으로 완성된 줄 하나를 넘겨준다.
  function buildDefInsertWidget(onInsert) {
    const wrap = document.createElement("div");
    wrap.className = "lb-add-wrap";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "lb-search";
    searchInput.placeholder = "＋ 함수 검색 (트리거/효과)...";

    const dropdown = document.createElement("div");
    dropdown.className = "lb-dropdown autocomplete-dropdown";

    let selIdx = -1;

    const _refresh = () => {
      const q = searchInput.value.trim();
      selIdx = -1;
      const results = limbusSearchDefs(q, ["trigger", "effect"], 30);
      if (!results.length) { dropdown.classList.remove("active"); return; }
      dropdown.innerHTML = results.map((d, i) =>
        `<div class="autocomplete-item" data-key="${escapeHtml(d.key)}" data-kind="${d._kind}" data-index="${i}">
           <span class="autocomplete-item-id">${escapeHtml(d.key)}</span>
           ${d.category ? `<span class="autocomplete-item-name">${escapeHtml(d.category)}</span>` : ""}
           <span class="lb-kind-badge lb-kind-${d._kind}">${d._kind === "trigger" ? "트리거" : "효과"}</span>
         </div>`
      ).join("");
      dropdown.classList.add("active");
      dropdown.querySelectorAll(".autocomplete-item").forEach((item) => {
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          _pick(item.dataset.key, item.dataset.kind);
        });
      });
    };

    const _pick = (key, kind) => {
      const def = limbusGetDef(key, kind);
      if (!def) return;
      searchInput.value = "";
      dropdown.classList.remove("active");

      if (kind === "trigger") {
        onInsert({ trigger: def.key, text: "" });
        return;
      }

      // 효과 함수: 파라미터를 prompt()로 하나씩 입력받아 템플릿을 채운다
      const usedKeywords = [];
      const text = limbusApplyTemplate(def, (p) => {
        const msg = `${def.label || def.key}\n\n"${p.name}" 값을 입력하세요.`;
        const raw = prompt(msg, p.default !== undefined ? String(p.default) : "");
        if (raw === null) return null; // 취소
        if (p.type === "keyword" && raw.trim()) usedKeywords.push(raw.trim());
        return raw;
      });
      if (text === null) return; // 사용자가 취소함
      onInsert({ trigger: "", text });
      // 새로 쓰인 키워드는 용어사전(하이라이트 목록)에도 자동 등록
      usedKeywords.forEach((kw) => addVocab("keywords", kw));
    };

    searchInput.addEventListener("input", _refresh);
    searchInput.addEventListener("focus", _refresh);
    searchInput.addEventListener("keydown", (e) => {
      const items = [...dropdown.querySelectorAll(".autocomplete-item")];
      if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); }
      if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); }
      items.forEach((it, i) => it.classList.toggle("selected", i === selIdx));
      if (e.key === "Enter") {
        e.preventDefault();
        if (selIdx >= 0) _pick(items[selIdx].dataset.key, items[selIdx].dataset.kind);
        else dropdown.classList.remove("active");
      }
      if (e.key === "Escape") dropdown.classList.remove("active");
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) dropdown.classList.remove("active");
    });

    wrap.appendChild(searchInput);
    wrap.appendChild(dropdown);
    return wrap;
  }

  function renderLineRow(line, index, state, container) {
    const isBullet = false; // unified: trigger field left empty = free-text line
    const tpl = document.getElementById("tpl-effect-line");
    const node = tpl.content.cloneNode(true);
    const row = node.querySelector(".effect-line");

    const triggerInput = node.querySelector(".trigger-input");
    triggerInput.value = line.trigger || "";
    triggerInput.addEventListener("input", () => (line.trigger = triggerInput.value));

    const textInput = node.querySelector(".effect-text");
    textInput.value = line.text || "";
    const preview = node.querySelector(".effect-preview");
    preview.innerHTML = renderPreviewHtml(line.text);
    textInput.addEventListener("input", () => {
      line.text = textInput.value;
      preview.innerHTML = renderPreviewHtml(line.text);
    });

    node.querySelector('[data-action="line-remove"]').addEventListener("click", () => {
      state.lines.splice(index, 1);
      renderLineEditor(container, state);
    });
    node.querySelector('[data-action="line-up"]').addEventListener("click", () => {
      if (index === 0) return;
      [state.lines[index - 1], state.lines[index]] = [state.lines[index], state.lines[index - 1]];
      renderLineEditor(container, state);
    });
    node.querySelector('[data-action="line-down"]').addEventListener("click", () => {
      if (index === state.lines.length - 1) return;
      [state.lines[index + 1], state.lines[index]] = [state.lines[index], state.lines[index + 1]];
      renderLineEditor(container, state);
    });

    return row;
  }

  function refreshAllPreviews() {
    document.querySelectorAll(".line-editor .effect-preview").forEach(el => {
      const textInput = el.parentElement.querySelector(".effect-text");
      if (textInput) el.innerHTML = renderPreviewHtml(textInput.value);
    });
  }

  // ---------- bulk import (legacy cards/*.json -> new schema, in one pass) ----------
  function setImportProgress(text) {
    const el = document.getElementById("import-progress");
    if (text == null) { el.classList.add("hidden"); el.textContent = ""; return; }
    el.classList.remove("hidden");
    el.textContent = text;
  }

  async function handleBulkImport(fileList) {
    const files = [...fileList].filter(f => f.name.toLowerCase().endsWith(".json"));
    if (!files.length) return;

    let success = 0;
    const failed = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportProgress(`가져오는 중… ${i + 1} / ${files.length}  (${file.name})`);
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        if (!raw || !raw.name) throw new Error("name 필드 없음");
        // Run the same legacy->editor->legacy round trip used when loading/saving a
        // single identity, so auto-parsed script lines and keyword tagging apply here too.
        const identity = fromLegacySchema(raw, null);
        const payload = toLegacySchema(identity);
        const result = await localApi.saveIdentity(payload);
        if (result.id) success++;
        else failed.push(`${file.name}: ${result.error || "저장 실패"}`);
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
    }

    setImportProgress(null);
    await loadIdentityList();

    if (failed.length) {
      const preview = failed.slice(0, 15).join("\n") + (failed.length > 15 ? `\n… 외 ${failed.length - 15}건` : "");
      alert(`일괄 가져오기 완료 — 성공 ${success}개 / 실패 ${failed.length}개\n\n${preview}`);
      setStatus(`가져오기: 성공 ${success} · 실패 ${failed.length}`);
    } else {
      setStatus(`가져오기 완료 · ${success}개 저장됨 ✓`);
    }
  }

  // ---------- sidebar ----------
  async function loadIdentityList() {
    identities = await localApi.listIdentities();
    renderSidebar();
  }

  function renderSidebar() {
    const q = document.getElementById("search").value.trim().toLowerCase();
    const list = document.getElementById("identity-list");
    list.innerHTML = "";
    const filtered = identities.filter(i => i.name.toLowerCase().includes(q));
    if (!filtered.length) {
      list.innerHTML = `<div class="identity-empty">저장된 인격이 없습니다.<br>우측 상단에서 새 인격을 만들어보세요.</div>`;
      return;
    }
    for (const item of filtered) {
      const div = document.createElement("div");
      div.className = "identity-item" + (item.id === current._id ? " active" : "");
      div.innerHTML = `
        ${item.thumbnail ? `<img class="identity-thumb" src="${item.thumbnail}">` : `<div class="identity-thumb"></div>`}
        <div class="identity-meta">
          <div class="identity-name">${escapeHtml(item.name)}</div>
          <div class="identity-sub">${escapeHtml(item.sinner || "")} ${item.season ? "· S" + escapeHtml(item.season) : ""}</div>
        </div>`;
      div.addEventListener("click", () => loadIdentity(item.id));
      list.appendChild(div);
    }
  }

  async function loadIdentity(id) {
    const data = await localApi.getIdentity(id);
    if (!data) return;
    current = fromLegacySchema(data, id);
    renderAll();
    renderSidebar();
  }

  function newIdentity() {
    current = emptyIdentity();
    renderAll();
    renderSidebar();
    document.getElementById("f-name").focus();
  }

  // ---------- legacy schema conversion ----------
  function fromLegacySchema(data, id) {
    const c = emptyIdentity();
    c._id = id;
    for (const k of ["name","get_script","synchro_script","hp","speed","defense",
      "slash","pierce","blunt","sinner","season","rank","release","ticket","howtoget",
      "sanity_increase","sanity_decrease"]) {
      if (data[k] !== undefined) c[k] = data[k];
    }
    c.keywords = Array.isArray(data.keyword) ? data.keyword : [];
    c.staggers = Array.isArray(data.staggers) ? [data.staggers[0]||"", data.staggers[1]||"", data.staggers[2]||""] : ["","",""];
    if (data.panic) { c.panic_category = data.panic.category || ""; c.panic_script = data.panic.script || ""; }

    c.synchro1 = loadScriptField(data.synchro1, data.synchro1_blocks);
    c.synchro2 = loadScriptField(data.synchro2, data.synchro2_blocks);
    c.synchro3 = loadScriptField(data.synchro3, data.synchro3_blocks);

    c.images = [];
    if (data.images && typeof data.images === "object") {
      for (const [label, path] of Object.entries(data.images)) c.images.push({ label, path });
    }

    c.skills = [];
    for (const [key, val] of Object.entries(data)) {
      if (/^skill/.test(key) && typeof val === "object" && val !== null) {
        const coinBlocks = val.coineffects_blocks || {};
        const coineffects = [];
        if (val.coineffects) {
          for (const [coin, text] of Object.entries(val.coineffects)) {
            coineffects.push({ coin, ...loadScriptField(text, coinBlocks[coin]) });
          }
        }
        c.skills.push({
          key, name: val.name || "", coins: val.coins ?? "", attack: val.attack || "",
          type: val.type || "", sin: val.sin || "", amount: val.amount || "",
          power: val.power || "", coin_power: val.coin_power || "", weight: val.weight || "",
          script: loadScriptField(val.script, val.script_blocks),
          image: val.image || "", coineffects,
        });
      }
    }

    function loadPassiveGroup(obj) {
      const out = [];
      if (!obj) return out;
      for (const val of Object.values(obj)) {
        const resources = [];
        if (val.resources) for (const [key, v] of Object.entries(val.resources)) resources.push({ key, val: v });
        out.push({ name: val.name || "", content: val.content || "", resources });
      }
      return out;
    }
    c.passives = loadPassiveGroup(data.passives);
    c.sppassives = loadPassiveGroup(data.sppassives);

    return c;
  }

  function toLegacySchema(c) {
    const out = {
      name: c.name, get_script: c.get_script, synchro_script: c.synchro_script,
      hp: c.hp, speed: c.speed, defense: c.defense,
      slash: c.slash, pierce: c.pierce, blunt: c.blunt,
      sinner: c.sinner, season: c.season, rank: c.rank, release: c.release,
      ticket: c.ticket, howtoget: c.howtoget, keyword: c.keywords,
      staggers: c.staggers.filter(s => s !== ""),
    };
    out.synchro1 = linesToPlainText(c.synchro1); out.synchro1_blocks = linesToBlocks(c.synchro1);
    out.synchro2 = linesToPlainText(c.synchro2); out.synchro2_blocks = linesToBlocks(c.synchro2);
    out.synchro3 = linesToPlainText(c.synchro3); out.synchro3_blocks = linesToBlocks(c.synchro3);

    if (c.images.length) {
      out.images = {};
      for (const img of c.images) if (img.label) out.images[img.label] = img.path || "";
    }
    for (const skill of c.skills) {
      if (!skill.key) continue;
      const coineffects = {};
      const coineffects_blocks = {};
      for (const ce of skill.coineffects) {
        if (!ce.coin) continue;
        coineffects[ce.coin] = linesToPlainText(ce);
        coineffects_blocks[ce.coin] = linesToBlocks(ce);
      }
      out[skill.key] = {
        name: skill.name, coins: Number(skill.coins) || 0, attack: skill.attack,
        type: skill.type, sin: skill.sin, amount: skill.amount, power: skill.power,
        coin_power: skill.coin_power, weight: skill.weight,
        script: linesToPlainText(skill.script), script_blocks: linesToBlocks(skill.script),
        image: skill.image || "", coineffects, coineffects_blocks,
      };
    }
    function dumpGroup(list, prefix) {
      const dct = {};
      list.forEach((p, i) => {
        const resources = {};
        for (const r of p.resources) if (r.key) resources[r.key] = r.val;
        const entry = { name: p.name, content: p.content };
        if (Object.keys(resources).length) entry.resources = resources;
        dct[`${prefix}${i + 1}`] = entry;
      });
      return dct;
    }
    out.passives = dumpGroup(c.passives, "passive");
    out.sppassives = dumpGroup(c.sppassives, "sp_passive");
    out.panic = { category: c.panic_category, script: c.panic_script };
    out.sanity_increase = c.sanity_increase;
    out.sanity_decrease = c.sanity_decrease;
    return out;
  }

  // ---------- rendering ----------
  function renderAll() {
    document.getElementById("f-name").value = current.name || "";
    updateRankBadge();
    for (const el of document.querySelectorAll("[data-path]")) {
      const path = el.dataset.path;
      el.value = getPath(current, path) ?? "";
    }
    renderKeywordTags();
    renderImageSlots();
    renderLineEditor(document.getElementById("synchro1-editor"), current.synchro1);
    renderLineEditor(document.getElementById("synchro2-editor"), current.synchro2);
    renderLineEditor(document.getElementById("synchro3-editor"), current.synchro3);
    renderSkills();
    renderPassiveGroup("passive-list", current.passives, "tpl-passive");
    renderPassiveGroup("sppassive-list", current.sppassives, "tpl-passive");
  }

  function updateRankBadge() {
    const badge = document.getElementById("rank-badge");
    const m = (current.name || "").match(/^\[\s*(.+?)\s*\]/);
    badge.textContent = current.rank ? current.rank.replace(/[()]/g, "").trim() : (m ? m[1] : "―");
  }

  // ---- keyword tags (identity-level keyword list, unrelated to script glossary) ----
  function renderKeywordTags() {
    const wrap = document.getElementById("keyword-tags");
    wrap.querySelectorAll(".tag-chip").forEach(e => e.remove());
    const input = wrap.querySelector("input") || document.createElement("input");
    input.type = "text";
    input.placeholder = "키워드 입력 후 Enter";
    current.keywords.forEach((kw, i) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.innerHTML = `${escapeHtml(kw)} <button type="button" data-i="${i}">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        current.keywords.splice(i, 1);
        renderKeywordTags();
      });
      wrap.insertBefore(chip, input);
    });
    if (!wrap.contains(input)) wrap.appendChild(input);
    input.onkeydown = (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        current.keywords.push(input.value.trim());
        input.value = "";
        renderKeywordTags();
      } else if (e.key === "Backspace" && !input.value && current.keywords.length) {
        current.keywords.pop();
        renderKeywordTags();
      }
    };
  }

  // ---- image upload widget ----
  function buildImageUpload(container, getPathVal, setPathVal) {
    container.innerHTML = "";
    const path = getPathVal();
    if (path) {
      const img = document.createElement("img");
      img.src = path;
      container.appendChild(img);
    }
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    const status = document.createElement("span");
    status.className = "upload-status";
    fileInput.addEventListener("change", async () => {
      if (!fileInput.files.length) return;
      status.textContent = "불러오는 중…";
      try {
        const data = await localApi.uploadImage(fileInput.files[0]);
        if (data.path) {
          setPathVal(data.path);
          status.textContent = "완료";
          buildImageUpload(container, getPathVal, setPathVal);
        } else {
          status.textContent = data.error || "실패";
        }
      } catch {
        status.textContent = "이미지 처리 실패";
      }
    });
    container.appendChild(fileInput);
    container.appendChild(status);
  }

  // ---- image slots ----
  function renderImageSlots() {
    const list = document.getElementById("image-list");
    list.innerHTML = "";
    current.images.forEach((img, i) => {
      const node = document.getElementById("tpl-image-slot").content.cloneNode(true);
      const labelInput = node.querySelector(".image-label");
      labelInput.value = img.label || "";
      labelInput.addEventListener("input", () => (current.images[i].label = labelInput.value));
      buildImageUpload(
        node.querySelector('[data-role="slot-image"]'),
        () => current.images[i].path,
        (p) => (current.images[i].path = p)
      );
      node.querySelector('[data-action="remove-image"]').addEventListener("click", () => {
        current.images.splice(i, 1);
        renderImageSlots();
      });
      list.appendChild(node);
    });
  }

  // ---- skills ----
  function renderSkills() {
    const list = document.getElementById("skill-list");
    list.innerHTML = "";
    current.skills.forEach((skill, i) => {
      const node = document.getElementById("tpl-skill").content.cloneNode(true);
      const block = node.querySelector(".skill-block");
      block.querySelectorAll("[data-field]").forEach(el => {
        const f = el.dataset.field;
        if (f === "coins" || f === "name" || f === "attack" || f === "type" || f === "sin" ||
            f === "amount" || f === "power" || f === "coin_power" || f === "weight" || f === "key") {
          el.value = skill[f] ?? "";
          el.addEventListener("input", () => (skill[f] = el.value));
        }
      });
      renderLineEditor(block.querySelector('[data-role="script-editor"]'), skill.script);
      renderCoinEffects(block.querySelector('[data-list="coineffects"]'), skill);
      block.querySelector('[data-action="add-coineffect"]').addEventListener("click", () => {
        skill.coineffects.push({ coin: `coin${skill.coineffects.length + 1}`, lines: [] });
        renderCoinEffects(block.querySelector('[data-list="coineffects"]'), skill);
      });
      buildImageUpload(
        block.querySelector('[data-role="skill-image"]'),
        () => skill.image,
        (p) => (skill.image = p)
      );
      block.querySelector('[data-action="remove-skill"]').addEventListener("click", () => {
        current.skills.splice(i, 1);
        renderSkills();
      });
      list.appendChild(node);
    });
  }

  function renderCoinEffects(container, skill) {
    container.innerHTML = "";
    skill.coineffects.forEach((ce, i) => {
      const node = document.getElementById("tpl-coineffect").content.cloneNode(true);
      const keyInput = node.querySelector(".coin-key");
      keyInput.value = ce.coin || "";
      keyInput.addEventListener("input", () => (ce.coin = keyInput.value));
      node.querySelector('[data-action="remove-coineffect"]').addEventListener("click", () => {
        skill.coineffects.splice(i, 1);
        renderCoinEffects(container, skill);
      });
      renderLineEditor(node.querySelector('[data-role="coin-line-editor"]'), ce);
      container.appendChild(node);
    });
  }

  // ---- passives / sp_passives ----
  function renderPassiveGroup(containerId, groupArr, tplId) {
    const list = document.getElementById(containerId);
    list.innerHTML = "";
    groupArr.forEach((p, i) => {
      const node = document.getElementById(tplId).content.cloneNode(true);
      const block = node.querySelector(".passive-block");
      block.querySelectorAll("[data-field]").forEach(el => {
        const f = el.dataset.field;
        el.value = p[f] ?? "";
        el.addEventListener("input", () => (p[f] = el.value));
      });
      renderResources(block.querySelector('[data-list="resources"]'), p);
      block.querySelector('[data-action="add-resource"]').addEventListener("click", () => {
        p.resources.push({ key: "", val: "" });
        renderResources(block.querySelector('[data-list="resources"]'), p);
      });
      block.querySelector('[data-action="remove-passive"]').addEventListener("click", () => {
        groupArr.splice(i, 1);
        renderPassiveGroup(containerId, groupArr, tplId);
      });
      list.appendChild(node);
    });
  }

  function renderResources(container, p) {
    container.innerHTML = "";
    p.resources.forEach((r, i) => {
      const node = document.getElementById("tpl-resource").content.cloneNode(true);
      const keyInput = node.querySelector(".res-key");
      const valInput = node.querySelector(".res-val");
      keyInput.value = r.key || "";
      valInput.value = r.val || "";
      keyInput.addEventListener("input", () => (r.key = keyInput.value));
      valInput.addEventListener("input", () => (r.val = valInput.value));
      node.querySelector('[data-action="remove-resource"]').addEventListener("click", () => {
        p.resources.splice(i, 1);
        renderResources(container, p);
      });
      container.appendChild(node);
    });
  }

  // ---------- save / export ----------
  async function saveIdentity() {
    if (!current.name.trim()) {
      setStatus("이름을 입력해주세요");
      document.getElementById("f-name").focus();
      return;
    }
    const payload = toLegacySchema(current);
    payload._id = current._id;
    const data = await localApi.saveIdentity(payload);
    if (data.id) {
      current._id = data.id;
      setStatus("저장됨 ✓");
      await loadIdentityList();
    } else {
      setStatus(data.error || "저장 실패");
    }
  }

  function exportIdentity() {
    const payload = toLegacySchema(current);
    const blob = new Blob([JSON.stringify(payload, null, 4)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(current.name || "identity").replace(/[\\/:*?"<>|]/g, "_")}.json`;
    a.click();
  }

  // ---------- bindings ----------
  function bindStaticFields() {
    document.getElementById("f-name").addEventListener("input", (e) => {
      current.name = e.target.value;
      updateRankBadge();
    });
    for (const el of document.querySelectorAll("[data-path]")) {
      el.addEventListener("input", () => setPath(current, el.dataset.path, el.value));
    }
    document.getElementById("btn-new").addEventListener("click", newIdentity);
    document.getElementById("btn-bulk-import").addEventListener("click", () => {
      document.getElementById("bulk-import-input").click();
    });
    document.getElementById("bulk-import-input").addEventListener("change", async (e) => {
      await handleBulkImport(e.target.files);
      e.target.value = "";
    });
    document.getElementById("btn-save").addEventListener("click", saveIdentity);
    document.getElementById("btn-export").addEventListener("click", exportIdentity);
    document.getElementById("search").addEventListener("input", renderSidebar);
    document.getElementById("btn-add-image").addEventListener("click", () => {
      current.images.push({ label: "", path: "" });
      renderImageSlots();
    });
    document.getElementById("btn-add-skill").addEventListener("click", () => {
      current.skills.push({
        key: `skill${current.skills.length + 1}`, name: "", coins: 2, attack: "",
        type: "", sin: "", amount: "", power: "", coin_power: "", weight: "",
        script: { lines: [] }, image: "", coineffects: [],
      });
      renderSkills();
    });
    document.getElementById("btn-add-passive").addEventListener("click", () => {
      current.passives.push({ name: "", content: "", resources: [] });
      renderPassiveGroup("passive-list", current.passives, "tpl-passive");
    });
    document.getElementById("btn-add-sppassive").addEventListener("click", () => {
      current.sppassives.push({ name: "", content: "", resources: [] });
      renderPassiveGroup("sppassive-list", current.sppassives, "tpl-passive");
    });

    document.getElementById("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    });

    // vocab modal
    document.getElementById("btn-vocab").addEventListener("click", () => {
      document.getElementById("vocab-modal").classList.remove("hidden");
    });
    document.getElementById("vocab-close").addEventListener("click", () => {
      document.getElementById("vocab-modal").classList.add("hidden");
    });
    document.getElementById("vocab-modal").addEventListener("click", (e) => {
      if (e.target.id === "vocab-modal") document.getElementById("vocab-modal").classList.add("hidden");
    });
    document.getElementById("vocab-keyword-add").addEventListener("click", () => {
      const input = document.getElementById("vocab-keyword-input");
      addVocab("keywords", input.value);
      input.value = "";
    });
    document.getElementById("vocab-keyword-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("vocab-keyword-add").click();
    });
  }

  // ---------- init ----------
  bindStaticFields();
  renderAll();
  bootstrapData().then(() => {
    loadIdentityList();
    loadVocab();
  });
})();