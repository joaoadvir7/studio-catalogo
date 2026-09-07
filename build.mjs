import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
for (const name of ["index.html", "app.js", "style.css"]) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
console.log("dist ok");
