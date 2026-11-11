import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  // Runs in browsers (Vertex's webview) as well as Node.
  platform: 'neutral',
  dts: true,
});
