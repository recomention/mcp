// Empties dist/ before a build, so a file deleted or renamed in src/ never ships in the tarball.
import { rmSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
