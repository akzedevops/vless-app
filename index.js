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

  // Send the WebSocket handshake response
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  console.log("WebSocket connection established!");

  // Handle WebSocket data frames
  socket.on("data", (data) => {
    try {
      const message = parseWebSocketFrame(data);
      console.log("Received WebSocket message:", message);

      // Send a properly framed text response
      const response = constructWebSocketFrame(`Echo: ${message}`);
      socket.write(response);
    } catch (err) {
      console.error("Error processing WebSocket data:", err.message);
      socket.destroy();
    }
  });

  socket.on("close", () => {
    console.log("WebSocket connection closed.");
  });

  socket.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
}

/**
 * Parses a WebSocket frame to extract the text message
 * @param {Buffer} buffer
 * @returns {string}
 */
function parseWebSocketFrame(buffer) {
  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const isFinalFrame = (firstByte & 0x80) === 0x80; // FIN bit
  const opcode = firstByte & 0x0f; // Opcode
  const isMasked = (secondByte & 0x80) === 0x80; // Mask bit
  const payloadLength = secondByte & 0x7f; // Payload length

  if (!isFinalFrame) {
    throw new Error("Fragmented frames are not supported");
  }

  if (opcode !== 0x1) {
    throw new Error("Only text frames are supported");
  }

  if (!isMasked) {
    throw new Error("Frames must be masked");
  }

  const maskingKey = buffer.slice(2, 6); // Masking key
  const payloadData = buffer.slice(6, 6 + payloadLength); // Payload data

  // Unmask the payload data
  const unmaskedData = Buffer.alloc(payloadLength);
  for (let i = 0; i < payloadLength; i++) {
    unmaskedData[i] = payloadData[i] ^ maskingKey[i % 4];
  }

  return unmaskedData.toString("utf8");
}

/**
 * Constructs a WebSocket frame for the given message
 * @param {string} message
 * @returns {Buffer}
 */
function constructWebSocketFrame(message) {
  const messageBuffer = Buffer.from(message, "utf8");
  const length = messageBuffer.length;

  let frame;
  if (length <= 125) {
    frame = Buffer.alloc(2 + length);
    frame[0] = 0x81; // FIN and Text Frame opcode
    frame[1] = length; // Payload length
    messageBuffer.copy(frame, 2);
  } else if (length <= 65535) {
    frame = Buffer.alloc(4 + length);
    frame[0] = 0x81; // FIN and Text Frame opcode
    frame[1] = 126; // Extended payload length indicator
    frame.writeUInt16BE(length, 2); // Extended payload length
    messageBuffer.copy(frame, 4);
  } else {
    throw new Error("Message too long");
  }

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
