const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {

  socket.on("join", (name) => {
    socket.username = name;

    io.emit("system_message", `${name} вошёл в чат`);
  });

  socket.on("chat_message", (msg) => {
    io.emit("chat_message", {
      user: socket.username,
      message: msg
    });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      io.emit("system_message", `${socket.username} вышел из чата`);
    }
  });

});

server.listen(3000, () => {
  console.log("Asylumgram running on port 3000");
});