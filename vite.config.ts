import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/CT-NACS-MAP/',
  plugins: [react()],
});
