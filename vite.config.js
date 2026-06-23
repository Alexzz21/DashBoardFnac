import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/odoo-api': {
        target: 'https://javier-vela.odoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/odoo-api/, ''),
      },
      '/fnac-api': {
        target: 'https://vendeur.fnac.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fnac-api/, ''),
      },
    },
  },
})