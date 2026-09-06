import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    /*
     * `.tsx` DE TOPLANIR.
     *
     * Kalıp yalnızca `*.test.ts` iken, bir bileşen testi `.test.tsx` diye
     * yazıldığında vitest onu HİÇ görmüyordu: hata vermez, atlandığını
     * söylemez, "hepsi geçti" der. Ölçüldü — içinde `expect(1).toBe(2)`
     * olan bir `.test.tsx` dosyası diskte dururken suite yeşil kalıyordu.
     *
     * Sessizce atlanan bir test, olmayan bir testten daha kötüdür: olmayan
     * testin yokluğu görülür, atlananınki görülmez.
     */
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
