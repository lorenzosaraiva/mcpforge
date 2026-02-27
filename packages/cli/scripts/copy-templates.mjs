import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("../core/src/generator/templates");
const destination = resolve("dist/templates");

if (existsSync(source)) {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
