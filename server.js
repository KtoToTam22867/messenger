const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {}; // name -> socket.id
let messages = {
  global: [],
  private: {} // "user1_user2": []
};

function getPrivateRoom(a, b) {
  return [a, b].sort().join("_");
}

io.on("connection", (socket) => {

  socket.on("join", (name) => {
    socket.username = name;
    users[name] = socket.id;

    io.emit("users", Object.keys(users));
    socket.emit("load_global", messages.global);
  });

  socket.on("send_global", (msg) => {
    const data = {
      user: socket.username,
      message: msg
    };

    messages.global.push(data);
    io.emit("new_global", data);
  });

  socket.on("send_private", ({ to, message }) => {
    const room = getPrivateRoom(socket.username, to);

    if (!messages.private[room]) {
      messages.private[room] = [];
    }

    const data = {
      from: socket.username,
      to,
      message
    };

    messages.private[room].push(data);

    const targetId = users[to];
    if (targetId) {
      io.to(targetId).emit("new_private", data);
    }

    socket.emit("new_private", data);
  });

  socket.on("load_private", (otherUser) => {
    const room = getPrivateRoom(socket.username, otherUser);
    socket.emit("private_history", messages.private[room] || []);
  });

  socket.on("disconnect", () => {
    delete users[socket.username];
    io.emit("users", Object.keys(users));
  });

});

server.listen(3000, () => {
  console.log("Asylumgram v3 running on port 3000");
});