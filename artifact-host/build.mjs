import { FRAME_FIND_AGENT_SCRIPT } from "../packages/shared/dist/find/frameFindAgent.generated.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const assets = {};
for (const name of ["bootstrap.js", "worker.js", "frame.js"])
  assets[name] = await readFile(new URL(name, root), "utf8");
assets["frame.js"] += `\n${FRAME_FIND_AGENT_SCRIPT}`;
await mkdir(new URL(".generated/", root), { recursive: true });
await writeFile(
  new URL(".generated/index.mjs", root),
  `import { serve } from "../host.mjs";\nconst assets = ${JSON.stringify(assets)};\nexport default { fetch(request, env) { return serve(request, assets, env); } };\n`,
);
