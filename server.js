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

// Proxies
app.use('/odoo-api', createProxyMiddleware({
  target: process.env.ODOO_URL || 'https://javier-vela.odoo.com',
  changeOrigin: true,
  pathRewrite: { '^/odoo-api': '' },
}));

app.use('/fnac-api', createProxyMiddleware({
  target: process.env.FNAC_URL || 'https://vendeur.fnac.com',
  changeOrigin: true,
  pathRewrite: { '^/fnac-api': '' },
}));

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