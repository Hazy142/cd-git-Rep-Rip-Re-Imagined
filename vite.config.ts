
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // Fix: Re-instated the 'define' block to correctly provide the API key to the client-side code.
  // Per @google/genai guidelines, the API key must be provided via process.env.API_KEY.
  // For a client-side Vite app, this requires using the `define` config to make it available.
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
  },
});
