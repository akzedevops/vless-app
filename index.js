import http from "http";
import net from "net";
import crypto from "crypto";
import { WebSocket, WebSocketServer } from 'ws';

// Improved configuration and security
const CONFIG = {
  PORT: process.env.PORT || 8080,
  UUID: process.env.UUID,
  TIMEOUT: 30000, // 30 seconds connection timeout
  MAX_CONNECTIONS: 100 // Prevent resource exhaustion
};

/**
 * Main server logic with improved error handling and WebSocket support
 */
class VLESSProxy {
  constructor() {
    this.connectionCount = 0;
    this.server = http.createServer(this.handleHttpRequest.bind(this));
    this.wsServer = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', this.handleWebSocketUpgrade.bind(this));
    this.server.on('error', this.handleServerError.bind(this));
  }

  /**
   * Handle standard HTTP requests
   */
  handleHttpRequest(req, res) {
    // Health check endpoint
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    // VLESS configuration endpoint
    if (req.url === `/${CONFIG.UUID}`) {
      const vlessConfig = this.getVLESSConfig(req.headers.host);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(vlessConfig);
      return;
    }

    // Default response
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("VLESS Proxy Server\n");
  }

  /**
   * Handle WebSocket upgrade requests
   */
  handleWebSocketUpgrade(request, socket, head) {
    // Prevent connection flood
    if (this.connectionCount >= CONFIG.MAX_CONNECTIONS) {
      socket.write('HTTP/1.1 429 Too Many Connections\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.connectionCount++;
      this.handleWebSocketConnection(ws);
    });
  }

  /**
   * Manage individual WebSocket connection
   */
  handleWebSocketConnection(ws) {
    let targetSocket = null;

    ws.on('message', (data) => {
      try {
        // Parse VLESS header
        const { uuid, targetHost, targetPort, rawData } = this.parseVLESSHeader(data);

        // Validate UUID
        if (uuid !== CONFIG.UUID) {
          ws.close(1008, "Invalid UUID");
          return;
        }

        // Establish target connection
        targetSocket = net.createConnection({
          host: targetHost,
          port: targetPort,
          timeout: CONFIG.TIMEOUT
        }, () => {
          targetSocket.write(rawData);
        });

        // Relay traffic
        targetSocket.on('data', (chunk) => {
          ws.send(chunk);
        });

        // Handle connection errors
        targetSocket.on('error', (err) => {
          console.error(`Target connection error: ${err.message}`);
          ws.close(1011, "Connection Error");
        });

        targetSocket.on('close', () => {
          ws.close();
        });
      } catch (err) {
        console.error(`WebSocket message error: ${err.message}`);
        ws.close(1011, "Processing Error");
      }
    });

    // Cleanup on close
    ws.on('close', () => {
      this.connectionCount--;
      if (targetSocket) {
        targetSocket.destroy();
      }
    });
  }

  /**
   * Parse VLESS protocol header with improved error handling
   */
  parseVLESSHeader(buffer) {
    try {
      if (buffer.length < 24) {
        throw new Error("Insufficient header length");
      }

      const uuid = buffer.slice(1, 17).toString('hex');
      const addressType = buffer[19];
      let targetHost, addressLength, port;

      switch (addressType) {
        case 0x01: // IPv4
          addressLength = 4;
          targetHost = buffer.slice(20, 24).join('.');
          break;
        case 0x03: // Domain
          addressLength = buffer[20];
          targetHost = buffer.slice(21, 21 + addressLength).toString('utf8');
          break;
        case 0x04: // IPv6
          addressLength = 16;
          targetHost = buffer.slice(20, 36).toString('hex')
            .match(/.{1,4}/g)
            .join(':');
          break;
        default:
          throw new Error("Unsupported address type");
      }

      port = buffer.readUInt16BE(20 + addressLength);
      const rawDataIndex = 22 + addressLength;
      const rawData = buffer.slice(rawDataIndex);

      return { uuid, targetHost, targetPort: port, rawData };
    } catch (err) {
      console.error(`VLESS header parsing error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Generate WebSocket accept key
   */
  generateAcceptKey(key) {
    return crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
  }

  /**
   * Generate VLESS configuration
   */
  getVLESSConfig(host) {
    return `
################################################################
v2ray
---------------------------------------------------------------
vless://${CONFIG.UUID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${host}
---------------------------------------------------------------
################################################################
`;
  }

  /**
   * Handle server-level errors
   */
  handleServerError(error) {
    console.error(`Server error: ${error.message}`);
  }

  /**
   * Start the server
   */
  start() {
    this.server.listen(CONFIG.PORT, () => {
      console.log(`VLESS Proxy Server running on port ${CONFIG.PORT}`);
    });
  }
}

// Initialize and start the server
const proxy = new VLESSProxy();
proxy.start();
