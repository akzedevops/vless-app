import http from "http";

const PORT = process.env.PORT || 8080;

/**
 * Main entry point for handling HTTP requests
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      // Handle WebSocket upgrade requests
      if (upgradeHeader === "websocket") {
        return handleWebSocket(request);
      }

      // Health check endpoint
      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      // UUID path to return VLESS configuration
      if (url.pathname === `/${process.env.UUID}`) {
        console.log("UUID Path Accessed:", process.env.UUID); // Debug log
        return new Response(
          getVLESSConfig(process.env.UUID, request.headers.get("Host")),
          {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" },
          }
        );
      }

      // Root path
      if (url.pathname === "/") {
        return new Response("Welcome to the VLESS server!", { status: 200 });
      }

      // Default case for unknown paths
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};

/**
 * Handles WebSocket connections
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleWebSocket(request) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();

  console.log("WebSocket connection established!");

  server.addEventListener("message", (event) => {
    console.log("Received message:", event.data);
    server.send(`Echo: ${event.data}`); // Echo received message
  });

  server.addEventListener("close", () => {
    console.log("WebSocket connection closed.");
  });

  server.addEventListener("error", (err) => {
    console.error("WebSocket error:", err);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Generate VLESS configuration
 * @param {string} uuid
 * @param {string} host
 * @returns {string}
 */
function getVLESSConfig(uuid, host) {
  return `
################################################################
v2ray
---------------------------------------------------------------
vless://${uuid}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${host}
---------------------------------------------------------------
################################################################
clash-meta
---------------------------------------------------------------
- type: vless
  name: ${host}
  server: ${host}
  port: 443
  uuid: ${uuid}
  network: ws
  tls: true
  udp: false
  sni: ${host}
  client-fingerprint: chrome
  ws-opts:
    path: "/?ed=2048"
    headers:
      host: ${host}
---------------------------------------------------------------
################################################################
`;
}

// Create a simple HTTP server that differentiates WebSocket and HTTP requests
const server = http.createServer((req, res) => {
  // Handle WebSocket upgrade requests
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket") {
    const { socket, head } = req;
    const ws = new WebSocketPair();
    ws[1].accept();
    console.log("WebSocket connection established!");

    ws[1].on("message", (msg) => {
      console.log("WebSocket received:", msg);
      ws[1].send(`Echo: ${msg}`);
    });

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "\r\n"
    );
    return;
  }

  // Handle UUID path requests
  if (req.url === `/${process.env.UUID}`) {
    const config = getVLESSConfig(process.env.UUID, req.headers.host);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(config);
    return;
  }

  // Fallback response for HTTP requests
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("App is running\n");
});

// Listen on the expected port
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
