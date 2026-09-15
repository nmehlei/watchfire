// Thin wrapper for Azure App Service (Windows / iisnode) compatibility.
// Patches the named-pipe PORT handling, then loads the Next.js standalone
// server. This is the standard iisnode pattern for running a Next.js
// standalone server on Windows App Service.
//
// Azure sets PORT to a named pipe (\\.\pipe\xxx), not a number. Next's
// standalone server does parseInt(PORT) which yields NaN for a pipe and
// falls back to 3000 — which iisnode isn't listening on. This wrapper
// patches Server.listen() to bind the named pipe instead.

const http = require("http");
const originalListen = http.Server.prototype.listen;
const azurePort = process.env.PORT;

if (azurePort && isNaN(parseInt(azurePort, 10))) {
  delete process.env.PORT;

  http.Server.prototype.listen = function (port, ...args) {
    return originalListen.call(this, azurePort, ...args);
  };
}

// Load the original Next.js standalone server (renamed during packaging).
// It sits under its workspace path because Next traces the standalone
// output from the monorepo root, mirroring apps/dashboard/ inside it.
require("./apps/dashboard/next-server.js");
