// Ensure the app binds to port 8080
const PORT = process.env.PORT || 8080;

/**
 * Main entry point
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader === "websocket") {
        // Handle WebSocket requests
        return handleWebSocket(request);
      }

      // Handle HTTP requests
      switch (url.pathname) {
        case "/":
          return new Response("Welcome to the VLESS server!", { status: 200 });

        case `/${process.env.UUID}`:
          return new Response(getVLESSConfig(process.env.UUID, request.headers.get("Host")), {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" },
          });

        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
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

// Ensure the app listens on the correct port
console.log(`App is running on port ${PORT}`);
