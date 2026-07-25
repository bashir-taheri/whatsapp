const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const Groq = require('groq-sdk');
const P = require("pino");
const http = require("http");

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = "93745872028";

// 🔑 کلید API (فقط برای تست)
const GROQ_API_KEY = "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";

// تنظیمات Groq
const groq = new Groq({
  apiKey: GROQ_API_KEY
});

// ذخیره تاریخچه مکالمه هر کاربر
const userHistory = new Map();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("WhatsApp AI Bot Running");
}).listen(PORT);

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      console.log("Connecting...");
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      console.log("Connection closed");
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      }
    }
  });

  // Pairing Code
  if (!state.creds.registered) {
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log("===============================");
      console.log("📱 PAIRING CODE:");
      console.log(code);
      console.log("===============================");
      console.log("🔑 این کد را در واتساپ وارد کنید");
    } catch (err) {
      console.log("❌ Error getting pairing code:", err);
    }
  }

  // پاسخ‌های هوشمند با Groq
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text) return;

    try {
      const userId = msg.key.remoteJid;
      
      // مدیریت تاریخچه کاربر
      if (!userHistory.has(userId)) {
        userHistory.set(userId, []);
      }
      
      const history = userHistory.get(userId);
      
      // اضافه کردن پیام جدید به تاریخچه
      history.push({ role: "user", content: text });
      
      // محدود کردن تاریخچه به 10 پیام آخر
      if (history.length > 10) {
        history.splice(0, 2);
      }

      // ساخت تاریخچه برای Groq
      const messagesForGroq = [
        {
          role: "system",
          content: "شما یک دستیار هوشمند، مفید و دوستانه هستید که به زبان فارسی پاسخ می‌دهید. پاسخ‌های شما مختصر، دقیق و مفید هستند."
        },
        ...history
      ];

      console.log(`👤 User: ${text}`);

      // دریافت پاسخ از Groq
      const chatCompletion = await groq.chat.completions.create({
        messages: messagesForGroq,
        model: "llama-3.1-70b-versatile",
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 1,
        stream: false,
      });

      const response = chatCompletion.choices[0]?.message?.content || "متاسفم، پاسخی دریافت نشد.";

      // ذخیره پاسخ در تاریخچه
      history.push({ role: "assistant", content: response });

      // ارسال پاسخ به واتساپ
      await sock.sendMessage(msg.key.remoteJid, {
        text: response
      });

      console.log(`🤖 AI: ${response}`);
      console.log("---");

    } catch (err) {
      console.log("❌ Groq Error:", err);
      
      // ارسال پیام خطا به کاربر
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⚠️ متاسفم، در پردازش درخواست شما مشکلی پیش آمد. لطفاً چند لحظه دیگر دوباره تلاش کنید."
        });
      } catch (sendErr) {
        console.log("Error sending error message:", sendErr);
      }
    }
  });
}

startBot();
