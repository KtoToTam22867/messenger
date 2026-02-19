const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static("public"));

let accounts = {};
let onlineUsers = {};
let privateMessages = {};
let groups = {};

function getRoom(a, b) {
  return [a, b].sort().join("_");
}

io.on("connection", (socket) => {

  // REGISTER
  socket.on("register", (data, cb) => {
    if (accounts[data.username])
      return cb({ success: false, message: "Ник занят" });

    accounts[data.username] = { password: data.password };
    cb({ success: true });
  });

  // LOGIN
  socket.on("login", (data, cb) => {
    if (!accounts[data.username])
      return cb({ success: false, message: "Нет аккаунта" });

    if (accounts[data.username].password !== data.password)
      return cb({ success: false, message: "Неверный пароль" });

    if (onlineUsers[data.username])
      return cb({ success: false, message: "Уже онлайн" });

    socket.username = data.username;
    onlineUsers[data.username] = socket.id;

    cb({ success: true });
    io.emit("users", Object.keys(onlineUsers));
    socket.emit("groups", groups);
  });

  // GLOBAL
  socket.on("send_global", msg => {
    io.emit("new_global", msg);
  });

  // PRIVATE
  socket.on("send_private", ({ to, message }) => {
    const room = getRoom(socket.username, to);

    if (!privateMessages[room])
      privateMessages[room] = [];

    privateMessages[room].push(message);

    if (onlineUsers[to])
      io.to(onlineUsers[to]).emit("new_private", message);

    socket.emit("new_private", message);
  });

  socket.on("load_private", other => {
    const room = getRoom(socket.username, other);
    socket.emit("private_history", privateMessages[room] || []);
  });

  // GROUPS
  socket.on("create_group", (name, cb) => {
    if (groups[name])
      return cb({ success: false, message: "Группа существует" });

    groups[name] = {
      admin: socket.username,
      members: [socket.username],
      messages: []
    };

    io.emit("groups", groups);
    cb({ success: true });
  });

  socket.on("join_group", name => {
    if (!groups[name]) return;

    if (!groups[name].members.includes(socket.username))
      groups[name].members.push(socket.username);

    socket.emit("group_history", groups[name].messages);
  });

  socket.on("send_group", ({ groupName, message }) => {
    if (!groups[groupName]) return;

    groups[groupName].messages.push(message);

    groups[groupName].members.forEach(member => {
      if (onlineUsers[member])
        io.to(onlineUsers[member]).emit("new_group", {
          groupName,
          message
        });
    });
  });

  // CALL SIGNALING
  socket.on("call_user", data => {
    const target = onlineUsers[data.to];
    if (target)
      io.to(target).emit("incoming_call", {
        from: socket.username,
        offer: data.offer
      });
  });

  socket.on("answer_call", data => {
    const target = onlineUsers[data.to];
    if (target)
      io.to(target).emit("call_answer", {
        answer: data.answer
      });
  });

  socket.on("ice_candidate", data => {
    const target = onlineUsers[data.to];
    if (target)
      io.to(target).emit("ice_candidate", data.candidate);
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      io.emit("users", Object.keys(onlineUsers));
    }
  });

});

server.listen(3000, () => console.log("🔥 ASYLUMGRAM PRO FULL RUNNING"));