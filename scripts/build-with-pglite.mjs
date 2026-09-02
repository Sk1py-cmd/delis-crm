import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: environment });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Build exited with ${signal ?? `code ${code ?? 1}`}`));
    });
  });
}

const database = new PGlite();
const server = new PGLiteSocketServer({
  db: database,
  host: "127.0.0.1",
  port: 0,
  maxConnections: 32,
});

try {
  await server.start();
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    ...process.env,
    DATABASE_URL: `postgresql://postgres@${server.getServerConn()}/postgres`,
    OWNER_LOGIN: "build-owner",
    OWNER_PASSWORD: randomBytes(24).toString("base64url"),
    OWNER_NAME: "Build Owner",
    SEED_DEMO_DATA: "false",
  });
} finally {
  await server.stop();
  await database.close();
}
