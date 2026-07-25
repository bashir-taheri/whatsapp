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

console.log(`✅ Server running on port ${PORT}`);

// ==================== تابع اصلی ====================
async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: "silent" }),
      printQRInTerminal: false
    });

    // ========== رویدادهای اتصال ==========
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === "open") {
        console.log("✅ WhatsApp Connected Successfully!");
        console.log("🤖 Bot is ready to respond!");
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
        await new Promise(resolve => setTimeout(resolve, 5000));
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("===============================");
        console.log("📱 PAIRING CODE:");
        console.log(code);
        console.log("===============================");
        console.log("🔑 این کد را در واتساپ وارد کنید");
        console.log("📱 WhatsApp > Linked Devices > Link a Device");
      } catch (err) {
        console.log("❌ Error getting pairing code:", err.message);
      }
    }

    // ========== پردازش پیام‌ها ==========
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      
      // بررسی پیام
      if (!msg.message || msg.key.fromMe) return;

      // استخراج متن
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      if (!text) return;

      // فقط به پیام‌های متنی پاسخ بده
      if (!msg.message.conversation && !msg.message.extendedTextMessage) {
        return;
      }

      try {
        const userId = msg.key.remoteJid;
        
        // مدیریت تاریخچه
        if (!userHistory.has(userId)) {
          userHistory.set(userId, []);
        }
        
        const history = userHistory.get(userId);
        history.push({ role: "user", content: text });
        
        // محدود کردن تاریخچه
        if (history.length > 10) {
          history.splice(0, 2);
        }

        // ساخت پیام برای Groq
        const messagesForGroq = [
          {
            role: "system",
            content: "شما یک دستیار هوشمند، مفید و دوستانه هستید که به زبان فارسی پاسخ می‌دهید. پاسخ‌های شما مختصر، دقیق و مفید هستند."
          },
          ...history
        ];

        console.log(`👤 ${userId}: ${text}`);

        // ارسال به Groq
        const chatCompletion = await groq.chat.completions.create({
          messages: messagesForGroq,
          model: "mixtral-8x7b-32768",
          temperature: 0.7,
          max_tokens: 1024,
        });

        const response = chatCompletion.choices[0]?.message?.content || "متاسفم، پاسخی دریافت نشد.";

        // ذخیره پاسخ
        history.push({ role: "assistant", content: response });

        // ارسال پاسخ
        await sock.sendMessage(msg.key.remoteJid, {
          text: response
        });

        console.log(`🤖: ${response}`);
        console.log("---");

      } catch (err) {
        console.log("❌ Error:", err.message);
        
        // ارسال پیام خطا
        try {
          let errorMsg = "⚠️ متاسفم، خطایی رخ داد: ";
          
          if (err.message.includes("API key")) {
            errorMsg += "کلید API معتبر نیست.";
          } else if (err.message.includes("rate limit")) {
            errorMsg += "محدودیت درخواست. چند دقیقه صبر کنید.";
          } else if (err.message.includes("network") || err.message.includes("fetch")) {
            errorMsg += "مشکل در اتصال به اینترنت.";
          } else {
            errorMsg += "لطفاً دوباره تلاش کنید.";
          }
          
          await sock.sendMessage(msg.key.remoteJid, {
            text: errorMsg
          });
        } catch (sendErr) {
          console.log("Error sending error message:", sendErr.message);
        }
      }
    });

  } catch (err) {
    console.log("❌ Fatal Error:", err.message);
    setTimeout(startBot, 5000);
  }
}

// ==================== اجرا ====================
startBot();

// مدیریت خروج
process.on('uncaughtException', (err) => {
  console.log('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.log('❌ Unhandled Rejection:', err.message);
});
