// Genera prisma/schema.local.prisma (SQLite) a partir de prisma/schema.prisma
// (Postgres) para poder correr `npm run dev` en local sin depender de una base
// de datos Postgres real. El schema.prisma committeado se queda intacto —
// Coolify/producción lo usa tal cual, con provider "postgresql".
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, "..", "prisma", "schema.prisma");
const targetPath = join(__dirname, "..", "prisma", "schema.local.prisma");

const source = readFileSync(sourcePath, "utf8");

const local = source.replace(
  /datasource db \{[^}]*\}/,
  `datasource db {\n  provider = "sqlite"\n  url      = "file:./dev.sqlite"\n}`,
);

writeFileSync(targetPath, local);
console.log(`Generado ${targetPath} (sqlite) a partir de schema.prisma (postgresql)`);
