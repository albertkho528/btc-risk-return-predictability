// @ts-check
import { defineConfig } from "astro/config";

// A fully static site: `npm run build` writes plain HTML, CSS and JS to dist/.
export default defineConfig({
  // The public address; used for absolute links such as the share image.
  site: "https://btc-risk-return-predictability.vercel.app",
  output: "static",
  build: { inlineStylesheets: "auto" },
});
