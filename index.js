if (!process.env.PRODUCTION) {
  require("dotenv").config();
}
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

async function insertNewUser(phoneNumber) {
  try {
    const result = await redisClient.hSet(
      "users",
      phoneNumber,
      JSON.stringify({ isOnline: false, socketId: null })
    );
    return result === 1;
  } catch (err) {
    console.log(err);
    return false;
  }
}

async function getAllUsers(phoneNumbers) {
  try {
    return await redisClient.hmGet("users", phoneNumbers);
  } catch (err) {
    console.log(err);
    return null;
  }
}

async function isUserOnline(phoneNumber) {
  try {
    const user = await redisClient.hGet("users", phoneNumber);
    if (user.isOnline) {
      return user.socketId;
    } else {
      return null;
    }
  } catch (err) {
    console.log(err);
    return null;
  }
}

function removeUser(phoneNumber) {
  try {
    redisClient.hDel("users", phoneNumber);
  } catch (err) {
    console.log(err);
  }
}

function updateUserPresence(phoneNumber, isOnline = false, socketId = null) {
  try {
    redisClient.hSet(
      "users",
      phoneNumber,
      JSON.stringify({ isOnline: isOnline, socketId: socketId })
    );
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
  updateUserPresence(phone, true, socket.id);

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
    updateUserPresence(phone);
  });
});

// REST API
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("Share Bits Server");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.post("/registerUser", (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  if (!phoneNumber) {
    res.status(400).send("Invalid Request Body");
  }
  insertNewUser(phoneNumber);
  res.status(200).send("User Registered");
});

app.post("/deleteUser", (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  if (!phoneNumber) {
    res.status(400).send("Invalid Request Body");
  }
  removeUser(phoneNumber);
  res.status(200).send("User Unregistered");
});

app.post("syncContacts", async (req, res) => {
  const phoneNumbers = req.body.phoneNumbers;
  if (!phoneNumbers) {
    res.status(400).send("Invalid Request Body");
  }
  const users = await getAllUsers(phoneNumbers);
  res.status(200).send(users);
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
