const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));

let users = {};
let online = {};

if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

io.on("connection", socket => {

  socket.on("register", (data, cb) => {
    if (!data.username || !data.password)
      return cb({ success: false });

    if (users[data.username])
      return cb({ success: false });

    users[data.username] = {
      password: data.password,
      avatar: null
    };

    saveUsers();
    cb({ success: true });
  });

  socket.on("login", (data, cb) => {
    if (!users[data.username])
      return cb({ success: false });

    if (users[data.username].password !== data.password)
      return cb({ success: false });

    socket.username = data.username;
    online[data.username] = socket.id;

    cb({
      success: true,
      avatar: users[data.username].avatar
    });

    io.emit("online", Object.keys(online));
  });

  socket.on("setAvatar", img => {
    if (!socket.username) return;
    users[socket.username].avatar = img;
    saveUsers();
  });

  socket.on("send_message", data => {
    if (!socket.username) return;

    if (data.to === "global") {
      io.emit("new_message", {
        from: socket.username,
        text: data.text,
        image: data.image || null
      });
    } else {
      const id = online[data.to];
      if (id) {
        io.to(id).emit("new_message", {
          from: socket.username,
          text: data.text,
          image: data.image || null
        });
      }

      io.to(socket.id).emit("new_message", {
        from: socket.username,
        text: data.text,
        image: data.image || null
      });
    }
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      delete online[socket.username];
      io.emit("online", Object.keys(online));
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server started"));