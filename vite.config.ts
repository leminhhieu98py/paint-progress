import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honour PORT so a harness that assigns a free port is obeyed; Vite reads
  // neither PORT nor npm's --port through `npm run` on its own.
  server: { port: Number(process.env.PORT) || 5173 },
})
