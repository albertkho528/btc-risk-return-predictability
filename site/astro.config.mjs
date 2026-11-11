// @ts-check
import { defineConfig } from "astro/config";

// A fully static site: `npm run build` writes plain HTML, CSS and JS to dist/.
export default defineConfig({
  output: "static",
  build: { inlineStylesheets: "auto" },
});
