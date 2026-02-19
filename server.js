const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {}; // username -> socket.id

io.on("connection", (socket) => {

  socket.on("join", (username) => {
    users[username] = socket.id;
    io.emit("users", Object.keys(users));
  });

  socket.on("private_message", (data) => {
    const targetId = users[data.to];
    if (targetId) {
      io.to(targetId).emit("private_message", {
        from: data.from,
        message: data.message
      });
    }
  });

  socket.on("call-user", (data) => {
    const targetId = users[data.to];
    if (targetId) {
      io.to(targetId).emit("incoming-call", data);
    }
  });

  socket.on("answer-call", (data) => {
    const targetId = users[data.to];
    if (targetId) {
      io.to(targetId).emit("call-answered", data);
    }
  });

  socket.on("ice-candidate", (data) => {
    const targetId = users[data.to];
    if (targetId) {
      io.to(targetId).emit("ice-candidate", data.candidate);
    }
  });

  socket.on("disconnect", () => {
    for (let name in users) {
      if (users[name] === socket.id) {
        delete users[name];
      }
    }
    io.emit("users", Object.keys(users));
  });

});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});