/* config firebase */
const CFG = { apiKey: "", authDomain: "", databaseURL: "", projectId: "" };

const DEMO = !CFG.databaseURL;
const SEED = {
  stock: {
    t1: { nama: "Paracetamol 500mg", tabung: 1, stok: 40, max: 50 },
    t2: { nama: "Amoxicillin 500mg", tabung: 2, stok: 6, max: 30 },
    t3: { nama: "CTM 4mg", tabung: 3, stok: 25, max: 40 },
    t4: { nama: "Vitamin C 100mg", tabung: 4, stok: 0, max: 30 },
  },
};

let DB;
if (!DEMO) {
  firebase.initializeApp(CFG);
  const ref = (p) => firebase.database().ref(p);
  DB = {
    on: (p, cb) => ref(p).on("value", (s) => cb(s.val())),
    set: (p, v) => ref(p).set(v),
  };
} else {
  const store = JSON.parse(JSON.stringify(SEED));
  const listeners = [];
  const get = (p) =>
    p.split("/").filter(Boolean).reduce((o, k) => o && o[k], store) ?? null;
  DB = {
    on: (p, cb) => {
      listeners.push([p, cb]);
      cb(get(p));
    },
    set: (p, v) => {
      const keys = p.split("/").filter(Boolean);
      const last = keys.pop();
      let o = store;
      keys.forEach((k) => (o = o[k] = o[k] || {}));
      o[last] = v;
      listeners.forEach(([q, cb]) => cb(get(q)));
      return Promise.resolve();
    },
  };
}

function $(id) {
  return document.getElementById(id);
}
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const fmt = (t) => new Date(t).toLocaleString("id-ID", { hour12: false });
const STATUS_CLASS = {
  OPEN: "text-bg-warning",
  PROCESSING: "text-bg-info",
  CLOSED: "text-bg-success",
  GAGAL: "text-bg-danger",
};
let stock = {};
let rxs = {};

DB.on("/stock", (v) => {
  stock = v || {};
  renderStock();
  refreshSelects();
});

function renderStock() {
  const list = Object.values(stock);
  $("stock").innerHTML = list.length
    ? list
        .map((o) => {
          const pct = Math.min(100, Math.round((o.stok / (o.max || 50)) * 100));
          const state = o.stok === 0 ? "danger" : o.stok <= 8 ? "warning" : "success";
          const note = o.stok === 0 ? " · habis" : o.stok <= 8 ? " · menipis" : "";
          return `
        <div class="col-6">
          <div class="card h-100 stock-card ${state === "success" ? "" : "border-" + state}">
            <div class="card-body p-2 px-3">
              <small class="text-secondary">Tabung ${o.tabung}</small>
              <div class="fw-semibold">${esc(o.nama)}</div>
              <small class="text-secondary">${o.stok} butir${note}</small>
              <div class="progress mt-1" style="height:6px">
                <div class="progress-bar bg-${state}" style="width:${pct}%"></div>
              </div>
            </div>
          </div>
        </div>`;
        })
        .join("")
    : '<div class="text-secondary small">Belum ada data stok di /stock.</div>';
}

function options() {
  return Object.entries(stock)
    .map(([k, o]) => `<option value="${k}">${esc(o.nama)} (stok ${o.stok})</option>`)
    .join("");
}

function addRow() {
  if ($("items").children.length >= 4) {
    return flash("Maksimal 4 obat per resep (4 tabung).", "danger");
  }
  const row = document.createElement("div");
  row.className = "input-group mb-2";
  row.innerHTML = `
    <select class="form-select" aria-label="Obat">${options()}</select>
    <input type="number" min="1" value="1" class="form-control jumlah" aria-label="Jumlah butir" />
    <button type="button" class="btn btn-outline-danger" aria-label="Hapus baris">✕</button>`;
  row.querySelector("button").onclick = () => row.remove();
  $("items").appendChild(row);
}

function refreshSelects() {
  document.querySelectorAll("#items select").forEach((s) => {
    const v = s.value;
    s.innerHTML = options();
    s.value = v;
  });
}

function flash(text, type) {
  const m = $("msg");
  m.textContent = text;
  m.className = `alert alert-${type} mt-3 mb-0 py-2 small`;
}

$("add").onclick = addRow;

/* Kirim resep */
$("send").onclick = async () => {
  const dokter = $("dokter").value.trim();
  const pasien = $("pasien").value.trim();
  if (!dokter || !pasien) return flash("Nama dokter dan pasien wajib diisi.", "danger");

  const sum = {};
  document.querySelectorAll("#items .input-group").forEach((r) => {
    const k = r.querySelector("select").value;
    const n = parseInt(r.querySelector("input").value, 10) || 0;
    if (k && n > 0) sum[k] = (sum[k] || 0) + n;
  });

  const keys = Object.keys(sum);
  if (!keys.length) return flash("Tambahkan minimal satu obat dengan jumlah lebih dari 0.", "danger");

  for (const k of keys) {
    const o = stock[k];
    if (!o || o.stok < sum[k]) {
      return flash(
        `Stok ${o ? o.nama : k} tidak cukup: diminta ${sum[k]}, tersedia ${o ? o.stok : 0}. Resep tidak dikirim.`,
        "danger",
      );
    }
  }

  const ts = Date.now();
  const id = "RX-" + ts.toString(36).toUpperCase();
  const items = keys.map((k) => ({ obat: stock[k].nama, tabung: stock[k].tabung, jumlah: sum[k] }));
  const rx = {
    id_resep: id,
    dokter,
    pasien,
    items,
    total: items.reduce((a, b) => a + b.jumlah, 0),
    status: "OPEN",
    timestamp: ts,
  };

  $("send").disabled = true;
  try {
    await DB.set("/prescriptions/" + id, rx);
    await DB.set("/active_command", {
      id_perintah: "CMD-" + ts,
      id_resep: id,
      items,
      jumlah_obat: rx.total,
      timestamp: ts,
    });
    flash(`Resep ${id} terkirim. Menunggu ESP32 memproses.`, "success");
    $("items").innerHTML = "";
    addRow();
    $("pasien").value = "";
    if (DEMO) simulate(rx);
  } catch (e) {
    flash("Gagal mengirim ke Firebase: " + e.message, "danger");
  }
  $("send").disabled = false;
};

/*status*/
DB.on("/prescriptions", (v) => {
  rxs = v || {};
  renderRx();
});

function renderRx() {
  const list = Object.values(rxs).sort((a, b) => b.timestamp - a.timestamp);
  $("rx").innerHTML = list.length
    ? `<table class="table table-sm align-middle small mb-0">
        <thead><tr><th>Resep</th><th>Pasien</th><th>Obat</th><th>Status</th></tr></thead>
        <tbody>${list
          .map(
            (r) => `<tr>
              <td><b>${esc(r.id_resep)}</b><br><span class="text-secondary">${fmt(r.timestamp)}</span></td>
              <td>${esc(r.pasien)}<br><span class="text-secondary">${esc(r.dokter)}</span></td>
              <td>${(r.items || []).map((i) => `${esc(i.obat)} × ${i.jumlah}`).join("<br>")}</td>
              <td><span class="badge rounded-pill ${STATUS_CLASS[r.status] || "text-bg-secondary"}">${esc(r.status)}</span></td>
            </tr>`,
          )
          .join("")}</tbody></table>`
    : '<div class="text-secondary small">Belum ada resep. Isi form di kiri lalu kirim.</div>';
}

DB.on("/execution_logs", (v) => {
  const list = Object.values(v || {})
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30);
  $("logs").innerHTML = list.length
    ? list
        .map(
          (l) =>
            `<li class="list-group-item px-0 text-secondary">${fmt(l.timestamp)} · ${esc(l.id_resep || "")} · ${esc(l.pesan || l.status || "")}</li>`,
        )
        .join("")
    : '<li class="list-group-item px-0 text-secondary">Belum ada log dari mesin.</li>';
});

/*ESP32*/
function simulate(rx) {
  const log = (pesan) =>
    DB.set("/execution_logs/L" + Date.now() + Math.random().toString(36).slice(2, 5), {
      id_resep: rx.id_resep,
      pesan,
      timestamp: Date.now(),
    });

  setTimeout(() => {
    DB.set("/prescriptions/" + rx.id_resep, { ...rx, status: "PROCESSING" });
    log("ESP32 menerima perintah, servo membuka katup");
  }, 1500);

  setTimeout(() => log("Sensor IR menghitung " + rx.total + " butir"), 3500);

  setTimeout(() => {
    rx.items.forEach((i) => {
      const k = Object.keys(stock).find((x) => stock[x].tabung === i.tabung);
      if (k) DB.set("/stock/" + k, { ...stock[k], stok: stock[k].stok - i.jumlah });
    });
    DB.set("/prescriptions/" + rx.id_resep, { ...rx, status: "CLOSED" });
    log("Load Cell OK, buzzer & LED aktif: obat siap diambil");
  }, 5500);
}

DB.on("/stock", () => {
  if (!$("items").children.length) addRow();
});