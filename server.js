const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8
});

app.use(express.static("public"));

let users = {}; // { username: socket.id }
let privateMessages = {}; // { room: [] }

function getRoom(a,b){
  return [a,b].sort().join("_");
}

io.on("connection", (socket)=>{

  socket.on("join", name=>{
    socket.username = name;
    users[name] = socket.id;
    io.emit("users", Object.keys(users));
  });

  socket.on("send_message", ({to, type, content})=>{

    if(to){ // приватный чат
      const room = getRoom(socket.username, to);

      if(!privateMessages[room])
        privateMessages[room] = [];

      const msg = {
        from: socket.username,
        to,
        type,
        content
      };

      privateMessages[room].push(msg);

      if(users[to])
        io.to(users[to]).emit("new_message", msg);

      socket.emit("new_message", msg);

    } else { // глобальный чат
      const msg = {
        from: socket.username,
        type,
        content
      };

      io.emit("new_message", msg);
    }

  });

  socket.on("load_private", other=>{
    const room = getRoom(socket.username, other);
    socket.emit("private_history", privateMessages[room] || []);
  });

  socket.on("typing", to=>{
    if(to && users[to]){
      io.to(users[to]).emit("typing", socket.username);
    }
  });

  socket.on("disconnect", ()=>{
    delete users[socket.username];
    io.emit("users", Object.keys(users));
  });

});

server.listen(3000, ()=>{
  console.log("Asylumgram v5 Lite running");
});