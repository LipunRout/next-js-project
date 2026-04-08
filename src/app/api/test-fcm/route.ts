import { NextRequest, NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const PROTO_PATH = path.join(process.cwd(), "grpc/service.proto");
const packageDef = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDef) as any;
const notifyPackage = grpcObject.notify;

export async function POST(req: NextRequest) {
  const body = await req.json();
  // body = { token: "FCM_DEVICE_TOKEN_HERE" }

  const client = new notifyPackage.NotifyService(
    "localhost:50051",
    grpc.credentials.createInsecure()
  );

  return new Promise((resolve) => {
    client.SendEvent(
      {
        type: "TEST_FCM",
        message: "FCM is working!",
        token: body.token,
      },
      (err: any, response: any) => {
        if (err) {
          resolve(NextResponse.json({ error: err.message }, { status: 500 }));
          return;
        }
        resolve(NextResponse.json({ success: true, data: response }));
      }
    );
  });
}