import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const reservedLayers = new Set(["base", "components", "utilities"]);

function isolateCopilotKitLayers() {
  return {
    postcssPlugin: "isolate-copilotkit-layers",
    Once(root, { result }) {
      const from = String(result.opts.from ?? "");
      if (!from.includes("node_modules/@copilotkit")) return;
      root.walkAtRules("layer", (rule) => {
        if (reservedLayers.has(rule.params)) rule.params = `copilotkit-${rule.params}`;
      });
    },
  };
}
isolateCopilotKitLayers.postcss = true;

export default {
  plugins: [isolateCopilotKitLayers(), tailwindcss(), autoprefixer()],
};
