import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Basic Auth
const DASH_USER = process.env.DASH_USER || 'kalamo';
const DASH_PASS = process.env.DASH_PASS || 'kalamo2024';

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Kalamo"');
      return res.status(401).send('Unauthorized');
    }
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user !== DASH_USER || pass !== DASH_PASS) {
      return res.status(401).send('Unauthorized');
    }
  } else {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Kalamo Dashboard"');
      return res.status(401).send('Acceso restringido');
    }
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user !== DASH_USER || pass !== DASH_PASS) {
      res.set('WWW-Authenticate', 'Basic realm="Kalamo Dashboard"');
      return res.status(401).send('Credenciales incorrectas');
    }
  }
  next();
});

app.use(express.text({ type: '*/*', limit: '10mb' }));

// === FNAC API ROUTES ===
app.post('/api/fnac/auth', async (req, res) => {
  try {
    const response = await fetch('https://vendeur.fnac.com/api.php/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: req.body,
    });
    const text = await response.text();
    res.set('Content-Type', 'text/xml').send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fnac/offers_update', async (req, res) => {
  try {
    const response = await fetch('https://vendeur.fnac.com/api.php/offers_update', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: req.body,
    });
    const text = await response.text();
    res.set('Content-Type', 'text/xml').send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fnac/offers_query', async (req, res) => {
  try {
    const response = await fetch('https://vendeur.fnac.com/api.php/offers_query', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
      body: req.body,
    });
    const text = await response.text();
    res.set('Content-Type', 'text/xml').send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ODOO PROXY ===
app.use('/odoo-api', createProxyMiddleware({
  target: process.env.ODOO_URL || 'https://javier-vela.odoo.com',
  changeOrigin: true,
  pathRewrite: { '^/odoo-api': '' },
}));

// === CDL PROXY ===
app.use('/cdl-api', createProxyMiddleware({
  target: process.env.CDL_URL || 'https://casadellibro-prod.mirakl.net',
  changeOrigin: true,
  pathRewrite: { '^/cdl-api': '' },
}));

// Serve React
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kalamo Dashboard corriendo en puerto ${PORT}`);
});