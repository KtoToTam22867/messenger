const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {}; // socket.id -> username

io.on("connection", (socket) => {

  socket.on("join", (username) => {
    users[socket.id] = username;
    io.emit("users", users);
  });

  socket.on("private_message", (data) => {
    io.to(data.to).emit("private_message", {
      from: users[socket.id],
      message: data.message
    });
  });

  // ===== ЗВОНОК =====
  socket.on("call-user", (data) => {
    io.to(data.to).emit("incoming-call", {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on("answer-call", (data) => {
    io.to(data.to).emit("call-answered", {
      answer: data.answer
    });
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.to).emit("ice-candidate", data.candidate);
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("users", users);
  });

});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});