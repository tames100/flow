import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需自动导入（组件与 API 均按需，自动注入对应样式）
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // 第三方库独立分包：主包更小、更新时其余包可命中缓存
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('node_modules/@vue-flow/')) return 'vue-flow'
          if (id.includes('node_modules/vue/') || id.includes('node_modules/@vue/')) return 'vue'
          if (id.includes('node_modules/element-plus')) return 'element-plus'
        },
      },
    },
  },
  server: {
    port: 8080,
    open: true,
  },
})
