import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/odoo-api', createProxyMiddleware({
  target: 'https://javier-vela.odoo.com',
  changeOrigin: true,
  pathRewrite: { '^/odoo-api': '' },
}));

app.use('/fnac-api', createProxyMiddleware({
  target: 'https://vendeur.fnac.com',
  changeOrigin: true,
  pathRewrite: { '^/fnac-api': '' },
}));

app.use('/cdl-api', createProxyMiddleware({
  target: 'https://casadellibro-prod.mirakl.net',
  changeOrigin: true,
  pathRewrite: { '^/cdl-api': '' },
}));

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kalamo Dashboard corriendo en puerto ${PORT}`);
});