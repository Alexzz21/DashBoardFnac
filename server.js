import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DASH_USER = process.env.DASH_USER || 'kalamo';
const DASH_PASS = process.env.DASH_PASS || 'kalamo2024';

// Basic Auth
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Kalamo Dashboard"');
    return res.status(401).send('Acceso restringido');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === DASH_USER && pass === DASH_PASS) {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Kalamo Dashboard"');
    return res.status(401).send('Credenciales incorrectas');
  }
});

// Parse bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/*', limit: '10mb' }));

// === FNAC ROUTES ===
app.post('/api/fnac/auth', async (req, res) => {
  try {
    const r = await fetch('https://vendeur.fnac.com/api.php/auth', {
      method: 'POST', headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    res.set('Content-Type', 'text/xml').send(await r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fnac/offers_update', async (req, res) => {
  try {
    const r = await fetch('https://vendeur.fnac.com/api.php/offers_update', {
      method: 'POST', headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    res.set('Content-Type', 'text/xml').send(await r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fnac/offers_query', async (req, res) => {
  try {
    const r = await fetch('https://vendeur.fnac.com/api.php/offers_query', {
      method: 'POST', headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    res.set('Content-Type', 'text/xml').send(await r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === ODOO ROUTE ===
app.post('/odoo-api/jsonrpc', async (req, res) => {
  try {
    const odooUrl = process.env.ODOO_URL || 'https://javier-vela.odoo.com';
    const r = await fetch(`${odooUrl}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === CDL ROUTE ===
app.post('/cdl-api/api/offers/imports', async (req, res) => {
  try {
    const cdlUrl = process.env.CDL_URL || 'https://casadellibro-prod.mirakl.net';
    const r = await fetch(`${cdlUrl}/api/offers/imports`, {
      method: 'POST',
      headers: { ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => ['authorization', 'accept', 'content-type'].includes(k))) },
      body: req.body,
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve React
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kalamo Dashboard corriendo en puerto ${PORT}`);
});