import path from 'path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // IMPORTANT: The 'define' block has been removed to prevent exposing
  // the GEMINI_API_KEY in the client-side bundle. This is a critical
  // security measure. The API key should be entered by the user in the
  // UI and managed in-memory, never built into the application code.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
