/* Receipt to Meal Planner — app logic.
   Steps: 1) upload/paste receipt, 2) review parsed items, 3) pantry staples,
   4) generated meal plan. All client-side; OCR via Tesseract.js CDN. */
(function () {
  "use strict";

  var state = {
    step: 1,
    items: [],        // { label, canonical, qty }
    pantry: new Set(),
    days: 5,
    plan: null,      // [{ day, meals: [{slot, recipe, fromReceipt, fromPantry, missing}] }]
    planSource: "builtin", // "builtin" | "ai"
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function prettyName(key) {
    return key.split(" ").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }

  /* ---------- ingredient normalization ---------- */
  function canonicalize(raw) {
    var line = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    var best = null, bestLen = 0;
    Object.keys(SYNONYMS).forEach(function (canon) {
      var terms = [canon].concat(SYNONYMS[canon]);
      terms.forEach(function (t) {
        if (line.indexOf(t) !== -1 && t.length > bestLen) { best = canon; bestLen = t.length; }
      });
    });
    return best; // null => unknown ingredient, kept as custom
  }

  /* ---------- receipt text parsing ---------- */
  var JUNK = /total|subtotal|balance|change|tender|cash|credit|debit|visa|mastercard|thank you|welcome|customer|receipt|store #|cashier|register|transaction|savings|coupon|discount|tax\b|payment|approved|auth\b|terminal/i;

  function parseReceiptText(text) {
    var items = [];
    text.split(/\r?\n/).forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line || line.length < 3) return;
      if (JUNK.test(line)) return;
      // Strip trailing price like 5.99 or $5.99
      line = line.replace(/\s*\$?\d+\.\d{2}\s*$/, "");
      // Strip "@ $x.xx/lb" style unit pricing
      line = line.replace(/@\s*\$?[\d.]+\s*\/\s*[a-z]*/i, "");
      // Strip weight/count like "2.5 LB", "12 OZ", "3 CT", "1 GAL"
      var qty = "";
      var qm = line.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|oz|ct|gal|pk|ea)\b/i);
      if (qm) qty = qm[1] + " " + qm[2].toLowerCase();
      line = line.replace(/\b\d+(?:\.\d+)?\s*(lb|lbs|oz|ct|gal|pk|ea)\b/gi, "");
      // Strip leading quantity like "2 X" or "2x"
      line = line.replace(/^\d+\s*x\s*/i, "");
      line = line.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (line.length < 3 || JUNK.test(line)) return;
      if (/^\d+$/.test(line)) return;
      var canon = canonicalize(line);
      items.push({ label: line, canonical: canon || line.toLowerCase(), qty: qty });
    });
    // Dedupe by canonical, merging qtys
    var seen = {}, out = [];
    items.forEach(function (it) {
      if (seen[it.canonical]) {
        if (it.qty && seen[it.canonical].qty.indexOf(it.qty) === -1) {
          seen[it.canonical].qty += (seen[it.canonical].qty ? " + " : "") + it.qty;
        }
        return;
      }
      seen[it.canonical] = it;
      out.push(it);
    });
    return out;
  }

  /* ---------- step navigation ---------- */
  function goStep(n) {
    state.step = n;
    document.querySelectorAll(".step-panel").forEach(function (p) { p.hidden = true; });
    $("step-" + n).hidden = false;
    document.querySelectorAll(".step-dot").forEach(function (d) {
      var i = parseInt(d.dataset.step, 10);
      d.classList.toggle("active", i === n);
      d.classList.toggle("done", i < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- step 1: upload / OCR ---------- */
  var ocrStatus = $("ocrStatus");

  function setOcrStatus(msg, working) {
    ocrStatus.textContent = msg;
    ocrStatus.classList.toggle("working", !!working);
  }

  function handleImageFile(file) {
    if (!file || !file.type.match(/^image\//)) { setOcrStatus("That doesn't look like an image — try a photo of your receipt."); return; }
    var url = URL.createObjectURL(file);
    $("previewImg").src = url;
    $("previewWrap").hidden = false;
    setOcrStatus("Reading your receipt… this takes a few seconds.", true);
    if (typeof Tesseract === "undefined") {
      setOcrStatus("The OCR library didn't load. Check your connection and try again — or paste the text below.");
      return;
    }
    Tesseract.recognize(url, "eng").then(function (result) {
      var text = result.data.text || "";
      $("receiptText").value = text;
      var items = parseReceiptText(text);
      setOcrStatus(items.length
        ? "Found " + items.length + " possible items. Review them in the next step."
        : "Couldn't pick out items from that scan — try a clearer photo, or type them below.");
    }).catch(function () {
      setOcrStatus("Couldn't read that image. Try a clearer photo — or paste the text below.");
    });
  }

  $("fileInput").addEventListener("change", function (e) { handleImageFile(e.target.files[0]); });
  var drop = $("dropzone");
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("drag"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("drag");
    handleImageFile(e.dataTransfer.files[0]);
  });

  $("useSample").addEventListener("click", function () {
    $("receiptText").value = SAMPLE_RECEIPT_TEXT;
    setOcrStatus("Sample receipt loaded — no photo needed.");
  });

  $("toItems").addEventListener("click", function () {
    var text = $("receiptText").value.trim();
    state.items = text ? parseReceiptText(text) : [];
    renderItems();
    goStep(2);
  });

  /* ---------- step 2: review items ---------- */
  function renderItems() {
    var list = $("itemList");
    if (!state.items.length) {
      list.innerHTML = '<p class="empty-note">No items yet. Add a few below — even rough guesses work.</p>';
    } else {
      list.innerHTML = state.items.map(function (it, i) {
        return '<div class="item-row">' +
          '<input type="text" value="' + esc(it.label) + '" data-i="' + i + '" data-f="label" aria-label="Item name">' +
          '<input type="text" value="' + esc(it.qty) + '" placeholder="qty" data-i="' + i + '" data-f="qty" aria-label="Quantity">' +
          '<button type="button" class="icon-btn" data-del="' + i + '" aria-label="Remove">&times;</button>' +
          "</div>";
      }).join("");
    }
  }

  $("itemList").addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.i === undefined) return;
    var it = state.items[parseInt(t.dataset.i, 10)];
    it[t.dataset.f] = t.value;
    if (t.dataset.f === "label") it.canonical = canonicalize(t.value) || t.value.toLowerCase().trim();
  });
  $("itemList").addEventListener("click", function (e) {
    if (e.target.dataset.del !== undefined) {
      state.items.splice(parseInt(e.target.dataset.del, 10), 1);
      renderItems();
    }
  });
  $("addItem").addEventListener("click", function () {
    state.items.push({ label: "", canonical: "", qty: "" });
    renderItems();
    var inputs = $("itemList").querySelectorAll('input[data-f="label"]');
    inputs[inputs.length - 1].focus();
  });
  $("backToUpload").addEventListener("click", function () { goStep(1); });
  $("toPantry").addEventListener("click", function () {
    state.items = state.items.filter(function (it) { return it.label.trim(); });
    state.items.forEach(function (it) { it.canonical = canonicalize(it.label) || it.label.toLowerCase().trim(); });
    renderPantry();
    goStep(3);
  });

  /* ---------- step 3: pantry ---------- */
  function renderPantry() {
    $("pantryGroups").innerHTML = PANTRY_GROUPS.map(function (g, gi) {
      return '<div class="pantry-group"><h4>' + esc(g.name) + "</h4><div class='pantry-grid'>" +
        g.items.map(function (p, pi) {
          var id = "p-" + gi + "-" + pi;
          var on = state.pantry.has(p.item) || (!state.pantry.size && p.checked);
          return '<label class="pantry-item" for="' + id + '">' +
            '<input type="checkbox" id="' + id + '" data-p="' + esc(p.item) + '"' + (on ? " checked" : "") + ">" +
            esc(prettyName(p.item)) + "</label>";
        }).join("") + "</div></div>";
    }).join("");
    if (!state.pantry.size) {
      PANTRY_GROUPS.forEach(function (g) {
        g.items.forEach(function (p) { if (p.checked) state.pantry.add(p.item); });
      });
    }
    [3, 5, 7].forEach(function (d) {
      $("days" + d).classList.toggle("selected", state.days === d);
    });
  }

  $("pantryGroups").addEventListener("change", function (e) {
    var key = e.target.dataset.p;
    if (!key) return;
    if (e.target.checked) state.pantry.add(key); else state.pantry.delete(key);
  });
  [3, 5, 7].forEach(function (d) {
    $("days" + d).addEventListener("click", function () { state.days = d; renderPantry(); });
  });
  $("backToItems").addEventListener("click", function () { goStep(2); });
  $("generate").addEventListener("click", function () {
    if (ai.enabled) { generatePlanAI(); return; }
    generatePlan();
    state.planSource = "builtin";
    renderPlan();
    goStep(4);
  });

  /* ---------- AI recipe generation (bring your own key) ----------
     Uses any OpenAI-compatible /chat/completions endpoint. The key lives
     in localStorage and is only ever sent to the configured base URL. */
  var AI_STORE = "r2mp-ai";
  function loadAI() {
    try {
      var raw = localStorage.getItem(AI_STORE);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage unavailable — fall through to defaults */ }
    return { enabled: false, key: "", model: "gpt-4o-mini", base: "https://api.openai.com/v1" };
  }
  var ai = loadAI();
  function saveAI() {
    try { localStorage.setItem(AI_STORE, JSON.stringify(ai)); } catch (e) { /* ignore */ }
  }
  function aiStatus(msg, isErr) {
    var el = $("aiStatus");
    el.textContent = msg;
    el.className = "ai-status" + (isErr ? " err" : "");
  }
  $("useAI").checked = !!ai.enabled;
  $("aiKey").value = ai.key || "";
  $("aiModel").value = ai.model || "gpt-4o-mini";
  $("aiBase").value = ai.base || "https://api.openai.com/v1";
  $("aiFields").hidden = !ai.enabled;
  $("useAI").addEventListener("change", function () {
    ai.enabled = $("useAI").checked;
    $("aiFields").hidden = !ai.enabled;
    saveAI();
  });
  ["aiKey", "aiModel", "aiBase"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      ai.key = $("aiKey").value.trim();
      ai.model = $("aiModel").value.trim() || "gpt-4o-mini";
      ai.base = ($("aiBase").value.trim().replace(/\/+$/, "")) || "https://api.openai.com/v1";
      saveAI();
    });
  });

  function buildAIPrompt() {
    var receiptLines = state.items.map(function (i) {
      return "- " + i.label + (i.qty ? " (" + i.qty + ")" : "");
    });
    var pantryLines = Array.from(state.pantry).map(prettyName);
    return "Create a " + state.days + "-day meal plan (breakfast, lunch, and dinner each day) " +
      "using the groceries below.\n\n" +
      "PRIORITIES, in order:\n" +
      "1. Use up the RECEIPT items first — every receipt item should appear in at least one meal if at all plausible.\n" +
      "2. RE-USE ingredients across meals and days (e.g. cook extra chicken for day 1 dinner, use leftovers for day 2 lunch).\n" +
      "3. Fill remaining needs from the PANTRY staples.\n" +
      "4. Only if a meal truly needs something else, mark that ingredient source as \"buy\" — keep these minimal.\n\n" +
      "RECEIPT ITEMS:\n" + receiptLines.join("\n") + "\n\n" +
      "PANTRY STAPLES:\n- " + pantryLines.join("\n- ") + "\n\n" +
      "Return ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:\n" +
      "{\"days\":[{\"day\":1,\"meals\":[{\"slot\":\"breakfast\",\"name\":\"Veggie Omelet\",\"time\":\"15 min\",\"serves\":2," +
      "\"ingredients\":[{\"item\":\"eggs\",\"qty\":\"4\",\"source\":\"receipt\"}]," +
      "\"steps\":[\"Whisk the eggs with a pinch of salt.\",\"Cook in a buttered skillet until just set.\"]}]}]}\n" +
      "Rules: slot is one of breakfast/lunch/dinner; source is one of receipt/pantry/buy; " +
      "steps are 3-6 short imperative sentences; keep ingredient names simple and generic.";
  }

  function stripFences(s) {
    return String(s).replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }

  function planFromAI(data) {
    if (!data || !Array.isArray(data.days) || data.days.length !== state.days) return null;
    var receiptSet = new Set(state.items.map(function (i) { return i.canonical; }));
    var plan = [];
    for (var d = 0; d < data.days.length; d++) {
      var dd = data.days[d];
      if (!dd || !Array.isArray(dd.meals) || dd.meals.length !== 3) return null;
      var day = { day: d + 1, meals: [] };
      var ok = true;
      dd.meals.forEach(function (m) {
        if (!m || !m.name || !Array.isArray(m.ingredients) || !Array.isArray(m.steps)) { ok = false; return; }
        var fromReceipt = [], fromPantry = [], missing = [];
        m.ingredients.forEach(function (g) {
          var raw = String((g && g.item) || "").trim();
          if (!raw) return;
          var canon = canonicalize(raw) || raw.toLowerCase();
          var ing = { item: canon, qty: (g && g.qty) || "" };
          if (receiptSet.has(canon)) fromReceipt.push(ing);
          else if (state.pantry.has(canon)) fromPantry.push(ing);
          else missing.push(ing);
        });
        day.meals.push({
          slot: String(m.slot || "").toLowerCase(),
          recipe: {
            name: String(m.name),
            time: String(m.time || ""),
            serves: m.serves || 2,
            steps: m.steps.map(function (s) { return String(s); })
          },
          fromReceipt: fromReceipt, fromPantry: fromPantry, missing: missing
        });
      });
      if (!ok) return null;
      plan.push(day);
    }
    return plan;
  }

  function generatePlanAI() {
    if (!ai.key) { aiStatus("Add your API key first — the key field is empty.", true); return; }
    var btn = $("generate");
    btn.disabled = true;
    btn.textContent = "Asking the AI…";
    aiStatus("Generating your plan — this usually takes a few seconds.", false);
    fetch(ai.base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ai.key },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: "You are a meal-planning assistant. You output strict JSON only, no commentary." },
          { role: "user", content: buildAIPrompt() }
        ],
        temperature: 0.7
      })
    }).then(function (resp) {
      if (!resp.ok) throw new Error("API returned HTTP " + resp.status + " — check your key, model, and base URL.");
      return resp.json();
    }).then(function (data) {
      var text = (((data.choices || [])[0] || {}).message || {}).content || "";
      var plan = planFromAI(JSON.parse(stripFences(text)));
      if (!plan) throw new Error("the AI returned a plan I couldn't parse — try again.");
      state.plan = plan;
      state.planSource = "ai";
      aiStatus("", false);
      renderPlan();
      goStep(4);
    }).catch(function (err) {
      if (state.step === 4) goStep(3);
      aiStatus("Couldn't generate with AI: " + err.message +
        " The built-in recipe box still works — uncheck the AI box to use it.", true);
    }).finally(function () {
      btn.disabled = false;
      btn.innerHTML = "Generate my meal plan &rarr;";
    });
  }

  /* ---------- step 4: planning engine ---------- */
  function scoreRecipe(recipe, available, receiptSet, usedSet) {
    var ings = recipe.ingredients.map(function (i) { return i.item; });
    var cov = ings.filter(function (i) { return available.has(i); }).length / ings.length;
    var rcov = ings.filter(function (i) { return receiptSet.has(i); }).length / ings.length;
    var reuse = ings.filter(function (i) { return usedSet.has(i); }).length / ings.length;
    return 0.45 * cov + 0.35 * rcov + 0.20 * reuse;
  }

  function generatePlan() {
    var receiptSet = new Set(state.items.map(function (i) { return i.canonical; }));
    var available = new Set(receiptSet);
    state.pantry.forEach(function (p) { available.add(p); });
    var usedSet = new Set();
    var usedRecipes = new Set();
    var slots = ["breakfast", "lunch", "dinner"];
    var plan = [];

    for (var d = 1; d <= state.days; d++) {
      var day = { day: d, meals: [] };
      slots.forEach(function (slot) {
        var cands = RECIPES.filter(function (r) { return r.type === slot && !usedRecipes.has(r.id); });
        if (!cands.length) { // allow repeats only if we run out
          cands = RECIPES.filter(function (r) { return r.type === slot; });
        }
        var best = null, bestScore = -1;
        cands.forEach(function (r) {
          var s = scoreRecipe(r, available, receiptSet, usedSet);
          if (s > bestScore) { bestScore = s; best = r; }
        });
        usedRecipes.add(best.id);
        best.ingredients.forEach(function (i) { usedSet.add(i.item); });
        var fromReceipt = [], fromPantry = [], missing = [];
        best.ingredients.forEach(function (i) {
          if (receiptSet.has(i.item)) fromReceipt.push(i);
          else if (state.pantry.has(i.item)) fromPantry.push(i);
          else missing.push(i);
        });
        day.meals.push({ slot: slot, recipe: best, fromReceipt: fromReceipt, fromPantry: fromPantry, missing: missing });
      });
      plan.push(day);
    }
    state.plan = plan;
  }

  function renderPlan() {
    var receiptSet = new Set(state.items.map(function (i) { return i.canonical; }));
    var usedReceipt = new Set();
    state.plan.forEach(function (day) {
      day.meals.forEach(function (m) {
        m.fromReceipt.forEach(function (i) { usedReceipt.add(i.item); });
      });
    });
    var coverage = receiptSet.size ? Math.round(usedReceipt.size / receiptSet.size * 100) : 0;

    var html = '<div class="plan-stats">' +
      '<div class="stat"><strong>' + state.days + '</strong><span>days planned</span></div>' +
      '<div class="stat"><strong>' + (state.days * 3) + '</strong><span>meals</span></div>' +
      '<div class="stat"><strong>' + coverage + '%</strong><span>of receipt items used</span></div>' +
      "</div>";

    state.plan.forEach(function (day) {
      html += '<div class="day"><h3>Day ' + day.day + "</h3>";
      day.meals.forEach(function (m) {
        var r = m.recipe;
        html += '<div class="meal"><div class="meal-head"><div>' +
          '<span class="slot">' + m.slot + '</span><h4>' + esc(r.name) + "</h4>" +
          '<p class="meta">' + esc(r.time) + " · Serves " + r.serves + "</p></div></div>" +
          '<ul class="ing-list">' +
          m.fromReceipt.map(function (i) {
            return '<li class="from-receipt" title="From your receipt">' + esc(prettyName(i.item)) +
              (i.qty ? ' <span class="qty">' + esc(i.qty) + "</span>" : "") + "</li>";
          }).join("") +
          m.fromPantry.map(function (i) {
            return '<li class="from-pantry" title="From your pantry">' + esc(prettyName(i.item)) +
              (i.qty ? ' <span class="qty">' + esc(i.qty) + "</span>" : "") + "</li>";
          }).join("") +
          m.missing.map(function (i) {
            return '<li class="missing" title="Not in your receipt or pantry">' + esc(prettyName(i.item)) +
              (i.qty ? ' <span class="qty">' + esc(i.qty) + "</span>" : "") + " <em>· pick up</em></li>";
          }).join("") +
          "</ul>" +
          '<ol class="recipe-steps">' + r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
          "</div>";
      });
      html += "</div>";
    });

    // Aggregated shopping list of gaps
    var gaps = {};
    state.plan.forEach(function (day) {
      day.meals.forEach(function (m) {
        m.missing.forEach(function (i) { gaps[i.item] = i.qty || ""; });
      });
    });
    var gapKeys = Object.keys(gaps);
    if (gapKeys.length) {
      html += '<div class="day shopping"><h3>Shopping list</h3><p class="meta">A few things your plan calls for that weren\'t in your receipt or pantry:</p><ul class="ing-list">' +
        gapKeys.map(function (k) {
          return "<li>" + esc(prettyName(k)) + (gaps[k] ? ' <span class="qty">' + esc(gaps[k]) + "</span>" : "") + "</li>";
        }).join("") + "</ul></div>";
    } else {
      html += '<div class="day shopping"><h3>Shopping list</h3><p class="meta">Nothing to buy — every meal is covered by your receipt and pantry. Nicely shopped.</p></div>';
    }

    $("planOut").innerHTML = html;
  }

  $("backToPantry").addEventListener("click", function () { goStep(3); });
  $("regenerate").addEventListener("click", function () {
    if (state.planSource === "ai") { generatePlanAI(); return; }
    generatePlan(); renderPlan();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("startOver").addEventListener("click", function () { goStep(1); });
  $("printPlan").addEventListener("click", function () { window.print(); });

  /* ---------- emailed AI plan requests ----------
     Posts the receipt to the shared project-inbox endpoint; a scheduled
     job picks it up, generates the plan, and emails it back. */
  var PLAN_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxFuAczmnF_2zAED4saFZNDAXcWk9mWeTbM0GHqaV19P0sFViVPQIVJxYeB2iGpgq0Mzg/exec";
  function planRequestStatus(msg, isErr) {
    var el = $("planReqStatus");
    el.textContent = msg;
    el.className = "ai-status" + (isErr ? " err" : "");
  }
  $("requestPlan").addEventListener("click", function () {
    var name = $("planName").value.trim();
    var email = $("planEmail").value.trim();
    if (!email || email.indexOf("@") === -1) {
      planRequestStatus("Enter a valid email address so I know where to send your plan.", true);
      return;
    }
    if (!state.items.length) {
      planRequestStatus("Add your receipt items first (step 2), then request your plan.", true);
      return;
    }
    var receiptLines = state.items.map(function (i) {
      return "- " + i.label + (i.qty ? " (" + i.qty + ")" : "");
    }).join("\n");
    var pantryLines = Array.from(state.pantry).map(prettyName).join(", ");
    var data = new URLSearchParams();
    data.append("name", name || "(no name given)");
    data.append("email", email);
    data.append("title", "Meal Plan Request");
    data.append("type", "Meal Plan Request");
    data.append("details", "Days: " + state.days + "\n\nReceipt items:\n" + receiptLines +
      "\n\nPantry staples: " + (pantryLines || "(none selected)"));
    var btn = $("requestPlan");
    btn.disabled = true;
    btn.textContent = "Sending…";
    fetch(PLAN_SCRIPT_URL, { method: "POST", mode: "no-cors", body: data })
      .then(function () {
        planRequestStatus("Request sent! I'll email your meal plan to " + email +
          " — usually within about 30 minutes.", false);
      })
      .catch(function () {
        planRequestStatus("Something didn't go through — mind trying again?", true);
      })
      .finally(function () {
        btn.disabled = false;
        btn.innerHTML = "Email me my meal plan &rarr;";
      });
  });

  /* Demo mode: ?demo=1 loads the sample receipt and jumps to a finished plan.
     Used for the projects-page screenshot (and curious visitors). */
  function loadDemo() {
    state.items = parseReceiptText(SAMPLE_RECEIPT_TEXT);
    state.pantry = new Set();
    PANTRY_GROUPS.forEach(function (g) {
      g.items.forEach(function (p) { if (p.checked) state.pantry.add(p.item); });
    });
    state.days = 5;
    generatePlan();
    renderPlan();
    goStep(4);
  }
  $("seeExample").addEventListener("click", loadDemo);

  if (/[?&]demo=1/.test(window.location.search)) loadDemo();
  else goStep(1);
})();
