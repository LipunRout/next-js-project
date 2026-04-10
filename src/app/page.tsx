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

type MessageStatus = "sending" | "sent" | "delivered" | "read";

type Message = {
  id: string;
  text: string;
  type: "sent" | "received";
  eventType?: string;
  time: string;
  status?: MessageStatus;
};

type FlowStep = "idle" | "api" | "grpc" | "websocket" | "done";

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(isoString: string) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const FLOW_STEPS = [
  { key: "api",       icon: "🌐", label: "Next.js\nAPI" },
  { key: "grpc",      icon: "⚡", label: "gRPC\nServer" },
  { key: "websocket", icon: "🔌", label: "WebSocket\nBroadcast" },
  { key: "done",      icon: "✅", label: "Delivered\nto UI" },
];

const FLOW_MESSAGES: Record<FlowStep, string> = {
  idle:      "",
  api:       "Sending via Next.js API...",
  grpc:      "Processing via gRPC server...",
  websocket: "Broadcasting via WebSocket...",
  done:      "Message delivered!",
};

export default function Home() {
  const socketRef      = useRef<WebSocket | null>(null);
  const clientIdRef    = useRef("user_" + Math.random().toString(36).slice(2, 9));
  const recipientIdRef = useRef(""); // ✅ always up to date in WS handler
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState("");
  const [recipientId,  setRecipientId]  = useState("");
  const [connected,    setConnected]    = useState(false);
  const [mounted,      setMounted]      = useState(false);
  const [fcmToken,     setFcmToken]     = useState<string | null>(null);
  const [fcmStatus,    setFcmStatus]    = useState<"idle"|"loading"|"ready"|"error">("idle");
  const [myClientId,   setMyClientId]   = useState("");
  const [flowStep,     setFlowStep]     = useState<FlowStep>("idle");
  const [flowMsg,      setFlowMsg]      = useState("");
  const [isTyping,        setIsTyping]        = useState(false);
  const [recipientOnline, setRecipientOnline] = useState(false);
  const [lastSeen,        setLastSeen]        = useState<string | null>(null);
  const [isSendingTyping, setIsSendingTyping] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setMyClientId(clientIdRef.current);
  }, []);

  useEffect(() => {
    
    async function initFCM() {
      try {
        setFcmStatus("loading");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") { setFcmStatus("error"); return; }

        const app: FirebaseApp = getApps().length === 0
          ? initializeApp(firebaseConfig) : getApps()[0];
        const messaging = getMessaging(app);
        const token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        });
        setFcmToken(token);
        setFcmStatus("ready");

        onMessage(messaging, (payload) => {
          new Notification(payload.notification?.title || "New message", {
            body: payload.notification?.body,
            icon: "/favicon.ico",
          });
        });
      } catch (err) {
        setFcmStatus("error");
      }
    }
    initFCM();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const clientId = clientIdRef.current;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(
        `${process.env.NEXT_PUBLIC_WS_URL || "ws://192.168.1.57:8080"}?clientId=${clientId}`
      );

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // ── Typing indicator ──
        if (data.type === "TYPING") {
          setIsTyping(true);
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setIsTyping(false), 2000);
          return;
        }

        // ── Online status ──
        if (data.type === "ONLINE") {
          if (data.senderId === recipientIdRef.current) { // ✅ ref
            setRecipientOnline(true);
            setLastSeen(null);
          }
          return;
        }

        // ── Offline status ──
        if (data.type === "OFFLINE") {
          if (data.senderId === recipientIdRef.current) { // ✅ ref
            setRecipientOnline(false);
            setLastSeen(data.lastSeen);
          }
          return;
        }

        // ── Delivered receipt ──
        if (data.type === "DELIVERED") {
          setMessages((prev) => prev.map((m) =>
            m.id === data.messageId ? { ...m, status: "delivered" } : m
          ));
          return;
        }

        // ── Read receipt ──
        if (data.type === "READ") {
          setMessages((prev) => prev.map((m) =>
            m.type === "sent" ? { ...m, status: "read" } : m
          ));
          return;
        }

        // ── Normal message ──
        const newMsg: Message = {
          id: data.messageId || genId(),
          text: data.message,
          type: "received",
          eventType: data.type,
          time: formatTime(),
        };

        setMessages((prev) => [...prev, newMsg]);

        // send DELIVERED back to sender
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: "DELIVERED",
            messageId: newMsg.id,
            recipientId: data.senderId,
          }));
        }

        // flow animation on receiver
        setFlowStep("websocket");
        setFlowMsg(FLOW_MESSAGES["websocket"]);
        setTimeout(() => {
          setFlowStep("done");
          setFlowMsg(FLOW_MESSAGES["done"]);
          setTimeout(() => { setFlowStep("idle"); setFlowMsg(""); }, 1500);
        }, 600);
      };

      ws.onerror = () => {};
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      socketRef.current = ws;
    }

    connect();
    return () => ws?.close();
  }, [mounted]);

  // ── Send READ when tab focused ──
  useEffect(() => {
    function handleFocus() {
      if (!recipientIdRef.current || !socketRef.current) return;
      const hasUnread = messages.some((m) => m.type === "received");
      if (!hasUnread) return;

      socketRef.current.send(JSON.stringify({
        type: "READ",
        recipientId: recipientIdRef.current,
        messageId: "all",
      }));

      setMessages((prev) => prev.map((m) =>
        m.type === "received" ? { ...m, status: "read" } : m
      ));
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleRecipientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setRecipientId(val);
    recipientIdRef.current = val;
  
    // ✅ ask server if this user is currently online
    if (val && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "CHECK_ONLINE",
        targetId: val,
      }));
    }
  };

  // ── Typing event sender ──
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!recipientIdRef.current || !socketRef.current || isSendingTyping) return;

    setIsSendingTyping(true);
    socketRef.current.send(JSON.stringify({
      type: "TYPING",
      recipientId: recipientIdRef.current, // ✅ ref
    }));
    setTimeout(() => setIsSendingTyping(false), 1500);
  };

  function animateFlow() {
    const steps: FlowStep[] = ["api", "grpc", "websocket", "done"];
    steps.forEach((step, i) => {
      setTimeout(() => { setFlowStep(step); setFlowMsg(FLOW_MESSAGES[step]); }, i * 600);
    });
    setTimeout(() => { setFlowStep("idle"); setFlowMsg(""); }, steps.length * 600 + 1000);
  }

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (!recipientIdRef.current.trim()) return; // ✅ ref

    const msgId = genId();
    const msg = input;

    setMessages((prev) => [...prev, {
      id: msgId, text: msg, type: "sent",
      time: formatTime(), status: "sending",
    }]);
    setInput("");
    animateFlow();

    try {
      await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "USER_EVENT",
          message: msg,
          token: fcmToken ?? "",
          senderId: clientIdRef.current,
          recipientId: recipientIdRef.current.trim(), // ✅ ref
          messageId: msgId,
        }),
      });

      setMessages((prev) => prev.map((m) =>
        m.id === msgId ? { ...m, status: "sent" } : m
      ));
    } catch (err) {
      console.error("API error:", err);
    }
  };

  function StatusTick({ status }: { status?: MessageStatus }) {
    if (!status || status === "sending") return <span style={{ color: "#64748b", fontSize: 11 }}>⏳</span>;
    if (status === "sent")      return <span style={{ color: "#94a3b8", fontSize: 11 }}>✓</span>;
    if (status === "delivered") return <span style={{ color: "#94a3b8", fontSize: 11 }}>✓✓</span>;
    if (status === "read")      return <span style={{ color: "#60a5fa", fontSize: 11 }}>✓✓</span>;
    return null;
  }

  if (!mounted) return null;

  return (
    <main className="container">

      {/* ── Heading ── */}
      <div className="page-heading">
        <h1>Streamline </h1>
        <p>WebSocket · gRPC · FCM · Next.js</p>
        <div className="stack-badges">
          <span className="badge next">Next.js 16</span>
          <span className="badge grpc">gRPC</span>
          <span className="badge ws">WebSocket</span>
          <span className="badge fcm">FCM</span>
        </div>
      </div>

      {/* ── Flow tracker ── */}
      <div className="flow-tracker">
        {FLOW_STEPS.map((step, i) => (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div className={`flow-step ${
              flowStep === step.key ? "active" :
              FLOW_STEPS.findIndex(s => s.key === flowStep) > i || flowStep === "done"
                ? "done" : ""
            }`}>
              <div className="flow-icon">{step.icon}</div>
              <div className="flow-label">{step.label}</div>
            </div>
            {i < FLOW_STEPS.length - 1 && <span className="flow-arrow">→</span>}
          </div>
        ))}
      </div>
      {flowMsg && <div className="flow-status">{flowMsg}</div>}

      {/* ── Chat ── */}
      <div className="chat-wrap">

        <div className="chat-header">
          <div className="chat-avatar">💬</div>
          <div style={{ flex: 1 }}>
            <div className="chat-title">Real-Time Chat</div>
            <div className="chat-subtitle">
              <div className={`status-dot ${connected ? "online" : "offline"}`} />
              {recipientId ? (
                recipientOnline
                  ? <span style={{ color: "#22c55e", fontSize: 11 }}>recipient online</span>
                  : lastSeen
                  ? <span style={{ fontSize: 11 }}>last seen {timeAgo(lastSeen)}</span>
                  : <span style={{ fontSize: 11 }}>recipient offline</span>
              ) : (
                <span style={{ fontSize: 11 }}>{connected ? "connected" : "reconnecting..."}</span>
              )}
            </div>
          </div>
          <span className="fcm-badge">
            {fcmStatus === "ready" ? "FCM on" :
             fcmStatus === "loading" ? "FCM..." :
             fcmStatus === "error" ? "FCM off" : ""}
          </span>
        </div>

        <div className="id-bar">
          <div className="id-label">
            Your ID: <span className="id-value">{myClientId}</span>
          </div>
          <input
            className="recipient-input"
            value={recipientId}
            onChange={handleRecipientChange} // ✅ syncs ref
            placeholder="Paste the other user's ID here..."
          />
        </div>

        <div className="messages-area">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <span>Paste recipient ID above and start chatting</span>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`bubble-row ${msg.type}`}>
              {msg.type === "received" && msg.eventType && (
                <div className="event-tag">{msg.eventType}</div>
              )}
              <div className={`msg ${msg.type}`}>{msg.text}</div>
              <div className="msg-meta" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {msg.time}
                {msg.type === "sent" && <StatusTick status={msg.status} />}
              </div>
            </div>
          ))}

          {/* ── Typing indicator ── */}
          {isTyping && (
            <div className="bubble-row received">
              <div className="msg received typing-bubble">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="input-bar">
          <input
            className="msg-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            maxLength={200}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={!connected || !recipientId.trim()}
          >
            ➤
          </button>
        </div>

      </div>
    </main>
  );
}