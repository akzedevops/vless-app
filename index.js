import http from "http";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;

/**
 * Main server logic
 */
const server = http.createServer((req, res) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket") {
    handleWebSocket(req, res.socket, req.headers);
    return;
  }

  // Handle UUID path requests
  if (req.url === `/${process.env.UUID}`) {
    const vlessConfig = getVLESSConfig(process.env.UUID, req.headers.host);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(vlessConfig);
    return;
  }

  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // Fallback response for HTTP requests
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("App is running\n");
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

/**
 * Handles WebSocket connections
 * @param {http.IncomingMessage} req
 * @param {net.Socket} socket
 * @param {Object} headers
 */
function handleWebSocket(req, socket, headers) {
  const key = headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Generate the Sec-WebSocket-Accept key
  const acceptKey = generateAcceptValue(key);

  // Send the WebSocket handshake response WITHOUT subprotocol
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  console.log("WebSocket connection established!");

  // Handle WebSocket data frames
  socket.on("data", (data) => {
    console.log("Received WebSocket data:", data.toString());
    socket.write(constructWebSocketFrame(data.toString())); // Echo message
  });

  socket.on("close", () => {
    console.log("WebSocket connection closed.");
  });

  socket.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
}

/**
 * Constructs a WebSocket frame for the given message
 * @param {string} message
 * @returns {Buffer}
 */
function constructWebSocketFrame(message) {
  const messageBuffer = Buffer.from(message, "utf-8");
  const length = messageBuffer.length;

  let frame = Buffer.alloc(length + 2);
  frame[0] = 0x81; // FIN and Text Frame opcode
  frame[1] = length; // No masking and message length

  messageBuffer.copy(frame, 2);
  return frame;
}

/**
 * Generate Sec-WebSocket-Accept header value
 * @param {string} acceptKey
 * @returns {string}
 */
function generateAcceptValue(acceptKey) {
  return crypto
    .createHash("sha1")
    .update(`${acceptKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, "binary")
    .digest("base64");
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
