const express = require("express");
const app = express();
const { createServer } = require("http");
const httpServer = createServer(app);
const { Server } = require("socket.io");
const io = new Server(httpServer, {});
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const PORT = process.env.PORT || 3000;

// Firebase
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = require("./key.json");

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
});

const fireStore = getFirestore();

// REST API

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.status(200).sendFile("index.html");
});

app.post("/users", async (req, res) => {
  var body = req.body;
  if (body) {
    let phoneNumbers = body.phoneNumbers;
    let found = [];
    for (let i = 0; i < phoneNumbers.length; i += 100) {
      let users = await getAuth().getUsers(
        phoneNumbers.slice(i, Math.min(i + 99, phoneNumbers.length))
      );
      if (users.users.length > 0) {
        users.users.forEach((user) => {
          found.push(user.phoneNumber);
        });
      }
    }

    res.status(200).send(found);
  } else {
    console.log("Empty Body");
    res.status(400).send("Empty Body");
  }
});

app.post("/rejectCall", (req, res) => {
  var presenceStatus = users.has(req.body.who);
  if (presenceStatus) {
    io.to(users.get(req.body.who)).emit("callDeclined");
    res.status(200).send();
  }
  res.status(404).send();
});

// Socket Implementation
const users = new Map();
// try {
//   const pubClient = createClient({ url: "redis://localhost:6379" });
//   const subClient = pubClient.duplicate();

//   io.adapter(createAdapter(pubClient, subClient));
// } catch (error) {
//   console.log(error);
// }

io.on("connection", (socket) => {
  // Save Presence
  var phone = socket.handshake.headers.phone;
  var type = socket.handshake.headers.type;

  if (type == 1) {
    users.set(phone, socket.id);
  }

  // Call Request
  socket.on("call", async (to, callback) => {
    var callRequestInfo = { to: to };
    callRequestInfo.from = phone;
    // Check For Presence
    var presenceStatus = users.has(callRequestInfo.to);
    if (presenceStatus) {
      // Online And Send Call Via Socket
      let toId = users.get(callRequestInfo.to);
      io.to(toId).emit("call", JSON.stringify(callRequestInfo));
      callback({
        status: "OK",
      });
    } else {
      // Offline And Send Push Notification
      // console.log("User Offline");
      // console.log("Fetching FCM Token");
      console.log(to);
      let userDoc = await fireStore
        .collection("users")
        .doc(callRequestInfo.to)
        .get();
      let registrationTokens = userDoc.data().tokens;
      const message = {
        data: {
          payload: JSON.stringify(callRequestInfo),
        },
        android: {
          ttl: 0,
        },
        tokens: registrationTokens,
      };
      getMessaging()
        .sendMulticast(message)
        .then((response) => {
          // Response is a message ID string.
          console.log("Successfully sent message:", response);
        })
        .catch((error) => {
          console.log("Error sending message:", error);
        });
    }
    callback({
      status: "OK",
    });
  });

  // Cancle Call Request
  socket.on("cancelCall", async (who) => {
    // Check For Presence
    var presenceStatus = users.has(who);
    if (presenceStatus) {
      // Online And Send Call Via Socket
      let toId = users.get(who);
      io.to(toId).emit("cancle");
    } else {
      // Offline And Send Push Notification
      // console.log("User Offline");
      // console.log("Fetching FCM Token");
      // let userDoc = await fireStore.collection("users").doc(who).get();
      // let registrationTokens = userDoc.data().tokens;
      // console.log(registrationTokens);
      // const message = {
      //   notification: {
      //     title: "Missed Call",
      //     body: `You have a missed call from ${phone}`,
      //   },
      //   tokens: registrationTokens,
      // };
      // getMessaging()
      //   .sendMulticast(message)
      //   .then((response) => {
      //     // Response is a message ID string.
      //     console.log("Successfully sent message:", response);
      //   })
      //   .catch((error) => {
      //     console.log("Error sending message:", error);
      //   });
    }
  });

  socket.on("callDeclined", (info) => {
    var presenceStatus = users.has(info);
    if (presenceStatus) {
      io.to(users.get(info)).emit("callDeclined");
    }
  });

  socket.on("callAccepted", (to) => {
    console.log("ACCEPTED");
    var presenceStatus = users.has(to);
    if (presenceStatus) {
      io.to(users.get(to)).emit("callAccepted");
    }
  });

  socket.on("callOffer", (data) => {
    var info = JSON.parse(data);
    info.from = phone;
    var presenceStatus = users.has(info.to);
    if (presenceStatus) {
      io.to(users.get(info.to)).emit("callOffer", JSON.stringify(info));
    }
  });

  socket.on("answerOffer", (data) => {
    var info = JSON.parse(data);
    info.from = phone;
    var presenceStatus = users.has(info.to);
    if (presenceStatus) {
      io.to(users.get(info.to)).emit("answerOffer", JSON.stringify(info));
    }
  });

  socket.on("iceCandidate", (data) => {
    var info = JSON.parse(data);
    var presenceStatus = users.has(info.to);
    if (presenceStatus) {
      io.to(users.get(info.to)).emit("iceCandidate", data);
    }
  });

  // Clear Presence
  socket.on("disconnect", () => {
    if (type == 1) {
      users.delete(phone);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server Live -> ${PORT}`);
});
