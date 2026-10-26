import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The site is served from https://ctrlz-frc4096.github.io/app/ until the
// app.team4096.org DNS record exists, and from the root of that domain after.
// A relative base works in both places, and the app uses #/ addresses, so no
// page ever needs a server to find it.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
