const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const Groq = require('groq-sdk');
const P = require("pino");
const http = require("http");

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = "93745872028";
const GROQ_API_KEY = "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";

console.log("🚀 Starting WhatsApp Bot...");
console.log("📱 Phone:", PHONE_NUMBER);
console.log("🔑 API Key:", GROQ_API_KEY ? "✅ Set" : "❌ Not Set");

// ==================== تست Groq ====================
async function testGroq() {
  console.log("🔄 Testing Groq connection...");
  try {
    const test = await groq.chat.completions.create({
      messages: [{ role: "user", content: "سلام" }],
      model: "mixtral-8x7b-32768",
      max_tokens: 10,
    });
    console.log("✅ Groq Test Successful!");
    console.log("📝 Response:", test.choices[0].message.content);
    return true;
  } catch (err) {
    console.log("❌ Groq Test Failed!");
    console.log("Error:", err.message);
    console.log("Full Error:", err);
    return false;
  }
}

// ==================== راه‌اندازی Groq ====================
const groq = new Groq({
  apiKey: GROQ_API_KEY
});

// ==================== ذخیره تاریخچه ====================
const userHistory = new Map();

// ==================== سرور HTTP ====================
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("WhatsApp AI Bot Running");
}).listen(PORT);

console.log(`✅ HTTP Server running on port ${PORT}`);

// ==================== تابع اصلی ====================
async function startBot() {
  try {
    console.log("🔄 Initializing WhatsApp...");
    
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: "silent" }),
      printQRInTerminal: false
    });

    console.log("✅ Socket created");

    // ========== رویدادهای اتصال ==========
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === "open") {
        console.log("✅ WhatsApp Connected Successfully!");
        console.log("🤖 Bot is ready to respond!");
        
        // تست Groq بعد از اتصال واتساپ
        await testGroq();
      }

      if (connection === "close") {
        console.log("❌ Connection closed");
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (shouldReconnect) {
          console.log("🔄 Reconnecting in 5 seconds...");
          setTimeout(startBot, 5000);
        } else {
          console.log("⚠️ Logged out. Please restart the bot.");
        }
      }
    });

    // ========== دریافت کد Pairing ==========
    if (!state.creds.registered) {
      try {
        console.log("🔄 Requesting pairing code...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("===============================");
        console.log("📱 PAIRING CODE:");
        console.log(code);
        console.log("===============================");
        console.log("🔑 این کد را در واتساپ وارد کنید");
        console.log("📱 WhatsApp > Settings > Linked Devices > Link a Device");
      } catch (err) {
        console.log("❌ Error getting pairing code:", err.message);
        console.log("Full Error:", err);
      }
    }

    // ========== پردازش پیام‌ها ==========
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      
      if (!msg.message || msg.key.fromMe) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      if (!text) return;

      if (!msg.message.conversation && !msg.message.extendedTextMessage) {
        return;
      }

      try {
        const userId = msg.key.remoteJid;
        
        console.log(`👤 ${userId}: ${text}`);

        // ساده‌ترین پاسخ برای تست
        if (text.toLowerCase() === "سلام" || text.toLowerCase() === "test") {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "سلام! ربات فعال است. منتظر پاسخ هوشمند باشید... 🚀"
          });
        }

        // پاسخ هوشمند با Groq
        if (!userHistory.has(userId)) {
          userHistory.set(userId, []);
        }
        
        const history = userHistory.get(userId);
        history.push({ role: "user", content: text });
        
        if (history.length > 10) {
          history.splice(0, 2);
        }

        const messagesForGroq = [
          {
            role: "system",
            content: "شما یک دستیار هوشمند، مفید و دوستانه هستید که به زبان فارسی پاسخ می‌دهید."
          },
          ...history
        ];

        console.log("🔄 Sending to Groq...");

        const chatCompletion = await groq.chat.completions.create({
          messages: messagesForGroq,
          model: "mixtral-8x7b-32768",
          temperature: 0.7,
          max_tokens: 1024,
        });

        const response = chatCompletion.choices[0]?.message?.content || "متاسفم، پاسخی دریافت نشد.";

        history.push({ role: "assistant", content: response });

        await sock.sendMessage(msg.key.remoteJid, {
          text: response
        });

        console.log(`🤖: ${response}`);
        console.log("---");

      } catch (err) {
        console.log("❌ Error:", err.message);
        console.log("Full Error:", err);
        
        // ارسال پاسخ ساده در صورت خطا
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "⚠️ متاسفم، خطایی رخ داد. لطفاً دوباره تلاش کنید."
          });
        } catch (sendErr) {
          console.log("Error sending error message:", sendErr.message);
        }
      }
    });

  } catch (err) {
    console.log("❌ Fatal Error:", err.message);
    console.log("Stack:", err.stack);
    setTimeout(startBot, 5000);
  }
}

// ==================== اجرا ====================
console.log("🔄 Starting bot...");
startBot();

// مدیریت خطاها
process.on('uncaughtException', (err) => {
  console.log('❌ Uncaught Exception:', err.message);
  console.log('Stack:', err.stack);
});

process.on('unhandledRejection', (err) => {
  console.log('❌ Unhandled Rejection:', err.message);
  console.log('Stack:', err.stack);
});
