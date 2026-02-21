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
} else {
    fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

io.on("connection", (socket) => {
    socket.on("register", (data, cb) => {
        if (!data.username || users[data.username]) return cb({ success: false, msg: "Логин занят" });
        users[data.username] = { password: data.password };
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
        cb({ success: true });
    });

    socket.on("login", (data, cb) => {
        if (users[data.username] && users[data.username].password === data.password) {
            socket.username = data.username;
            online[data.username] = socket.id;
            cb({ success: true });
            io.emit("online", Object.keys(online));
        } else cb({ success: false, msg: "Ошибка доступа" });
    });

    socket.on("send_message", (d) => {
        const payload = { 
            from: socket.username, 
            text: d.text, 
            to: d.to, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        };
        if (d.to === "global") {
            io.emit("new_message", payload);
        } else {
            const sid = online[d.to];
            if (sid) io.to(sid).emit("new_message", payload);
            socket.emit("new_message", payload);
        }
    });

    // Сигналинг WebRTC
    socket.on("call-user", d => {
        if(online[d.to]) io.to(online[d.to]).emit("incoming-call", { from: socket.username, offer: d.offer });
    });
    socket.on("answer-call", d => {
        if(online[d.to]) io.to(online[d.to]).emit("call-answered", { answer: d.answer });
    });
    socket.on("ice-candidate", d => {
        if(online[d.to]) io.to(online[d.to]).emit("ice-candidate", { candidate: d.candidate });
    });
    socket.on("reject-call", d => {
        if(online[d.to]) io.to(online[d.to]).emit("call-rejected");
    });

    socket.on("disconnect", () => {
        if (socket.username) {
            delete online[socket.username];
            io.emit("online", Object.keys(online));
        }
    });
});

server.listen(3000, '0.0.0.0', () => console.log("🚀 Сервер запущен на порту 3000"));