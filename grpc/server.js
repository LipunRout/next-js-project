require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const http = require("http");
const { sendNotification } = require("../firebase/admin");

const PROTO_PATH = path.join(__dirname, "service.proto");
const GRPC_PORT = process.env.GRPC_PORT || 50051;

const packageDef = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDef);
const notifyPackage = grpcObject.notify;

function broadcastViaHTTP(data) {
  const body = JSON.stringify(data);
  const req = http.request({
    hostname: "127.0.0.1",
    port: 8081,
    path: "/broadcast",
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }, (res) => {
    console.log("✅ Broadcast sent, status:", res.statusCode);
  });
  req.on("error", (err) => console.error("❌ Broadcast error:", err.message));
  req.write(body);
  req.end();
}

async function sendEvent(call, callback) {
  const { type, message, token, senderId, recipientId, messageId } = call.request;
  console.log(`📩 gRPC Received: ${type} from ${senderId} to ${recipientId}: ${message}`);

  broadcastViaHTTP({ type, message, senderId, recipientId, messageId });

  if (token) await sendNotification(token, "New message", message);

  callback(null, { status: "ok", result: message });
}

const server = new grpc.Server();
server.addService(notifyPackage.NotifyService.service, { SendEvent: sendEvent });

server.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  () => {
    console.log(`🚀 gRPC server running on port ${GRPC_PORT}`);
    server.start();
  }
);