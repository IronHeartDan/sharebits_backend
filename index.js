require('dotenv').config()
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");

// Init
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});
const redisClient = createClient({ url: process.env.REDIS_URL });
const PORT = process.env.PORT;

// Firebase
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = require("./share-bits-firebase-adminsdk.json");

initializeApp({
  credential: cert(serviceAccount),
});

// REST API
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("Server Live");
});

function insertConnectedUser(phoneNumber, socketId) {
  try {
    redisClient.hSet("connected_users", phoneNumber, socketId);
  } catch (err) {
    console.log(err);
  }
}

async function isUserOnline(phoneNumber) {
  try {
    let result = await redisClient.hGet("connected_users", phoneNumber);
    if (result) return result;
    return null;
  } catch (err) {
    console.log(err);
    return null;
  }
}

function removeConnectedUser(phoneNumber) {
  try {
    redisClient.hDel("connected_users", phoneNumber);
  } catch (err) {
    console.log(err);
  }
}

async function sendPushNotification(phone, notificationData) {
  let registrationTokens = [];
  const message = {
    data: {
      payload: JSON.stringify(notificationData),
    },
    android: {
      ttl: 0,
    },
    tokens: registrationTokens,
  };
}

io.on("connection", (socket) => {
  // Save Presence
  const phone = socket.handshake.headers.phone;
  console.log(`Connected : ${phone}`);
  if (!phone) return;
  insertConnectedUser(phone, socket.id);

  // Call Request
  socket.on("call", async (to) => {
    const callRequestInfo = { to: to, from: phone };
    // Check For Presence
    const toSocketId = await isUserOnline(to);
    if (toSocketId) {
      // Online And Send Call Via Socket
      io.to(toSocketId).emit("call", JSON.stringify(callRequestInfo));
    } else {
      // Offline And Send Push Notification
    }
  });

  // Cancle Call Request
  socket.on("cancelCall", async (to) => {
    // Check For Presence
    const toSocketId = await isUserOnline(to);
    if (toSocketId) {
      // Online And Send Call Via Socket
      io.to(toSocketId).emit("cancle");
    } else {
      // Offline And Send Push Notification
    }
  });

  socket.on("callDeclined", async (to) => {
    const toSocketId = await isUserOnline(to);
    if (toSocketId) {
      io.to(toSocketId).emit("callDeclined");
    }
  });

  socket.on("callAccepted", async (to) => {
    const toSocketId = await isUserOnline(to);
    if (toSocketId) {
      io.to(toSocketId).emit("callAccepted");
    }
  });

  socket.on("rtcOffer", async (data) => {
    var info = JSON.parse(data);
    const toSocketId = await isUserOnline(info.to);
    if (toSocketId) {
      io.to(toSocketId).emit("rtcOffer", data);
    }
  });

  socket.on("rtcAnswer", async (data) => {
    var info = JSON.parse(data);
    const toSocketId = await isUserOnline(info.to);
    if (toSocketId) {
      io.to(toSocketId).emit("rtcAnswer", data);
    }
  });

  socket.on("iceCandidate", async (data) => {
    var info = JSON.parse(data);
    const toSocketId = await isUserOnline(info.to);
    if (toSocketId) {
      io.to(toSocketId).emit("iceCandidate", data);
    }
  });

  // Clear Presence
  socket.on("disconnect", async () => {
    console.log(`Disconnected : ${phone}`);
    removeConnectedUser(phone);
  });
});

const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

Promise.all([redisClient.connect(), pubClient.connect(), subClient.connect()])
  .then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    httpServer.listen(PORT, () => {
      console.log(`Server Live -> ${PORT}`);
    });
  })
  .catch((err) => {
    console.log(err);
  });
