const http = require("http");

/**
 * Main entry point for DigitalOcean Function
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
const handler = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';
    const proxyIP = process.env.PROXYIP || '';

    if (!isValidUUID(userID)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      return res.end("Invalid UUID");
    }

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "Welcome to DigitalOcean Functions!" }));
    } else if (url.pathname === `/${userID}`) {
      const vlessConfig = getVLESSConfig(userID, req.headers.host);
      res.writeHead(200, { "Content-Type": "text/plain;charset=utf-8" });
      return res.end(vlessConfig);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Internal Server Error: ${err.message}`);
  }
};

/**
 * Validate UUID format
 * @param {string} uuid
 * @returns {boolean}
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Generate VLESS configuration
 * @param {string} userID
 * @param {string | null} hostName
 * @returns {string}
 */
function getVLESSConfig(userID, hostName) {
  const protocol = "vless";
  const vlessMain =
    `${protocol}://${userID}@${hostName}:443` +
    `?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;

  return `
################################################################
v2ray
---------------------------------------------------------------
${vlessMain}
---------------------------------------------------------------
################################################################
clash-meta
---------------------------------------------------------------
- type: vless
  name: ${hostName}
  server: ${hostName}
  port: 443
  uuid: ${userID}
  network: ws
  tls: true
  udp: false
  sni: ${hostName}
  client-fingerprint: chrome
  ws-opts:
    path: "/?ed=2048"
    headers:
      host: ${hostName}
---------------------------------------------------------------
################################################################
`;
}

// Start the HTTP server
const server = http.createServer(handler);
server.listen(8080, () => {
  console.log("Server is running on port 8080");
});
