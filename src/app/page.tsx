"use client";

import { useEffect, useRef, useState } from "react";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

type Message = {
  text: string;
  type: "sent" | "received";
  eventType?: string;
  time: string;
};

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const socketRef = useRef<WebSocket | null>(null);

  // ✅ unique per component instance — never shared between tabs
  const clientIdRef = useRef("user_" + Math.random().toString(36).slice(2, 9));

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [connected, setConnected] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [fcmStatus, setFcmStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [myClientId, setMyClientId] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setMyClientId(clientIdRef.current); // ✅ set from ref
  }, []);

  useEffect(() => {
    if (!mounted) return;

    async function initFCM() {
      try {
        setFcmStatus("loading");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setFcmStatus("error");
          return;
        }

        const app: FirebaseApp =
          getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const messaging = getMessaging(app);

        const token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        });

        console.log("📱 FCM Token:", token);
        setFcmToken(token);
        setFcmStatus("ready");

        onMessage(messaging, (payload) => {
          console.log("📩 Foreground FCM:", payload);
          new Notification(payload.notification?.title || "New message", {
            body: payload.notification?.body,
            icon: "/favicon.ico",
          });
        });
      } catch (err) {
        console.error("❌ FCM init error:", err);
        setFcmStatus("error");
      }
    }

    initFCM();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    const clientId = clientIdRef.current; // ✅ use ref
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(
        `${
          process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080"
        }?clientId=${clientId}`
      );

      ws.onopen = () => {
        console.log("✅ Connected as", clientId);
        setConnected(true);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setMessages((prev) => [
          ...prev,
          {
            text: data.message,
            type: "received",
            eventType: data.type,
            time: formatTime(),
          },
        ]);
      };

      ws.onerror = (err) => console.log("❌ WS Error:", err);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
      socketRef.current = ws;
    }

    connect();
    return () => ws?.close();
  }, [mounted]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg = input;
    setMessages((prev) => [
      ...prev,
      { text: msg, type: "sent", time: formatTime() },
    ]);
    setInput("");

    try {
      await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "USER_EVENT",
          message: msg,
          token: fcmToken ?? "",
          senderId: clientIdRef.current, // ✅ use ref
          recipientId: recipientId,
        }),
      });
    } catch (err) {
      console.error("API error:", err);
    }
  };
  if (!mounted) return null;

  const isUserA = clientIdRef.current.slice(-1) < "n"; // rough split for demo — always true per instance

  return (
    <main className="container">
      <div className="chat-wrap">
        <div className="chat-header">
          <div className="chat-avatar">💬</div>
          <span className="chat-title">Real-Time-Chat</span>
          <span className="chat-subtitle">
            <div className={`status-dot ${connected ? "online" : "offline"}`} />
            {connected ? "online" : "reconnecting..."}
          </span>
          <span className="fcm-badge">
            {fcmStatus === "ready"
              ? "FCM on"
              : fcmStatus === "loading"
              ? "FCM..."
              : fcmStatus === "error"
              ? "FCM off"
              : ""}
          </span>
        </div>

        {/* <div className="id-bar">
          <div className="id-label">
            Your ID: <span className="id-value">{myClientId}</span>
          </div>
          <input
            className="recipient-input"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            placeholder="Paste the other user's ID here..."
          />
        </div> */}

        <div className="messages-area">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <span>No messages yet</span>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`bubble-row ${msg.type}`}>
              {msg.type === "received" && msg.eventType && (
                <div className="event-tag">{msg.eventType}</div>
              )}
              <div className={`msg ${msg.type}`}>{msg.text}</div>
              <div className="msg-meta">{msg.time}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="input-bar">
          <input
            className="msg-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            maxLength={200}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={!connected || !recipientId}
          >
            ➤
          </button>
        </div>
      </div>
    </main>
  );
}
