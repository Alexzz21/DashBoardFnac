const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy API calls to Odoo
app.use('/odoo-api', createProxyMiddleware({
  target: 'https://javier-vela.odoo.com',
  changeOrigin: true,
  pathRewrite: { '^/odoo-api': '' },
}));

// Proxy API calls to Fnac
app.use('/fnac-api', createProxyMiddleware({
  target: 'https://vendeur.fnac.com',
  changeOrigin: true,
  pathRewrite: { '^/fnac-api': '' },
}));

// Proxy API calls to Casa del Libro
app.use('/cdl-api', createProxyMiddleware({
  target: 'https://casadellibro-prod.mirakl.net',
  changeOrigin: true,
  pathRewrite: { '^/cdl-api': '' },
}));

// Serve React build
app.use(express.static(path.join(__dirname, 'dist')));

// All other routes serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kalamo Dashboard corriendo en puerto ${PORT}`);
});
