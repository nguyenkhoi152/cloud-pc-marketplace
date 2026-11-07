/* Bản mẫu "Sky": menu, xuất hiện khi cuộn, lọc và so sánh máy. Không phụ thuộc thư viện.
   Nội dung vẫn đọc được khi tắt JS. Chuyển động chỉ dùng CSS và Web Animations API (có sẵn trong trình duyệt). */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduced = function () { return !!(reduceMq && reduceMq.matches); };
  var DUR = 200; // khớp --dur-2

  // Xuất hiện khi cuộn: phần tử đã trong màn hình lúc tải hiện ngay, không chờ.
  var rv = Array.prototype.slice.call(document.querySelectorAll(".rv"));
  var vh = window.innerHeight || root.clientHeight;
  root.classList.add("js");
  if (reduced() || !("IntersectionObserver" in window)) {
    rv.forEach(function (el) { el.classList.add("in"); });
  } else {
    var pending = [];
    rv.forEach(function (el) {
      if (el.getBoundingClientRect().top < vh * 0.95) el.classList.add("in"); else pending.push(el);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    pending.forEach(function (el) { io.observe(el); });
    window.addEventListener("beforeprint", function () { rv.forEach(function (el) { el.classList.add("in"); }); });
  }

  // Hero: tạm dừng chuyển động lặp khi ra khỏi màn hình
  var hero = document.getElementById("hero-art");
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      hero.classList.toggle("paused", !entries[0].isIntersecting);
    }, { threshold: 0 }).observe(hero);
  }

  // Menu mobile
  var btn = document.getElementById("menu-btn");
  var nav = document.getElementById("site-nav");
  if (btn && nav) {
    var setOpen = function (open) {
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
    };
    btn.addEventListener("click", function () { setOpen(!nav.classList.contains("open")); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) { setOpen(false); btn.focus(); }
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("open") && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });
  }

  // Lọc và so sánh (chỉ trang tìm máy)
  var form = document.getElementById("filters");
  var list = document.getElementById("machine-list");
  if (!form || !list) return;

  var items = Array.prototype.slice.call(list.children); // các <li>
  var cards = items.map(function (li) { return li.querySelector("[data-id]"); });
  var count = document.getElementById("result-count");
  var emptyWrap = document.getElementById("empty-wrap");
  var compareWrap = document.getElementById("compare-wrap");
  var cmpBody = document.getElementById("cmp-body");
  var cmpHead = document.getElementById("cmp-head");
  var cmpNote = document.getElementById("cmp-note");
  var MAX_CMP = 3;

  var fieldNames = ["q", "minRam", "minVram", "maxPrice", "os", "region"];
  var params = new URLSearchParams(window.location.search);
  fieldNames.forEach(function (n) {
    if (params.has(n) && form.elements[n]) form.elements[n].value = params.get(n);
  });
  if (params.get("workspaceOnly") === "on" && form.elements.workspaceOnly) form.elements.workspaceOnly.checked = true;

  function num(v) {
    if (v === "" || v == null) return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function setPanel(wrap, open) {
    wrap.classList.toggle("open", open);
    wrap.setAttribute("aria-hidden", String(!open));
  }
  function visibleItems() { return items.filter(function (li) { return !li.hidden; }); }

  // Hiệu ứng dịch chuyển (FLIP) cho các thẻ còn lại khi lưới thay đổi
  function withFlip(change) {
    if (reduced() || !list.animate) { change(); return; }
    var before = new Map();
    visibleItems().forEach(function (li) { before.set(li, li.getBoundingClientRect()); });
    change();
    visibleItems().forEach(function (li) {
      var a = before.get(li); if (!a) return;
      var b = li.getBoundingClientRect();
      var dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      li.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
        { duration: DUR + 60, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  }

  var hideTimer = null;
  function applyFilter() {
    var q = form.elements.q.value.trim().toLowerCase();
    var minRam = num(form.elements.minRam.value);
    var minVram = num(form.elements.minVram.value);
    var maxPrice = num(form.elements.maxPrice.value);
    var os = form.elements.os.value;
    var region = form.elements.region.value;
    var wsOnly = form.elements.workspaceOnly.checked;
    var shown = 0, toHide = [];
    items.forEach(function (li, i) {
      var d = cards[i].dataset;
      var hay = (d.name + " " + d.cpu + " " + d.gpu + " " + d.apps).toLowerCase();
      var ok = (!q || hay.indexOf(q) !== -1) &&
        (minRam === null || Number(d.ram) >= minRam) &&
        (minVram === null || Number(d.vram) >= minVram) &&
        (maxPrice === null || Number(d.price) <= maxPrice) &&
        (!os || d.os === os) && (!region || d.region === region) &&
        (!wsOnly || d.ws === "true");
      li.dataset.match = ok ? "1" : "0";
      if (ok) shown++;
    });
    count.textContent = shown + " máy mẫu phù hợp";
    setPanel(emptyWrap, shown === 0);

    window.clearTimeout(hideTimer);
    var instant = reduced();
    withFlip(function () {
      items.forEach(function (li) {
        var match = li.dataset.match === "1";
        if (match) {
          li.classList.remove("leaving");
          if (li.hidden) {
            li.hidden = false;
            if (!instant) { li.classList.add("entering"); li.addEventListener("animationend", function onEnd() { li.classList.remove("entering"); li.removeEventListener("animationend", onEnd); }); }
          }
        } else if (!li.hidden) {
          if (instant) li.hidden = true; else { li.classList.add("leaving"); toHide.push(li); }
        }
      });
    });
    if (toHide.length) {
      hideTimer = window.setTimeout(function () {
        withFlip(function () {
          toHide.forEach(function (li) { if (li.dataset.match !== "1") { li.hidden = true; li.classList.remove("leaving"); } });
        });
        renderCompare();
      }, DUR);
    }
    renderCompare();
  }

  function selected() {
    return cards.filter(function (c, i) { return !items[i].hidden && items[i].dataset.match !== "0" && c.querySelector("input.cmp-box").checked; });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]; });
  }

  function renderCompare() {
    var sel = selected();
    setPanel(compareWrap, sel.length > 0);
    if (!sel.length) return;
    var rows = [
      ["CPU", "cpu"], ["RAM", "ram", " GB"], ["GPU", "gpu"], ["VRAM", "vram", " GB"],
      ["Hệ điều hành", "os"], ["Vùng", "region"], ["Host cam kết", "window", " giờ trở lên"],
      ["Workspace", "wslabel"], ["Giá gói", "price", " PCP / 15 phút"], ["Trạng thái", "status"]
    ];
    cmpHead.innerHTML = "<tr><th scope=\"col\">Thông số</th>" +
      sel.map(function (c) { return "<th scope=\"col\">" + esc(c.dataset.name) + "</th>"; }).join("") + "</tr>";
    cmpBody.innerHTML = rows.map(function (r) {
      return "<tr><th scope=\"row\">" + r[0] + "</th>" + sel.map(function (c) {
        var v = c.dataset[r[1]];
        if (r[1] === "vram" && Number(v) === 0) v = "Không có GPU rời";
        else if (r[2]) v += r[2];
        return "<td data-m=\"" + esc(c.dataset.name) + "\">" + esc(v) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    cmpNote.textContent = sel.length >= MAX_CMP ? "Đã chọn tối đa " + MAX_CMP + " máy để so sánh." : "Chọn thêm tối đa " + (MAX_CMP - sel.length) + " máy.";
  }

  list.addEventListener("change", function (e) {
    var box = e.target;
    if (!box.classList || !box.classList.contains("cmp-box")) return;
    if (box.checked && selected().length > MAX_CMP) {
      box.checked = false;
      cmpNote.textContent = "Chỉ so sánh tối đa " + MAX_CMP + " máy; bỏ chọn một máy trước.";
      return;
    }
    renderCompare();
  });
  form.addEventListener("input", applyFilter);
  form.addEventListener("submit", function (e) { e.preventDefault(); applyFilter(); });
  form.addEventListener("reset", function () { window.setTimeout(applyFilter, 0); });
  // Mở lần đầu: không chạy hiệu ứng, chỉ đặt trạng thái đúng
  items.forEach(function (li) { li.dataset.match = "1"; });
  applyFilter();
})();
