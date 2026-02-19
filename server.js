const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8
});

app.use(express.static("public"));

let users = {};
let messages = {
  global: [],
  private: {}
};

function getRoom(a,b){
  return [a,b].sort().join("_");
}

io.on("connection", (socket)=>{

  socket.on("join", name=>{
    socket.username = name;
    users[name] = socket.id;
    io.emit("users", Object.keys(users));
  });

  socket.on("send_global", data=>{
    const msg = {
      user: socket.username,
      type: data.type,
      content: data.content
    };
    messages.global.push(msg);
    io.emit("new_global", msg);
  });

  socket.on("send_private", ({to, type, content})=>{
    const room = getRoom(socket.username, to);
    if(!messages.private[room]) messages.private[room] = [];

    const msg = {
      from: socket.username,
      to,
      type,
      content
    };

    messages.private[room].push(msg);

    const target = users[to];
    if(target) io.to(target).emit("new_private", msg);

    socket.emit("new_private", msg);
  });

  socket.on("load_private", other=>{
    const room = getRoom(socket.username, other);
    socket.emit("private_history", messages.private[room] || []);
  });

  socket.on("disconnect", ()=>{
    delete users[socket.username];
    io.emit("users", Object.keys(users));
  });

});

server.listen(3000, ()=>{
  console.log("Asylumgram v4 PRO running");
});