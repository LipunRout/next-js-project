require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const WebSocket = require("ws");
const http = require("http");

const WS_PORT = process.env.WS_PORT || 8080;
const HTTP_PORT = 8081;

const wss = new WebSocket.Server({ port: WS_PORT });

// Map of clientId -> WebSocket
const clients = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const clientId = url.searchParams.get("clientId");

  if (clientId) {
    clients.set(clientId, ws);
    console.log(`✅ Client connected: ${clientId}`);
  }

  ws.on("close", () => {
    if (clientId) {
      clients.delete(clientId);
      console.log(`❌ Client disconnected: ${clientId}`);
    }
  });
});

function broadcast(data) {
  if (data.recipientId && clients.has(data.recipientId)) {
    const recipientWs = clients.get(data.recipientId);

    // ✅ only send to recipient, never back to sender
    if (recipientWs.readyState === WebSocket.OPEN) {
      recipientWs.send(JSON.stringify({
        type: data.type,
        message: data.message,
        senderId: data.senderId,
      }));
      console.log(`📡 Sent to ${data.recipientId}`);
    }
    return;
  }

  // fallback — broadcast to all except sender
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== clients.get(data.senderId)) {
      client.send(message);
    }
  });
}

const httpServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const data = JSON.parse(body);
      console.log("📡 Broadcasting:", data);
      broadcast(data);
      res.writeHead(200);
      res.end("ok");
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`🚀 WebSocket running on ws://localhost:${WS_PORT}`);
  console.log(`🚀 Broadcast HTTP on http://localhost:${HTTP_PORT}`);
});