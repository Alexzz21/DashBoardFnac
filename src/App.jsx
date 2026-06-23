import { useState, useEffect, useRef, useCallback } from "react";

const FNAC_PARTNER = "10C11611-199E-B744-24BF-14BFA63EBB22";
const FNAC_SHOP = "2ED8F7EC-28CA-0DF5-B898-F42C3AB4C585";
const FNAC_KEY = "E2764892-BD7E-982F-4571-2D62DDDFB8A1";

const STATES = { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done", ERROR: "error" };

function formatNum(n) { return (n || 0).toLocaleString("es-ES"); }
function ts() { return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

function getTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

export default function App() {
  const [config, setConfig] = useState({
    odooUrl: "https://javier-vela.odoo.com",
    odooDb: "javier-vela",
    odooUser: "kalamo.web@gmail.com",
    odooKey: "",
    odooUid: null,
    batchSize: 1000,
    offerBatchSize: 20,
    delayMs: 1000,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [status, setStatus] = useState(STATES.IDLE);
  const [stats, setStats] = useState({
    totalOdoo: 0, processed: 0, uniqueISBN: 0,
    published: 0, updated: 0, errors: 0, rejected: 0,
    duplicates: 0, noBarcode: 0, currentBatch: 0, totalBatches: 0,
    offersInFnac: 0, startedAt: null, lastUpdate: null,
  });
  const [logs, setLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState("overview");
  const [fnacToken, setFnacToken] = useState(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fnac-dashboard-state");
      if (saved) {
        const data = JSON.parse(saved);
        if (data.config) setConfig(c => ({ ...c, ...data.config }));
        if (data.stats) setStats(s => ({ ...s, ...data.stats }));
        if (data.products) setProducts(data.products.slice(0, 500));
      }
    } catch (e) {}
  }, []);

  const saveState = useCallback((s, p, c) => {
    try {
      localStorage.setItem("fnac-dashboard-state", JSON.stringify({
        config: { odooUrl: c.odooUrl, odooDb: c.odooDb, odooUser: c.odooUser, batchSize: c.batchSize },
        stats: s, products: (p || []).slice(0, 500),
      }));
    } catch (e) {}
  }, []);

  const addLog = useCallback((msg, type = "info") => {
    setLogs(prev => [{ time: ts(), msg, type }, ...prev].slice(0, 200));
  }, []);

  // Odoo JSON-RPC
  async function odooAuth(db, user, key) {
    const res = await fetch("/odoo-api/jsonrpc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call",
        params: { service: "common", method: "authenticate", args: [db, user, key, {}] } }),
    });
    const data = await res.json();
    return data.result;
  }

  async function odooCall(db, uid, key, model, method, domain, fields, limit, offset) {
    const res = await fetch("/odoo-api/jsonrpc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call",
        params: { service: "object", method: "execute_kw",
          args: [db, uid, key, model, method, [domain], { fields, limit, offset }] } }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Odoo error");
    return data.result;
  }

  async function odooCount(db, uid, key, model, domain) {
    const res = await fetch("/odoo-api/jsonrpc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call",
        params: { service: "object", method: "execute_kw",
          args: [db, uid, key, model, "search_count", [domain]] } }),
    });
    const data = await res.json();
    return data.result || 0;
  }

  // Fnac API
  async function fnacAuth() {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<auth xmlns="http://www.fnac.com/schemas/mp-dialog.xsd">
  <partner_id>${FNAC_PARTNER}</partner_id>
  <shop_id>${FNAC_SHOP}</shop_id>
  <key>${FNAC_KEY}</key>
</auth>`;
    const res = await fetch("/api/fnac/auth", {
      method: "POST", headers: { "Content-Type": "text/xml", "Accept": "text/xml" }, body: xml,
    });
    const text = await res.text();
    const token = getTag(text, 'token');
    if (!token) throw new Error("No se pudo obtener token de Fnac");
    return token;
  }

  async function fnacPublishBatch(token, offers) {
    let offersXml = '';
    for (const o of offers) {
      offersXml += `  <offer>
    <product_reference type="Ean">${o.isbn}</product_reference>
    <offer_reference type="SellerSku"><![CDATA[KALAMO-${o.isbn}]]></offer_reference>
    <price>${o.price}</price>
    <product_state>11</product_state>
    <quantity>${Math.max(0, Math.floor(o.qty))}</quantity>
    <description><![CDATA[Libro nuevo]]></description>
  </offer>\n`;
    }
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<offers_update xmlns="http://www.fnac.com/schemas/mp-dialog.xsd" partner_id="${FNAC_PARTNER}" shop_id="${FNAC_SHOP}" token="${token}">
${offersXml}</offers_update>`;
    const res = await fetch("/api/fnac/offers_update", {
      method: "POST", headers: { "Content-Type": "text/xml", "Accept": "text/xml" }, body: xml,
    });
    const text = await res.text();
    const batchId = getTag(text, 'batch_id');
    const error = getTag(text, 'error');
    return { batchId, error, raw: text.substring(0, 200) };
  }

  async function fnacGetOfferCount(token) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<offers_query xmlns="http://www.fnac.com/schemas/mp-dialog.xsd" partner_id="${FNAC_PARTNER}" shop_id="${FNAC_SHOP}" token="${token}">
  <paging>1</paging>
</offers_query>`;
    const res = await fetch("/api/fnac/offers_query", {
      method: "POST", headers: { "Content-Type": "text/xml", "Accept": "text/xml" }, body: xml,
    });
    const text = await res.text();
    return parseInt(getTag(text, 'nb_total_result')) || 0;
  }

  // Main processing
  async function startProcessing() {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setStatus(STATES.RUNNING);
    const c = config;
    addLog("Iniciando publicación masiva en Fnac...", "info");

    try {
      // Auth Odoo
      addLog("Autenticando en Odoo...");
      let uid = c.odooUid;
      if (!uid) {
        uid = await odooAuth(c.odooDb, c.odooUser, c.odooKey);
        if (!uid) throw new Error("Auth Odoo fallida");
        setConfig(prev => ({ ...prev, odooUid: uid }));
        addLog(`Odoo OK. UID: ${uid}`, "success");
      }

      // Auth Fnac
      addLog("Autenticando en Fnac...");
      let token = await fnacAuth();
      setFnacToken(token);
      addLog(`Fnac OK. Token obtenido.`, "success");
      let tokenTime = Date.now();

      // Count products
      addLog("Contando productos en Odoo...");
      const domain = [["qty_available", ">", 0], ["barcode", "!=", false]];
      const totalCount = await odooCount(c.odooDb, uid, c.odooKey, "product.product", domain);
      const totalBatches = Math.ceil(totalCount / c.batchSize);
      addLog(`Total: ${formatNum(totalCount)} productos con stock (${totalBatches} lotes)`, "info");
      setStats(s => ({ ...s, totalOdoo: totalCount, totalBatches, startedAt: new Date().toISOString() }));

      // Check current Fnac offers
      try {
        const count = await fnacGetOfferCount(token);
        setStats(s => ({ ...s, offersInFnac: count }));
        addLog(`Ofertas actuales en Fnac: ${formatNum(count)}`, "info");
      } catch (e) { addLog("No se pudo consultar ofertas Fnac: " + e.message, "warn"); }

      let offset = 0;
      let batchNum = 0;
      const isbnMap = {};

      while (!stopRef.current) {
        batchNum++;
        addLog(`Lote ${batchNum}/${totalBatches}: Obteniendo de Odoo (offset ${offset})...`);

        const batch = await odooCall(c.odooDb, uid, c.odooKey,
          "product.product", "search_read", domain,
          ["id", "name", "default_code", "barcode", "list_price", "qty_available"],
          c.batchSize, offset);

        if (!batch || batch.length === 0) {
          addLog("No hay más productos. Completado.", "success");
          break;
        }

        // Dedup
        let newUnique = 0, dupes = 0, noBar = 0;
        for (const p of batch) {
          if (!p.barcode) { noBar++; continue; }
          if (isbnMap[p.barcode]) {
            isbnMap[p.barcode].qty += (p.qty_available || 0);
            dupes++;
          } else {
            isbnMap[p.barcode] = {
              isbn: p.barcode, name: p.name, price: p.list_price || 0,
              qty: p.qty_available || 0, status: "pending",
            };
            newUnique++;
          }
        }

        setStats(s => ({
          ...s, processed: s.processed + batch.length, uniqueISBN: Object.keys(isbnMap).length,
          duplicates: s.duplicates + dupes, noBarcode: s.noBarcode + noBar,
          currentBatch: batchNum, lastUpdate: new Date().toISOString(),
        }));
        addLog(`${newUnique} únicos, ${dupes} duplicados, ${noBar} sin código`, "info");

        // Refresh token every 20 minutes
        if (Date.now() - tokenTime > 20 * 60 * 1000) {
          addLog("Renovando token Fnac...");
          token = await fnacAuth();
          setFnacToken(token);
          tokenTime = Date.now();
          addLog("Token renovado.", "success");
        }

        // Publish to Fnac in sub-batches
        const pending = Object.values(isbnMap).filter(p => p.status === "pending");
        if (pending.length > 0) {
          addLog(`Publicando ${pending.length} ofertas en Fnac...`);
          let pubCount = 0, errCount = 0;

          for (let i = 0; i < pending.length; i += c.offerBatchSize) {
            if (stopRef.current) break;
            const subBatch = pending.slice(i, i + c.offerBatchSize);

            try {
              const result = await fnacPublishBatch(token, subBatch);
              if (result.batchId) {
                pubCount += subBatch.length;
                for (const p of subBatch) isbnMap[p.isbn].status = "published";
                addLog(`Batch ${result.batchId} — ${subBatch.length} ofertas enviadas`, "success");
              } else if (result.error) {
                if (result.error.includes("Authentication failed")) {
                  addLog("Token expirado, renovando...", "warn");
                  token = await fnacAuth();
                  setFnacToken(token);
                  tokenTime = Date.now();
                  i -= c.offerBatchSize; // retry
                  continue;
                }
                errCount += subBatch.length;
                for (const p of subBatch) isbnMap[p.isbn].status = "error";
                addLog(`Error: ${result.error}`, "error");
              }
            } catch (e) {
              errCount += subBatch.length;
              for (const p of subBatch) isbnMap[p.isbn].status = "error";
              addLog(`Error enviando lote: ${e.message}`, "error");
            }

            await new Promise(r => setTimeout(r, c.delayMs));
          }

          setStats(s => ({
            ...s, published: s.published + pubCount, errors: s.errors + errCount,
          }));
        }

        const prodList = Object.values(isbnMap);
        setProducts(prodList);
        saveState(stats, prodList, config);

        offset += c.batchSize;
        if (batch.length < c.batchSize) {
          addLog("Último lote procesado. Completado.", "success");
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (stopRef.current) {
        addLog("Pausado por el usuario.", "warn");
        setStatus(STATES.PAUSED);
      } else {
        try {
          const finalCount = await fnacGetOfferCount(token);
          setStats(s => ({ ...s, offersInFnac: finalCount }));
          addLog(`Ofertas finales en Fnac: ${formatNum(finalCount)}`, "success");
        } catch (e) {}
        setStatus(STATES.DONE);
      }
    } catch (e) {
      addLog(`Error fatal: ${e.message}`, "error");
      setStatus(STATES.ERROR);
    }
    runningRef.current = false;
  }

  function stopProcessing() { stopRef.current = true; addLog("Deteniendo...", "warn"); }

  function resetStats() {
    setStats({ totalOdoo: 0, processed: 0, uniqueISBN: 0, published: 0, updated: 0,
      errors: 0, rejected: 0, duplicates: 0, noBarcode: 0, currentBatch: 0,
      totalBatches: 0, offersInFnac: 0, startedAt: null, lastUpdate: null });
    setProducts([]); setLogs([]); setStatus(STATES.IDLE);
    localStorage.removeItem("fnac-dashboard-state");
  }

  async function checkFnacOffers() {
    try {
      addLog("Consultando ofertas en Fnac...");
      const token = await fnacAuth();
      const count = await fnacGetOfferCount(token);
      setStats(s => ({ ...s, offersInFnac: count }));
      addLog(`Ofertas activas en Fnac: ${formatNum(count)}`, "success");
    } catch (e) { addLog(`Error: ${e.message}`, "error"); }
  }

  const pct = stats.totalOdoo > 0 ? Math.round((stats.processed / stats.totalOdoo) * 100) : 0;

  return (
    <div style={{ background: "#0a0a0b", minHeight: "100vh", color: "#e4e4e7", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ borderBottom: "1px solid #1e1e22", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #e8a020, #f5b027)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#000" }}>fn</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Kalamo Marketplace Hub</div>
            <div style={{ fontSize: 11, color: "#71717a" }}>Fnac — Publicación de ofertas</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: status === STATES.RUNNING ? "#e8a02033" : status === STATES.DONE ? "#16a34a33" : status === STATES.ERROR ? "#dc262633" : "#27272a",
            color: status === STATES.RUNNING ? "#f5b027" : status === STATES.DONE ? "#4ade80" : status === STATES.ERROR ? "#f87171" : "#a1a1aa" }}>
            {status === STATES.RUNNING ? "● Ejecutando" : status === STATES.DONE ? "✓ Completado" : status === STATES.ERROR ? "✗ Error" : status === STATES.PAUSED ? "❚❚ Pausado" : "○ Inactivo"}
          </span>
          <button onClick={() => setShowConfig(!showConfig)} style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "6px 12px", color: "#a1a1aa", fontSize: 12, cursor: "pointer" }}>⚙ Config</button>
        </div>
      </div>

      {showConfig && (
        <div style={{ background: "#111113", borderBottom: "1px solid #1e1e22", padding: "16px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 900 }}>
            {[["Odoo URL", "odooUrl"], ["Odoo DB", "odooDb"], ["Odoo User", "odooUser"],
              ["Odoo API Key", "odooKey"], ["Batch Odoo", "batchSize"], ["Batch Fnac", "offerBatchSize"],
            ].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "#71717a", display: "block", marginBottom: 4 }}>{label}</label>
                <input type={key === "odooKey" ? "password" : "text"} value={config[key]}
                  onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                  style={{ width: "100%", background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "6px 10px", color: "#e4e4e7", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "12px 24px", borderBottom: "1px solid #1e1e22", display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={startProcessing} disabled={status === STATES.RUNNING}
          style={{ background: status === STATES.RUNNING ? "#27272a" : "#e8a020", border: "none", borderRadius: 6,
            padding: "8px 20px", color: status === STATES.RUNNING ? "#52525b" : "#000", fontSize: 13, fontWeight: 600, cursor: status === STATES.RUNNING ? "default" : "pointer" }}>
          ▶ {status === STATES.PAUSED ? "Reanudar" : "Iniciar publicación"}
        </button>
        <button onClick={stopProcessing} disabled={status !== STATES.RUNNING}
          style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "8px 16px",
            color: status === STATES.RUNNING ? "#f59e0b" : "#52525b", fontSize: 13, cursor: status === STATES.RUNNING ? "pointer" : "default" }}>
          ❚❚ Pausar
        </button>
        <button onClick={checkFnacOffers} style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "8px 16px", color: "#a1a1aa", fontSize: 13, cursor: "pointer" }}>↻ Ofertas Fnac</button>
        <div style={{ flex: 1 }} />
        <button onClick={resetStats} style={{ background: "transparent", border: "1px solid #3f3f46", borderRadius: 6, padding: "8px 14px", color: "#71717a", fontSize: 12, cursor: "pointer" }}>Reset</button>
      </div>

      <div style={{ padding: "0 24px", borderBottom: "1px solid #1e1e22", display: "flex", gap: 0 }}>
        {["overview", "products", "logs"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "transparent", border: "none", borderBottom: tab === t ? "2px solid #f5b027" : "2px solid transparent",
            padding: "10px 16px", color: tab === t ? "#e4e4e7" : "#71717a", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            {t === "overview" ? "Resumen" : t === "products" ? `Productos (${formatNum(stats.uniqueISBN)})` : `Log (${logs.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {tab === "overview" && (<>
          {stats.totalOdoo > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#71717a", marginBottom: 6 }}>
                <span>Lote {stats.currentBatch} de {stats.totalBatches}</span>
                <span>{formatNum(stats.processed)} / {formatNum(stats.totalOdoo)} registros ({pct}%)</span>
              </div>
              <div style={{ height: 6, background: "#18181b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #e8a020, #f5b027)", borderRadius: 3, transition: "width 0.5s" }} />
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Ofertas en Fnac", value: formatNum(stats.offersInFnac), color: "#f5b027", sub: "activas" },
              { label: "ISBN únicos", value: formatNum(stats.uniqueISBN), color: "#a78bfa", sub: "deduplicados" },
              { label: "Publicadas", value: formatNum(stats.published), color: "#34d399", sub: "enviadas a Fnac" },
              { label: "Errores", value: formatNum(stats.errors), color: stats.errors > 0 ? "#f87171" : "#71717a", sub: "rechazadas por Fnac" },
            ].map((s, i) => (
              <div key={i} style={{ background: "#111113", borderRadius: 10, padding: "14px 16px", border: "1px solid #1e1e22" }}>
                <div style={{ fontSize: 11, color: "#71717a", marginBottom: 6, fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "-0.03em" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#52525b", marginTop: 4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              { label: "Procesados Odoo", value: formatNum(stats.processed), color: "#e4e4e7" },
              { label: "Duplicados", value: formatNum(stats.duplicates), color: "#a78bfa" },
              { label: "Sin código barras", value: formatNum(stats.noBarcode), color: "#71717a" },
            ].map((s, i) => (
              <div key={i} style={{ background: "#111113", borderRadius: 8, padding: "12px 14px", border: "1px solid #1e1e22" }}>
                <div style={{ fontSize: 11, color: "#52525b", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </>)}

        {tab === "products" && (
          <div style={{ background: "#111113", borderRadius: 10, border: "1px solid #1e1e22", overflow: "hidden" }}>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#18181b", position: "sticky", top: 0 }}>
                    {["ISBN", "Nombre", "Precio", "Stock", "Estado"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#71717a", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #27272a" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, 200).map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e1e22" }}>
                      <td style={{ padding: "6px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#a1a1aa" }}>{p.isbn}</td>
                      <td style={{ padding: "6px 12px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                      <td style={{ padding: "6px 12px", fontFamily: "'JetBrains Mono', monospace", color: "#a1a1aa" }}>{p.price?.toFixed(2)}€</td>
                      <td style={{ padding: "6px 12px", fontFamily: "'JetBrains Mono', monospace", color: p.qty > 0 ? "#34d399" : "#f87171" }}>{Math.floor(p.qty)}</td>
                      <td style={{ padding: "6px 12px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: p.status === "published" ? "#f5b02722" : p.status === "error" ? "#dc262622" : "#27272a",
                          color: p.status === "published" ? "#f5b027" : p.status === "error" ? "#f87171" : "#71717a" }}>
                          {p.status === "published" ? "Publicado" : p.status === "error" ? "Error" : "Pendiente"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {products.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: "#52525b" }}>No hay productos procesados. Inicia la publicación.</div>
              )}
            </div>
          </div>
        )}

        {tab === "logs" && (
          <div style={{ background: "#0d0d0e", borderRadius: 10, border: "1px solid #1e1e22", padding: 2, maxHeight: 500, overflowY: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {logs.map((log, i) => (
              <div key={i} style={{ padding: "4px 12px", borderBottom: "1px solid #111113", display: "flex", gap: 10 }}>
                <span style={{ color: "#3f3f46", flexShrink: 0 }}>{log.time}</span>
                <span style={{ color: log.type === "success" ? "#34d399" : log.type === "error" ? "#f87171" : log.type === "warn" ? "#f59e0b" : "#a1a1aa" }}>{log.msg}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "#52525b" }}>Sin actividad. Inicia la publicación para ver el log.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}