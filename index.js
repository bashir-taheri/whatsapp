const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const http = require("http");
const Groq = require("groq-sdk");

// ⚙️ تنظیمات
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = "93745872028"; // شماره شما بدون +
const GROQ_API_KEY = "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"; // 🔑 کلید API خود را وارد کنید
const YOUR_NAME = "بشیر";
// 🧠 تنظیم Groq AI
const groq = new Groq({ apiKey: GROQ_API_KEY });

// 📝 حافظه موقت مکالمات (اختیاری - برای context)
const conversationHistory = new Map();

// 🌐 سرور Keep-Alive
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("WhatsApp AI Bot Running 🤖");
}).listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// 🧠 تابع دریافت پاسخ از Groq
async function getAIResponse(userMessage, userId) {
  // ذخیره تاریخچه کاربر
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  
  const history = conversationHistory.get(userId);
  
  // اضافه کردن پیام کاربر به تاریخچه
  history.push({ role: "user", content: userMessage });
  
  // محدود کردن تاریخچه به 20 پیام آخر
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "mixtral-8x7b-32768", // یا "llama-3.3-70b-versatile"
      messages: [
        {
          role: "system",
          content: `شما یک دستیار شخصی به نام ${YOUR_NAME} هستید.
شخصیت شما:
- دوستانه، گرم و مفید هستید
- به زبان فارسی صحبت می‌کنید
- وقتی کسی به شما سلام می‌کند، پاسخ گرمی می‌دهید
- می‌گویید که فعلاً صاحب اصلی مشغول است ولی شما می‌توانید کمک کنید
- سعی می‌کنید به بهترین شکل به سوالات پاسخ دهید
- اگر سوالی نیاز به صاحب اصلی داشت، مودبانه اطلاع می‌دهید
- از ایموجی‌های مناسب استفاده می‌کنید (اما زیاد نه)
- لحن شما مثل یک دوست خوب است`
        },
        ...history.slice(-10) // فقط 10 پیام آخر را ارسال کن
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const aiResponse = completion.choices[0]?.message?.content || 
                       "متأسفانه الان نمی‌تونم جواب بدم. لطفاً بعداً دوباره پیام بدید 🙏";

    // ذخیره پاسخ AI در تاریخچه
    history.push({ role: "assistant", content: aiResponse });

    return aiResponse;
  } catch (error) {
    console.error("❌ خطای Groq:", error.message);
    return "ببخشید، یه مشکلی پیش اومده. لطفاً دوباره تلاش کنید ⚠️";
  }
}

// 🚀 شروع ربات
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // 📡 مدیریت اتصال
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      console.log("🔄 در حال اتصال...");
    }

    if (connection === "open") {
      console.log("✅ واتساپ با هوش مصنوعی وصل شد!");
      console.log("🤖 ربات آماده پاسخگویی به جای شماست...");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ اتصال قطع شد");

      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => startBot(), 5000);
      } else {
        console.log("⛔ لطفاً auth_info را پاک کرده و دوباره تلاش کنید");
      }
    }
  });

  // 📱 تولید کد تایید (فقط بار اول)
  if (!state.creds.registered) {
    console.log("📱 در حال تولید کد...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER.replace(/[^0-9]/g, ""));
      console.log("===============================");
      console.log("🔑 کد تایید:", code);
      console.log("===============================");
      console.log("📲 در واتساپ: تنظیمات > دستگاه‌های متصل > اتصال دستگاه");
    } catch (err) {
      console.error("❌ خطا:", err.message);
    }
  }

  // 💬 پاسخ هوشمند به پیام‌ها
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    
    // نادیده گرفتن پیام‌های خودمان و پیام‌های سیستمی
    if (!msg.message || msg.key.fromMe) return;
    
    // نادیده گرفتن پیام‌های استاتوس
    if (msg.key.remoteJid === "status@broadcast") return;

    const jid = msg.key.remoteJid;
    const userId = jid.split("@")[0]; // شناسه کاربر

    // استخراج متن پیام
    const text = 
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!text) return; // اگر پیام متنی نبود

    // نمایش پیام در کنسول
    console.log(`📩 پیام از ${userId}: ${text}`);

    try {
      // نمایش تایپ کردن...
      await sock.sendPresenceUpdate("composing", jid);
      
      // 🔮 دریافت پاسخ از AI
      const aiResponse = await getAIResponse(text, userId);
      
      // ارسال پاسخ
      await sock.sendMessage(jid, { text: aiResponse });
      
      // توقف تایپ کردن
      await sock.sendPresenceUpdate("paused", jid);
      
      console.log(`🤖 پاسخ به ${userId}: ${aiResponse.substring(0, 50)}...`);
      
    } catch (error) {
      console.error("❌ خطا در ارسال:", error.message);
      
      // ارسال پیام خطا
      await sock.sendMessage(jid, {
        text: "ببخشید، مشکلی پیش اومد. لطفاً دوباره تلاش کنید 🙏"
      });
    }
  });
}

// 🎯 اجرای ربات
console.log("🤖 در حال راه‌اندازی ربات هوشمند...");
startBot().catch(err => console.error("❌ خطای اصلی:", err));

// 🧹 پاکسازی حافظه هر یک ساعت
setInterval(() => {
  conversationHistory.clear();
  console.log("🧹 حافظه مکالمات پاکسازی شد");
}, 3600000); // هر یک ساعت        console.log("📱 PAIRING CODE:");
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
