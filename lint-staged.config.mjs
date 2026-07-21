/** @type {import("lint-staged").Configuration} */
const config = {
  "*.{js,jsx,mjs,cjs,ts,tsx}": [
    "eslint --fix --max-warnings=0",
    "prettier --write",
  ],
  "*.{css,json,jsonc,md,mdx,yaml,yml}": "prettier --write",
};

export default config;
