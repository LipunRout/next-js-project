require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const admin = require("firebase-admin");
const path = require("path");

// ✅ always resolves correctly regardless of where node is run from
const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const messaging = admin.messaging();

async function sendNotification(token, title, body) {
  const message = { token, notification: { title, body } };
  try {
    const response = await messaging.send(message);
    console.log("✅ FCM sent:", response);
  } catch (error) {
    console.error("❌ FCM error:", error);
  }
}

module.exports = { sendNotification };