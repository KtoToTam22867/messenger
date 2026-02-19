const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server);

let users = {};
let messages = [];

if (fs.existsSync("messages.json")) {
  messages = JSON.parse(fs.readFileSync("messages.json"));
}

io.on("connection", (socket) => {

  socket.on("register", (username) => {
    users[username] = socket.id;
    socket.username = username;
  });

  socket.on("private_message", ({ to, message }) => {
    const msg = {
      from: socket.username,
      to,
      message,
      time: new Date()
    };

    messages.push(msg);
    fs.writeFileSync("messages.json", JSON.stringify(messages));

    if (users[to]) {
      io.to(users[to]).emit("private_message", msg);
    }

    socket.emit("private_message", msg);
  });

});

server.listen(3000, () => {
  console.log("Сервер запущен: http://localhost:3000");
});