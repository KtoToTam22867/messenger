const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const ADMIN = "Admin"; // ← поменяй на свой ник

let users = {};
let privateMessages = {};

function getRoom(a,b){
  return [a,b].sort().join("_");
}

io.on("connection",(socket)=>{

  socket.on("register",(username,callback)=>{
    if(users[username]){
      callback({success:false,message:"Ник уже занят"});
    } else {
      socket.username=username;
      users[username]=socket.id;
      callback({success:true});
      io.emit("users",Object.keys(users));
    }
  });

  socket.on("send_global",msg=>{
    // --- команда кика ---
    if(msg.content.startsWith("/kick ")){
      if(socket.username !== ADMIN){
        return;
      }

      const target = msg.content.split(" ")[1];

      if(users[target]){
        const targetSocket = io.sockets.sockets.get(users[target]);

        if(targetSocket){
          targetSocket.emit("kicked","Вы были кикнуты администратором");
          targetSocket.disconnect();
        }
      }
      return;
    }

    io.emit("new_global",msg);
  });

  socket.on("send_private",({to,message})=>{
    const room=getRoom(socket.username,to);
    if(!privateMessages[room]) privateMessages[room]=[];
    privateMessages[room].push(message);

    if(users[to])
      io.to(users[to]).emit("new_private",message);

    socket.emit("new_private",message);
  });

  socket.on("load_private",other=>{
    const room=getRoom(socket.username,other);
    socket.emit("private_history",privateMessages[room]||[]);
  });

  socket.on("disconnect",()=>{
    if(socket.username){
      delete users[socket.username];
      io.emit("users",Object.keys(users));
    }
  });

});

server.listen(3000,()=>console.log("Asylumgram with kick system running"));