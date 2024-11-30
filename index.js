import http from "http";
import net from "net";
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
 * Handles WebSocket connections for VLESS protocol
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

  // Start relaying traffic
  relayTraffic(socket);
}

/**
 * Relays VLESS traffic between the client and the target server
 * @param {net.Socket} clientSocket
 */
function relayTraffic(clientSocket) {
  clientSocket.on("data", async (data) => {
    try {
      const { uuid, targetHost, targetPort, rawData } = parseVLESSHeader(data);

      if (uuid !== process.env.UUID) {
        console.error("Invalid UUID");
        clientSocket.destroy();
        return;
      }

      console.log(`Relaying traffic to ${targetHost}:${targetPort}`);

      const targetSocket = net.connect(targetPort, targetHost, () => {
        targetSocket.write(rawData);
      });

      targetSocket.on("data", (chunk) => {
        clientSocket.write(chunk);
      });

      targetSocket.on("end", () => {
        clientSocket.end();
      });

      targetSocket.on("error", (err) => {
        console.error("Error on target socket:", err.message);
        clientSocket.destroy();
      });

      clientSocket.on("end", () => {
        targetSocket.end();
      });

      clientSocket.on("error", (err) => {
        console.error("Error on client socket:", err.message);
        targetSocket.destroy();
      });
    } catch (err) {
      console.error("Error processing VLESS data:", err.message);
      clientSocket.destroy();
    }
  });
}

/**
 * Parses the VLESS header from the client data
 * @param {Buffer} buffer
 * @returns {{ uuid: string, targetHost: string, targetPort: number, rawData: Buffer }}
 */
function parseVLESSHeader(buffer) {
  if (buffer.length < 24) {
    throw new Error("Invalid VLESS header length");
  }

  const uuid = buffer.slice(1, 17).toString("hex");
  const command = buffer[18]; // Command (e.g., 0x01 for TCP)
  const addressType = buffer[19]; // Address type (e.g., 0x01 for IPv4)
  let addressLength;
  let targetHost;

  switch (addressType) {
    case 0x01: // IPv4
      addressLength = 4;
      targetHost = buffer.slice(20, 24).join(".");
      break;
    case 0x03: // Domain
      addressLength = buffer[20];
      targetHost = buffer.slice(21, 21 + addressLength).toString("utf8");
      break;
    case 0x04: // IPv6
      addressLength = 16;
      targetHost = buffer.slice(20, 36).toString("hex").match(/.{1,4}/g).join(":");
      break;
    default:
      throw new Error("Unsupported address type");
  }

  const port = buffer.readUInt16BE(20 + addressLength);
  const rawDataIndex = 22 + addressLength;
  const rawData = buffer.slice(rawDataIndex);

  return { uuid, targetHost, targetPort: port, rawData };
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
