importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// ✅ must call initializeApp before getMessaging
const app = firebase.initializeApp({
  apiKey: "AIzaSyCt7Dkq3mfdisT6VWWCjWfHmEZlCaFPV0E",
  authDomain: "notifyx-174f7.firebaseapp.com",
  projectId: "notifyx-174f7",
  storageBucket: "notifyx-174f7.firebasestorage.app",
  messagingSenderId: "848607520405",
  appId: "1:848607520405:web:760e9d09f47679407f9d9c",
});

// ✅ pass app instance explicitly
const messaging = firebase.messaging(app);

messaging.onBackgroundMessage((payload) => {
  console.log("📩 Background message:", payload);

  const { title, body } = payload.notification;

  self.registration.showNotification(title, {
    body,
    icon: "/favicon.ico",
  });
});