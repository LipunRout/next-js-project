import { NextRequest, NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const PROTO_PATH = path.join(process.cwd(), "grpc/service.proto");
const GRPC_ADDRESS = `${process.env.GRPC_HOST || "localhost"}:${process.env.GRPC_PORT || 50051}`;

let notifyPackage: any;

try {
  const packageDef = protoLoader.loadSync(PROTO_PATH);
  const grpcObject = grpc.loadPackageDefinition(packageDef) as any;
  notifyPackage = grpcObject.notify;
  console.log("✅ Proto loaded");
} catch (e) {
  console.error("❌ Failed to load proto:", e);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("📩 Body received:", body);

  if (!notifyPackage?.NotifyService) {
    return NextResponse.json({ error: "Proto not loaded" }, { status: 500 });
  }

  const client = new notifyPackage.NotifyService(
    GRPC_ADDRESS,
    grpc.credentials.createInsecure()
  );

  return new Promise((resolve) => {
    client.SendEvent(
      {
        type: body.type,
        message: body.message,
        token: body.token ?? "",
        senderId: body.senderId ?? "",
        recipientId: body.recipientId ?? "",
      },
      (err: any, response: any) => {
        if (err) {
          console.error("❌ gRPC call error:", err);
          resolve(NextResponse.json({ error: err.message }, { status: 500 }));
          return;
        }
        console.log("✅ gRPC response:", response);
        resolve(NextResponse.json({ success: true, data: response }));
      }
    );
  });
}