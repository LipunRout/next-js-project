require("dotenv").config({
  path: require("path").join(__dirname, "../.env.local"),
});

const WebSocket = require("ws");
const http = require("http");

const WS_PORT = process.env.WS_PORT || 8080;
const HTTP_PORT = 8081;

const wss = new WebSocket.Server({
  port: 8080,
  host: "0.0.0.0"
});

// clientId -> { ws, lastSeen, name }
const clients = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const clientId = url.searchParams.get("clientId");

  if (clientId) {
    clients.set(clientId, { ws, lastSeen: null });
    console.log(`✅ Client connected: ${clientId}`);

    // notify all clients this user is online
    broadcastStatus(clientId, "ONLINE");
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // handle TYPING event directly from browser
      if (data.type === "TYPING" && data.recipientId) {
        sendToClient(data.recipientId, {
          type: "TYPING",
          senderId: clientId,
        });
        return;
      }

      // handle READ event
      if (data.type === "READ" && data.recipientId) {
        sendToClient(data.recipientId, {
          type: "READ",
          messageId: data.messageId,
          senderId: clientId,
        });
        return;
      }

      // handle DELIVERED event
      if (data.type === "DELIVERED" && data.recipientId) {
        sendToClient(data.recipientId, {
          type: "DELIVERED",
          messageId: data.messageId,
          senderId: clientId,
        });
        return;
      }
      // inside ws.on("message") handler, add:
      if (data.type === "CHECK_ONLINE" && data.targetId) {
        const entry = clients.get(data.targetId);
        const isOnline = entry && entry.ws.readyState === WebSocket.OPEN;
        ws.send(
          JSON.stringify({
            type: isOnline ? "ONLINE" : "OFFLINE",
            senderId: data.targetId,
            lastSeen: entry?.lastSeen ? entry.lastSeen.toISOString() : null,
          })
        );
        return;
      }
    } catch (e) {
      console.error("WS message parse error:", e);
    }
  });

  ws.on("close", () => {
    if (clientId) {
      const lastSeen = new Date();
      clients.set(clientId, { ws, lastSeen });
      console.log(`❌ Client disconnected: ${clientId}`);

      // notify others this user went offline
      broadcastStatus(clientId, "OFFLINE", lastSeen);

      // remove after 30 seconds
      setTimeout(() => {
        const entry = clients.get(clientId);
        if (entry && entry.ws === ws) {
          clients.delete(clientId);
        }
      }, 30000);
    }
  });
});

function sendToClient(clientId, data) {
  const entry = clients.get(clientId);
  if (entry && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify(data));
  }
}

function broadcastStatus(fromClientId, status, lastSeen = null) {
  const payload = JSON.stringify({
    type: status,
    senderId: fromClientId,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
  });

  clients.forEach((entry, id) => {
    if (id !== fromClientId && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(payload);
    }
  });
}

// broadcast via HTTP from gRPC
function broadcast(data) {
  if (!data.recipientId) {
    console.warn("⚠️ No recipientId — message dropped");
    return;
  }

  if (!clients.has(data.recipientId)) {
    console.warn(`⚠️ Recipient ${data.recipientId} not connected`);
    return;
  }

  const entry = clients.get(data.recipientId);
  if (entry && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(
      JSON.stringify({
        type: data.type,
        message: data.message,
        senderId: data.senderId,
        messageId: data.messageId,
      })
    );
    console.log(`📡 Sent to ${data.recipientId}`);
  }
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
