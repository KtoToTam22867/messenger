const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const DB_FILE = "users.json";
let users = {};
let online = {};

if (fs.existsSync(DB_FILE)) {
    try { users = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { users = {}; }
}

io.on("connection", (socket) => {
    socket.on("login", (data, cb) => {
        if (users[data.username] && users[data.username].password === data.password) {
            socket.username = data.username;
            online[data.username] = socket.id;
            cb({ success: true, isAdmin: data.username === "Admin" });
            io.emit("online", Object.keys(online));
        } else cb({ success: false });
    });

    // Создание группы (только для админа)
    socket.on("create-group", (groupName) => {
        if (socket.username === "Admin") {
            io.emit("group-available", groupName);
        }
    });

    socket.on("join-group", (groupName) => {
        socket.join(groupName);
        socket.to(groupName).emit("user-joined", { from: socket.username, sid: socket.id });
    });

    // Сигналинг (исправлен для передачи экрана)
    socket.on("call-user", d => {
        const target = online[d.to] || d.to;
        io.to(target).emit("incoming-call", { fromSid: socket.id, offer: d.offer });
    });

    socket.on("answer-call", d => {
        const target = online[d.to] || d.to;
        io.to(target).emit("call-answered", { fromSid: socket.id, answer: d.answer });
    });

    socket.on("ice-candidate", d => {
        const target = online[d.to] || d.to;
        io.to(target).emit("ice-candidate", { fromSid: socket.id, candidate: d.candidate });
    });

    socket.on("disconnect", () => {
        if (socket.username) {
            delete online[socket.username];
            io.emit("online", Object.keys(online));
        }
    });
});

server.listen(3000, () => console.log("Server OK"));